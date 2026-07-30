import { createPool, createTemperatureRepository } from "@fresh-milk/storage";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { createFabricAnchoredEvidenceReader } from "./fabric/anchoredEvidence.js";

const pool = createPool({ connectionString: config.databaseUrl });
const app = createApp({
  temperatureRepository: createTemperatureRepository(pool),
  // Reads are made as the regulator, the one role permitted to inspect any batch's evidence.
  anchoredEvidenceReader: createFabricAnchoredEvidenceReader("regulator")
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
