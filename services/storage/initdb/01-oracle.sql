-- The oracle's own database: the raw sensor readings it collected, and its record of what it
-- anchored for them. Runs against POSTGRES_DB, which the compose file sets to freshmilk_oracle.
--
-- Detailed operational data lives here. Only the evidence hash, the off-chain reference,
-- the computed statistics and the compliance outcome are written to the ledger.
-- No credentials, certificates or private keys are stored in this database.
--
-- compliance_outcome here is the oracle's own reading of the numbers. The verdict that counts is
-- the one the contract derived, which lives in the regulator's database and is built from the
-- ledger's events. Keeping them apart is what lets the two be compared.

CREATE TABLE IF NOT EXISTS temperature_evidence (
    evidence_id TEXT PRIMARY KEY,
    batch_id TEXT NOT NULL,
    sensor_id TEXT NOT NULL,
    evidence_hash TEXT NOT NULL CHECK (evidence_hash ~ '^[0-9a-f]{64}$'),
    min_celsius NUMERIC(6, 3) NOT NULL,
    max_celsius NUMERIC(6, 3) NOT NULL,
    reading_count INTEGER NOT NULL CHECK (reading_count > 0),
    compliance_outcome TEXT NOT NULL CHECK (compliance_outcome IN ('COMPLIANT', 'UNSAFE')),
    -- PENDING until the Fabric transaction is confirmed, so a failed submission is never
    -- mistaken for anchored evidence.
    submission_status TEXT NOT NULL CHECK (submission_status IN ('PENDING', 'ANCHORED', 'FAILED')),
    fabric_transaction_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CHECK (min_celsius <= max_celsius),
    CHECK (submission_status <> 'ANCHORED' OR fabric_transaction_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS temperature_readings (
    reading_id BIGSERIAL PRIMARY KEY,
    evidence_id TEXT NOT NULL REFERENCES temperature_evidence (evidence_id) ON DELETE CASCADE,
    sensor_id TEXT NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL,
    celsius NUMERIC(6, 3) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_temperature_evidence_batch_id ON temperature_evidence (batch_id);
CREATE INDEX IF NOT EXISTS idx_temperature_readings_evidence_id ON temperature_readings (evidence_id);
CREATE INDEX IF NOT EXISTS idx_temperature_readings_order
    ON temperature_readings (evidence_id, recorded_at, sensor_id, reading_id);
