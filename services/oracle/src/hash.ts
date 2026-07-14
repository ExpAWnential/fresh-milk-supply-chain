import { createHash } from "node:crypto";

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function hashCanonicalEvidence(_canonicalJson: string): string {
  // TODO: Ensure canonical JSON is stable before hashing.
  throw new Error("hashCanonicalEvidence is not implemented yet.");
}
