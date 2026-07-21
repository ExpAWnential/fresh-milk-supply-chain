import { Pool } from "pg";

export interface StorageConfig {
  readonly connectionString: string;
}

export function createPool(_config: StorageConfig): Pool {
  // TODO: Create a configured connection pool for the off-chain PostgreSQL database.
  throw new Error("createPool is not implemented yet.");
}
