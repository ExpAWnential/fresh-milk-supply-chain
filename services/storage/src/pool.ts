/**
 * Creates the PostgreSQL connection pool. Connection settings only.
 */
import { Pool } from "pg";

// The two databases this package's init scripts create, with the logins they grant. Written here
// rather than at each call site: the credentials are defined in initdb/03-roles.sql, which this
// package owns, and the last time the database was renamed four separate copies had to be found
// and edited by hand.
//
// POSTGRES_PORT is honoured because the compose file publishes on it, for anyone whose 5432 is
// already taken. Hardcoding the port here would leave that override with nothing reading it.
const postgresPort = process.env.POSTGRES_PORT?.trim() || "5432";

export const ORACLE_DATABASE_URL = `postgres://oracle_app:oracle@localhost:${postgresPort}/freshmilk_oracle`;
export const REGULATOR_DATABASE_URL = `postgres://regulator_app:regulator@localhost:${postgresPort}/freshmilk_regulator`;

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
