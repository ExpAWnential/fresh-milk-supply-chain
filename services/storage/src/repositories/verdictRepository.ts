/**
 * The regulator's archive of what the ledger decided.
 *
 * Every row here comes from a chaincode event, so it records the contract's own verdict rather
 * than anyone's summary of it. Nothing writes to this from the oracle's side.
 */
import type { Pool } from "pg";
import type { ComplianceOutcome } from "./temperatureRepository.js";

export type ComplianceEventName = "TemperatureEvidenceSubmitted" | "ColdChainBreach";

// UNKNOWN is not a failure. It means the check could not be completed, which has to stay distinct
// from a check that completed and found a forged reading: one is a gap in what was looked at, the
// other is a finding about the evidence.
export type SignatureCheck = "PASSED" | "FAILED" | "UNKNOWN";

export interface LedgerComplianceVerdict {
  readonly evidenceId: string;
  readonly batchId: string;
  readonly evidenceHash: string;
  readonly complianceOutcome: ComplianceOutcome;
  readonly submittedByStakeholderId: string;
  readonly fabricTransactionId: string;
  // Stamped by the contract, not by this process, so replaying the chain reproduces the archive
  // exactly rather than restamping everything with the time of the replay.
  readonly ledgerTimestamp: string;
  readonly eventName: ComplianceEventName;
  // Whether the regulator managed to check the sensor signatures behind this verdict, and what it
  // found. Defaults to UNKNOWN until the check runs.
  readonly signatureCheck: SignatureCheck;
  readonly signatureCheckedAt: string | null;
}

// What the event carries. The signature check has not run yet at the moment a verdict is archived,
// and it must not hold archiving up, so it is deliberately absent from the write shape rather than
// passed as a placeholder.
export type ArchivedVerdict = Omit<
  LedgerComplianceVerdict,
  "signatureCheck" | "signatureCheckedAt"
>;

export interface VerdictRepository {
  recordVerdict(verdict: ArchivedVerdict): Promise<void>;
  // Written after the verdict is archived, never as part of it. Archiving what the ledger decided
  // must not depend on the oracle being reachable.
  recordSignatureCheck(evidenceId: string, outcome: SignatureCheck): Promise<void>;
  listVerdictsForBatch(batchId: string): Promise<readonly LedgerComplianceVerdict[]>;
}

interface VerdictRow {
  readonly evidence_id: string;
  readonly batch_id: string;
  readonly evidence_hash: string;
  readonly compliance_outcome: ComplianceOutcome;
  readonly submitted_by_stakeholder_id: string;
  readonly fabric_transaction_id: string;
  readonly ledger_timestamp: Date;
  readonly event_name: ComplianceEventName;
  readonly signature_check: SignatureCheck;
  readonly signature_checked_at: Date | null;
}

function toVerdict(row: VerdictRow): LedgerComplianceVerdict {
  return {
    evidenceId: row.evidence_id,
    batchId: row.batch_id,
    evidenceHash: row.evidence_hash,
    complianceOutcome: row.compliance_outcome,
    submittedByStakeholderId: row.submitted_by_stakeholder_id,
    fabricTransactionId: row.fabric_transaction_id,
    ledgerTimestamp: row.ledger_timestamp.toISOString(),
    eventName: row.event_name,
    signatureCheck: row.signature_check,
    signatureCheckedAt: row.signature_checked_at?.toISOString() ?? null
  };
}

export function createVerdictRepository(pool: Pool): VerdictRepository {
  return {
    async recordVerdict(verdict: ArchivedVerdict): Promise<void> {
      // Upsert rather than insert. A restart replays from the last checkpoint, so the same event
      // can arrive twice, and it carries the same values both times.
      await pool.query(
        `
          INSERT INTO ledger_compliance_verdicts (
            evidence_id, batch_id, evidence_hash, compliance_outcome,
            submitted_by_stakeholder_id, fabric_transaction_id, ledger_timestamp, event_name
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (evidence_id) DO UPDATE
          SET batch_id = EXCLUDED.batch_id,
              evidence_hash = EXCLUDED.evidence_hash,
              compliance_outcome = EXCLUDED.compliance_outcome,
              submitted_by_stakeholder_id = EXCLUDED.submitted_by_stakeholder_id,
              fabric_transaction_id = EXCLUDED.fabric_transaction_id,
              ledger_timestamp = EXCLUDED.ledger_timestamp,
              event_name = EXCLUDED.event_name
        `,
        [
          verdict.evidenceId,
          verdict.batchId,
          verdict.evidenceHash,
          verdict.complianceOutcome,
          verdict.submittedByStakeholderId,
          verdict.fabricTransactionId,
          verdict.ledgerTimestamp,
          verdict.eventName
        ]
      );
    },

    async recordSignatureCheck(evidenceId: string, outcome: SignatureCheck): Promise<void> {
      await pool.query(
        `
          UPDATE ledger_compliance_verdicts
          SET signature_check = $2,
              signature_checked_at = now()
          WHERE evidence_id = $1
        `,
        [evidenceId, outcome]
      );
    },

    async listVerdictsForBatch(batchId: string): Promise<readonly LedgerComplianceVerdict[]> {
      const result = await pool.query<VerdictRow>(
        `
          SELECT * FROM ledger_compliance_verdicts
          WHERE batch_id = $1
          ORDER BY ledger_timestamp, evidence_id
        `,
        [batchId]
      );

      return result.rows.map(toVerdict);
    }
  };
}
