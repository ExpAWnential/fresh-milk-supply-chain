/**
 * Starts one organisation's backend with its fixed Fabric identity and optional off-chain store.
 *
 * The regulator additionally runs the compliance event listener. Other organisations fetch the
 * oracle's raw readings when they need to verify evidence against Fabric independently.
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

// The process loads one identity, so request data cannot choose which certificate signs.
const identity = resolveLocalOrganisation(process.env, config.fabricOrganizationsPath);

// A declared off-chain store requires a database. Other organisations intentionally run without one.
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

// Non-holders fetch the readings, then verify them independently against Fabric.
const readingsOrigin = process.env.ORACLE_BACKEND_URL ?? originOf(readingsHolder());

// Validate wallet material before accepting requests that would require it.
const certificateId = await deriveCertificateId(identity);

// The route and event listener share the same verification sources.
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

// Only the regulator has a verdict repository and starts this listener. It starts after HTTP so a
// slow peer does not prevent the backend serving requests.
let eventStream: LedgerEventStream | undefined;
let shuttingDown = false;
// Shutdown also waits when a signal arrives while the stream is still opening.
let listenerStarted: Promise<void> | undefined;

if (verdictRepository) {
  listenerStarted = (async () => {
    const stream = await createLedgerEventStream(
      identity,
      config.supplychainChaincodeName,
      config.eventCheckpointPath
    );

    // A shutdown signal may arrive while createLedgerEventStream is pending.
    if (shuttingDown) {
      stream.close();
      return;
    }
    eventStream = stream;

    await consumeComplianceEvents(stream.events, {
      verdictRepository,
      // Verify each verdict using the regulator's own ledger connection.
      checkSignatures: (evidenceId) => checkEvidenceSignatures(evidenceId, verificationSources),
      checkpoint: (event) => stream.checkpoint(event)
    });
  })();

  void listenerStarted.catch((error) => {
    // Closing the gRPC stream rejects the listener promise during a normal shutdown.
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

  // Let any in-flight archive write settle before closing its database pool.
  await listenerStarted?.catch(() => {});
  await pool?.end();
}

process.once("SIGINT", () => {
  void shutdown();
});
process.once("SIGTERM", () => {
  void shutdown();
});
