import { Pool } from "pg";

export interface StorageConfig {
  readonly connectionString: string;
  readonly maxConnections?: number;
  readonly idleTimeoutMilliseconds?: number;
  readonly connectionTimeoutMilliseconds?: number;
}

export function createPool(config: StorageConfig): Pool {
  const connectionString = config.connectionString.trim();
  if (!connectionString) {
    throw new Error("PostgreSQL connection string must not be empty.");
  }

  return new Pool({
    connectionString,
    max: config.maxConnections ?? 10,
    idleTimeoutMillis: config.idleTimeoutMilliseconds ?? 30_000,
    connectionTimeoutMillis: config.connectionTimeoutMilliseconds ?? 5_000
  });
}
