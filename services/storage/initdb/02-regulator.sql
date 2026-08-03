-- Stores the regulator's independent archive of verdicts emitted by Fabric chaincode events.

CREATE DATABASE freshmilk_regulator;

\connect freshmilk_regulator

CREATE TABLE IF NOT EXISTS ledger_compliance_verdicts (
    evidence_id TEXT PRIMARY KEY,
    batch_id TEXT NOT NULL,
    evidence_hash TEXT NOT NULL CHECK (evidence_hash ~ '^[0-9a-f]{64}$'),
    compliance_outcome TEXT NOT NULL CHECK (compliance_outcome IN ('COMPLIANT', 'UNSAFE')),
    submitted_by_stakeholder_id TEXT NOT NULL,
    -- Every archived verdict came from a committed Fabric transaction.
    fabric_transaction_id TEXT NOT NULL,
    -- Fabric transaction time, distinct from recorded_at below.
    ledger_timestamp TIMESTAMPTZ NOT NULL,
    event_name TEXT NOT NULL
        CHECK (event_name IN ('TemperatureEvidenceSubmitted', 'ColdChainBreach')),

    -- UNKNOWN means the regulator could not complete the check. FAILED means a completed check
    -- rejected at least one signature.
    signature_check TEXT NOT NULL DEFAULT 'UNKNOWN'
        CHECK (signature_check IN ('PASSED', 'FAILED', 'UNKNOWN')),
    signature_checked_at TIMESTAMPTZ,

    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ledger_verdicts_batch_id
    ON ledger_compliance_verdicts (batch_id);
