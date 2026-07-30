/**
 * Process entry point. Builds the real dependencies, starts the HTTP server and the ledger event
 * listener, and shuts both down on a signal.
 *
 * Wiring only. Every decision made here is which implementation to hand to something else.
 */
import { createPool, createTemperatureRepository } from "@fresh-milk/storage";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { createReaderForRequest } from "./fabric/anchoredEvidence.js";
import { createFabricGatewayClient, createLedgerEventStream } from "./fabric/gateway.js";
import { connectAsRequestIdentity } from "./fabric/request.js";
import { getDemoIdentity } from "./demoIdentity.js";
import { consumeComplianceEvents } from "./events/complianceEvents.js";

const pool = createPool({ connectionString: config.databaseUrl });
const temperatureRepository = createTemperatureRepository(pool);
const app = createApp({
  connect: connectAsRequestIdentity,
  // Consumers hold no network identity, so the backend reads on their behalf as the regulator.
  readAsRegulator: () => createFabricGatewayClient(getDemoIdentity("regulator")),
  temperatureRepository,
  readerForRequest: createReaderForRequest
});

// The contract decides whether a batch is compliant, so the off-chain copy of that verdict is
// taken from the ledger's own events rather than from what the oracle thought it would be.
const eventStream = await createLedgerEventStream(
  getDemoIdentity("regulator"),
  config.supplychainChaincodeName,
  config.eventCheckpointPath
);

void consumeComplianceEvents(eventStream.events, {
  temperatureRepository,
  checkpoint: (event) => eventStream.checkpoint(event)
}).catch((error) => {
  console.error("The ledger event listener stopped.", error);
});

const server = app.listen(config.port, () => {
  console.log(`backend listening on port ${config.port}`);
});

async function shutdown(): Promise<void> {
  server.close();
  eventStream.close();
  await pool.end();
}

process.once("SIGINT", () => {
  void shutdown();
});
process.once("SIGTERM", () => {
  void shutdown();
});
