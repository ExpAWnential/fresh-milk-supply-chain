import { createHash } from "node:crypto";

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function hashCanonicalEvidence(canonicalJson: string): string {
  if (!canonicalJson.trim()) {
    throw new Error("Cannot hash empty canonical evidence.");
  }

  return sha256Hex(canonicalJson);
}
