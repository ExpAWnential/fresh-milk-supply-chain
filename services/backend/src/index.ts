import { createPool, createTemperatureRepository } from "@fresh-milk/storage";
import { createApp } from "./app.js";
import { config } from "./config.js";

const pool = createPool({ connectionString: config.databaseUrl });
const app = createApp({
  temperatureRepository: createTemperatureRepository(pool)
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
