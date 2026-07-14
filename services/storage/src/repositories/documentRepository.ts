import { Pool } from "pg";

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

export function createDocumentRepository(_pool: Pool): DocumentRepository {
  // TODO: Persist supporting batch documents and their hashes.
  throw new Error("createDocumentRepository is not implemented yet.");
}
