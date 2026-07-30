import { createPool, createTemperatureRepository } from "@fresh-milk/storage";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { createReaderForRequest } from "./fabric/anchoredEvidence.js";
import { createFabricGatewayClient } from "./fabric/gateway.js";
import { connectAsRequestIdentity } from "./fabric/request.js";
import { getDemoIdentity } from "./demoIdentity.js";

const pool = createPool({ connectionString: config.databaseUrl });
const app = createApp({
  connect: connectAsRequestIdentity,
  // Consumers hold no network identity, so the backend reads on their behalf as the regulator.
  readAsRegulator: () => createFabricGatewayClient(getDemoIdentity("regulator")),
  temperatureRepository: createTemperatureRepository(pool),
  readerForRequest: createReaderForRequest
});

const server = app.listen(config.port, () => {
  console.log(`backend listening on port ${config.port}`);
});

async function shutdown(): Promise<void> {
  server.close();
  await pool.end();
}

process.once("SIGINT", () => {
  void shutdown();
});
process.once("SIGTERM", () => {
  void shutdown();
});
