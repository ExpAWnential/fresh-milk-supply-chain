-- The regulator's own database: an archive of the verdicts the ledger reached, built entirely
-- from the chaincode events its backend subscribes to.
--
-- Separate from the oracle's database on purpose. A regulator that read its evidence out of the
-- database belonging to the party it supervises would be trusting that party's copy, which is the
-- arrangement a ledger exists to replace. Nothing here can reference the oracle's tables, because
-- they are in a different database.

CREATE DATABASE freshmilk_regulator;

\connect freshmilk_regulator

CREATE TABLE IF NOT EXISTS ledger_compliance_verdicts (
    evidence_id TEXT PRIMARY KEY,
    batch_id TEXT NOT NULL,
    evidence_hash TEXT NOT NULL CHECK (evidence_hash ~ '^[0-9a-f]{64}$'),
    compliance_outcome TEXT NOT NULL CHECK (compliance_outcome IN ('COMPLIANT', 'UNSAFE')),
    submitted_by_stakeholder_id TEXT NOT NULL,
    -- Never null. A verdict only exists here because a committed transaction announced it.
    fabric_transaction_id TEXT NOT NULL,
    -- The timestamp the contract stamped on the transaction, not the time this row was written.
    ledger_timestamp TIMESTAMPTZ NOT NULL,
    event_name TEXT NOT NULL
        CHECK (event_name IN ('TemperatureEvidenceSubmitted', 'ColdChainBreach')),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ledger_verdicts_batch_id
    ON ledger_compliance_verdicts (batch_id);
