import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Pool, QueryResult } from "pg";
import { createDocumentRepository } from "../src/repositories/documentRepository.js";

interface RecordedQuery {
  readonly text: string;
  readonly values?: readonly unknown[];
}

class FakePool {
  readonly queries: RecordedQuery[] = [];
  rows: readonly unknown[] = [];

  async query(text: string, values?: readonly unknown[]): Promise<QueryResult> {
    this.queries.push({ text, values });
    return { rows: this.rows, rowCount: this.rows.length } as QueryResult;
  }
}

describe("document repository", () => {
  it("saves a document with a normalised SHA-256 hash", async () => {
    const pool = new FakePool();
    const repository = createDocumentRepository(pool as unknown as Pool);

    await repository.saveDocument({
      documentId: "DOC-001",
      batchId: "BATCH-001",
      documentType: "QUALITY_CERTIFICATE",
      fileLocation: "documents/certificate.pdf",
      documentHash: "A".repeat(64)
    });

    assert.match(pool.queries[0].text, /INSERT INTO documents/);
    assert.deepEqual(pool.queries[0].values, [
      "DOC-001",
      "BATCH-001",
      "QUALITY_CERTIFICATE",
      "documents/certificate.pdf",
      "a".repeat(64)
    ]);
  });

  it("returns batch documents in repository order", async () => {
    const pool = new FakePool();
    pool.rows = [
      {
        document_id: "DOC-001",
        batch_id: "BATCH-001",
        document_type: "QUALITY_CERTIFICATE",
        file_location: "documents/certificate.pdf",
        document_hash: "b".repeat(64)
      }
    ];
    const repository = createDocumentRepository(pool as unknown as Pool);

    assert.deepEqual(await repository.getDocumentsForBatch("BATCH-001"), [
      {
        documentId: "DOC-001",
        batchId: "BATCH-001",
        documentType: "QUALITY_CERTIFICATE",
        fileLocation: "documents/certificate.pdf",
        documentHash: "b".repeat(64)
      }
    ]);
    assert.match(pool.queries[0].text, /ORDER BY created_at ASC, document_id ASC/);
  });

  it("rejects a non-SHA-256 document hash", async () => {
    const repository = createDocumentRepository(new FakePool() as unknown as Pool);
    await assert.rejects(
      repository.saveDocument({
        documentId: "DOC-001",
        batchId: "BATCH-001",
        documentType: "QUALITY_CERTIFICATE",
        fileLocation: "documents/certificate.pdf",
        documentHash: "not-a-hash"
      }),
      /64-character SHA-256/
    );
  });
});
