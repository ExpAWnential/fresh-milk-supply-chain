/**
 * Process entry point. Works out which company this backend acts for, builds the real
 * dependencies, starts the HTTP server, and shuts everything down on a signal.
 *
 * Wiring only. Every decision made here is which implementation to hand to something else.
 */
import { createPool, createTemperatureRepository, createVerdictRepository } from "@fresh-milk/storage";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { createAnchoredEvidenceReader } from "./fabric/anchoredEvidence.js";
import { createSensorKeyReader } from "./fabric/sensorKeys.js";
import { checkEvidenceSignatures } from "./services/evidenceVerification.js";
import { deriveCertificateId } from "./fabric/certificateId.js";
import { createLedgerEventStream, type LedgerEventStream } from "./fabric/gateway.js";
import { connectAs } from "./fabric/connection.js";
import { originOf, readingsHolder, resolveLocalOrganisation } from "./organisations.js";
import { localReadingsSource, remoteReadingsSource } from "./services/readingsSource.js";
import { consumeComplianceEvents } from "./events/complianceEvents.js";

// Fixed for the life of the process. Nothing a caller sends can change which certificate signs,
// because this is the only identity the process ever loads.
const identity = resolveLocalOrganisation(process.env, config.fabricOrganizationsPath);

// What a company keeps off-chain is declared in the organisations table, not decided here by name.
// Only two of the six keep anything, in separate databases; for the other four the absence of a
// connection string is the correct configuration and the routes that serve stored rows answer 503.
// A company that is supposed to hold data and has no connection string is a misconfiguration, not
// a company that stores nothing. Left to run, the oracle would fall through to the remote readings
// source below and end up fetching its own readings from itself over HTTP, answering 503 to its
// own request. Failing here names the problem instead.
if (identity.offChainStore && !config.databaseUrl) {
  throw new Error(
    `The ${identity.name} keeps an off-chain ${identity.offChainStore} store, so it needs ` +
      `DATABASE_URL. Use 'pnpm backend:dev', which sets it for every company that needs one.`
  );
}

const pool = config.databaseUrl ? createPool({ connectionString: config.databaseUrl }) : undefined;
const temperatureRepository =
  pool && identity.offChainStore === "readings" ? createTemperatureRepository(pool) : undefined;
const verdictRepository =
  pool && identity.offChainStore === "verdicts" ? createVerdictRepository(pool) : undefined;

// The company holding the readings checks its own; every other company fetches them from it and
// checks them against the ledger itself. That second case is the one worth having: a retailer can
// catch its supplier altering records, which a company auditing its own database cannot.
const readingsOrigin = process.env.ORACLE_BACKEND_URL ?? originOf(readingsHolder());

// Read before the server binds. A process whose wallet cannot be read could not sign a single
// transaction, so failing here is better than starting up and refusing everything.
const certificateId = await deriveCertificateId(identity);

// Named so the event listener can reuse exactly what the verify route uses, rather than building a
// second, subtly different way of reaching the same two sources.
const verificationSources = {
  anchoredEvidenceReader: createAnchoredEvidenceReader(identity),
  sensorKeyReader: createSensorKeyReader(identity),
  readingsSource: temperatureRepository
    ? localReadingsSource(temperatureRepository)
    : remoteReadingsSource(readingsOrigin)
};

const app = createApp({
  identity,
  certificateId,
  connect: connectAs(identity),
  temperatureRepository,
  verdictRepository,
  ...verificationSources
});

const server = app.listen(identity.backendPort, () => {
  console.log(`${identity.name} backend listening on port ${identity.backendPort}`);
});

// The contract decides whether a batch is compliant, so the regulator's record of that verdict is
// taken from the ledger's own events rather than from what the oracle thought it would be.
//
// Only the regulator listens. A second consumer would race the first for the same rows and keep a
// second checkpoint that disagrees about how far the chain has been read.
//
// Started after the port is bound, and deliberately not awaited. Opening the stream is a TLS
// handshake and a gRPC call to a peer, and putting that in front of listen() meant a slow peer
// kept the regulator from serving anything at all, including the demo page the README sends you
// to. A peer that never answers now leaves a running backend with no listener rather than no
// backend.
let eventStream: LedgerEventStream | undefined;
let shuttingDown = false;
// The listener is started but not awaited, so a signal can arrive while the stream is still being
// opened. Shutdown waits on this rather than on the variable above, which would still be undefined
// at that point and leave an open gRPC stream nothing could ever close.
let listenerStarted: Promise<void> | undefined;

if (verdictRepository) {
  listenerStarted = (async () => {
    const stream = await createLedgerEventStream(
      identity,
      config.supplychainChaincodeName,
      config.eventCheckpointPath
    );

    // Close it immediately if shutdown ran while it was opening, rather than starting to consume
    // from a stream nobody is going to stop.
    if (shuttingDown) {
      stream.close();
      return;
    }
    eventStream = stream;

    await consumeComplianceEvents(stream.events, {
      verdictRepository,
      // The regulator checks the sensor signatures itself, as each verdict arrives, rather than
      // waiting for somebody to ask. It fetches the readings from whoever holds them and the
      // sensor's key off the ledger with its own certificate, so the party being checked supplies
      // neither half of the comparison.
      checkSignatures: (evidenceId) => checkEvidenceSignatures(evidenceId, verificationSources),
      checkpoint: (event) => stream.checkpoint(event)
    });
  })();

  void listenerStarted.catch((error) => {
    // Closing the stream cancels the gRPC call it is blocked on, so a clean shutdown always ends
    // up here. Reporting that would print a stack trace over every Ctrl-C and make a normal stop
    // look like a crash.
    if (shuttingDown) {
      return;
    }
    console.error("The ledger event listener stopped.", error);
  });
}

async function shutdown(): Promise<void> {
  shuttingDown = true;
  server.close();
  eventStream?.close();

  // Settle the listener before closing the pool, so a write in flight is not cut off underneath
  // it. Its rejection is already handled above; this only waits.
  await listenerStarted?.catch(() => {});
  await pool?.end();
}

process.once("SIGINT", () => {
  void shutdown();
});
process.once("SIGTERM", () => {
  void shutdown();
});
