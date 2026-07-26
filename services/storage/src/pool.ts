import { Pool } from "pg";

export interface StorageConfig {
  readonly connectionString: string;
}

export function createPool(config: StorageConfig): Pool {
  return new Pool({
    connectionString: config.connectionString
  });
}
