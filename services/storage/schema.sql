-- Off-chain storage for the fresh-milk cold-chain PoC.
--
-- Detailed operational data lives here. Only the evidence hash, the off-chain reference,
-- the computed statistics and the compliance outcome are written to the ledger.
-- No credentials, certificates or private keys are stored in this database.

CREATE TABLE IF NOT EXISTS temperature_evidence (
    evidence_id           TEXT PRIMARY KEY,
    batch_id              TEXT        NOT NULL,
    sensor_id             TEXT        NOT NULL,
    evidence_hash         TEXT        NOT NULL CHECK (evidence_hash ~ '^[0-9a-f]{64}$'),
    min_celsius           NUMERIC(6, 3) NOT NULL,
    max_celsius           NUMERIC(6, 3) NOT NULL,
    average_celsius       NUMERIC(6, 3) NOT NULL,
    reading_count         INTEGER     NOT NULL CHECK (reading_count > 0),
    compliance_outcome    TEXT        NOT NULL CHECK (compliance_outcome IN ('COMPLIANT', 'UNSAFE')),
    -- PENDING until the Fabric transaction is confirmed, so a failed submission is never
    -- mistaken for anchored evidence.
    submission_status     TEXT        NOT NULL CHECK (submission_status IN ('PENDING', 'ANCHORED', 'FAILED')),
    fabric_transaction_id TEXT,
    CHECK (min_celsius <= max_celsius),
    CHECK (
        submission_status <> 'ANCHORED'
        OR fabric_transaction_id IS NOT NULL
    ),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS temperature_readings (
    reading_id  BIGSERIAL PRIMARY KEY,
    evidence_id TEXT        NOT NULL REFERENCES temperature_evidence (evidence_id) ON DELETE CASCADE,
    sensor_id   TEXT        NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL,
    celsius     NUMERIC(6, 3) NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
    document_id   TEXT PRIMARY KEY,
    batch_id      TEXT        NOT NULL,
    document_type TEXT        NOT NULL,
    file_location TEXT        NOT NULL,
    document_hash TEXT        NOT NULL CHECK (document_hash ~ '^[0-9a-f]{64}$'),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_temperature_evidence_batch_id ON temperature_evidence (batch_id);
CREATE INDEX IF NOT EXISTS idx_temperature_readings_evidence_id ON temperature_readings (evidence_id);
CREATE INDEX IF NOT EXISTS idx_temperature_readings_order
    ON temperature_readings (evidence_id, recorded_at, sensor_id, reading_id);
CREATE INDEX IF NOT EXISTS idx_documents_batch_id ON documents (batch_id);
