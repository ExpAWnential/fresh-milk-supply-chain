/**
 * Stores the regulator's independent archive of verdicts emitted by Fabric.
 *
 * Event writes are idempotent because a listener may replay a block after restart. Signature status
 * is updated separately so a temporary verification failure cannot prevent the verdict being archived.
 */
import type { Pool } from "pg";
import type { ComplianceOutcome } from "./temperatureRepository.js";

export type ComplianceEventName = "TemperatureEvidenceSubmitted" | "ColdChainBreach";

// UNKNOWN means the signature check could not finish. FAILED means it completed and found a problem.
export type SignatureCheck = "PASSED" | "FAILED" | "UNKNOWN";

export interface LedgerComplianceVerdict {
  readonly evidenceId: string;
  readonly batchId: string;
  readonly evidenceHash: string;
  readonly complianceOutcome: ComplianceOutcome;
  readonly submittedByStakeholderId: string;
  readonly fabricTransactionId: string;
  // Preserve the contract timestamp so event replay reproduces the same archive.
  readonly ledgerTimestamp: string;
  readonly eventName: ComplianceEventName;
  // Defaults to UNKNOWN until the regulator's independent check completes.
  readonly signatureCheck: SignatureCheck;
  readonly signatureCheckedAt: string | null;
}

// Signature status is omitted because archiving must not wait for the oracle to answer.
export type ArchivedVerdict = Omit<
  LedgerComplianceVerdict,
  "signatureCheck" | "signatureCheckedAt"
>;

export interface VerdictRepository {
  recordVerdict(verdict: ArchivedVerdict): Promise<void>;
  // Updated separately after the verdict is safely archived.
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

/** Creates an idempotent archive so replaying a Fabric event cannot duplicate its verdict. */
export function createVerdictRepository(pool: Pool): VerdictRepository {
  return {
    async recordVerdict(verdict: ArchivedVerdict): Promise<void> {
      // Event replay is expected, so archive writes are idempotent.
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
