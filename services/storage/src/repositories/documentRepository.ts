import type { Pool } from "pg";

export interface StoredDocument {
  readonly documentId: string;
  readonly batchId: string;
  readonly documentType: string;
  readonly fileLocation: string;
  readonly documentHash: string;
}

export interface DocumentRepository {
  saveDocument(document: StoredDocument): Promise<void>;
  getDocumentsForBatch(batchId: string): Promise<readonly StoredDocument[]>;
}

interface DocumentRow {
  readonly document_id: string;
  readonly batch_id: string;
  readonly document_type: string;
  readonly file_location: string;
  readonly document_hash: string;
}

function requireText(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} must not be empty.`);
  }
  return trimmed;
}

export function createDocumentRepository(pool: Pool): DocumentRepository {
  return {
    async saveDocument(document): Promise<void> {
      if (!/^[a-f0-9]{64}$/i.test(document.documentHash)) {
        throw new Error("Document hash must be a 64-character SHA-256 hexadecimal value.");
      }

      await pool.query(
        `INSERT INTO documents (
           document_id, batch_id, document_type, file_location, document_hash
         ) VALUES ($1, $2, $3, $4, $5)`,
        [
          requireText(document.documentId, "Document ID"),
          requireText(document.batchId, "Batch ID"),
          requireText(document.documentType, "Document type"),
          requireText(document.fileLocation, "Document file location"),
          document.documentHash.toLowerCase()
        ]
      );
    },

    async getDocumentsForBatch(batchId): Promise<readonly StoredDocument[]> {
      const result = await pool.query<DocumentRow>(
        `SELECT document_id, batch_id, document_type, file_location, document_hash
         FROM documents
         WHERE batch_id = $1
         ORDER BY created_at ASC, document_id ASC`,
        [requireText(batchId, "Batch ID")]
      );
      return result.rows.map((row) => ({
        documentId: row.document_id,
        batchId: row.batch_id,
        documentType: row.document_type,
        fileLocation: row.file_location,
        documentHash: row.document_hash
      }));
    }
  };
}
