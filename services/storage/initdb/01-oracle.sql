-- Stores the oracle's raw readings and submission record. Fabric receives only their fingerprint,
-- statistics, reference and independently derived verdict.

CREATE TABLE IF NOT EXISTS temperature_evidence (
    evidence_id TEXT PRIMARY KEY,
    batch_id TEXT NOT NULL,
    sensor_id TEXT NOT NULL,
    evidence_hash TEXT NOT NULL CHECK (evidence_hash ~ '^[0-9a-f]{64}$'),
    min_celsius NUMERIC(6, 3) NOT NULL,
    max_celsius NUMERIC(6, 3) NOT NULL,
    reading_count INTEGER NOT NULL CHECK (reading_count > 0),
    compliance_outcome TEXT NOT NULL CHECK (compliance_outcome IN ('COMPLIANT', 'UNSAFE')),
    -- PENDING until Fabric confirms the transaction.
    submission_status TEXT NOT NULL CHECK (submission_status IN ('PENDING', 'ANCHORED', 'FAILED')),
    fabric_transaction_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CHECK (min_celsius <= max_celsius),
    CHECK (submission_status <> 'ANCHORED' OR fabric_transaction_id IS NOT NULL)
);

-- Retain each signature so other organisations can verify the oracle's readings independently.
CREATE TABLE IF NOT EXISTS temperature_readings (
    reading_id BIGSERIAL PRIMARY KEY,
    evidence_id TEXT NOT NULL REFERENCES temperature_evidence (evidence_id) ON DELETE CASCADE,
    sensor_id TEXT NOT NULL,
    -- Signed one-based position used to detect gaps in a sensor run.
    sequence INTEGER NOT NULL CHECK (sequence > 0),
    recorded_at TIMESTAMPTZ NOT NULL,
    celsius NUMERIC(6, 3) NOT NULL,
    signature TEXT NOT NULL,

    -- A sensor run cannot contain two readings at the same position.
    UNIQUE (evidence_id, sequence)
);

CREATE INDEX IF NOT EXISTS idx_temperature_evidence_batch_id ON temperature_evidence (batch_id);
CREATE INDEX IF NOT EXISTS idx_temperature_readings_evidence_id ON temperature_readings (evidence_id);
CREATE INDEX IF NOT EXISTS idx_temperature_readings_order
    ON temperature_readings (evidence_id, recorded_at, sensor_id, reading_id);
