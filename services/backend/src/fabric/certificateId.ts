/**
 * Reproduces the identity string Fabric derives from a certificate, without connecting to a peer.
 *
 * Registering a stakeholder means naming the certificate it will sign with, and the only place that
 * string otherwise exists is inside a transaction the caller has not made yet. Deriving it here is
 * what lets the demo register every role without anyone copying distinguished names by hand.
 */
import { X509Certificate } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { singleFileIn } from "./gateway.js";

// Fabric writes the distinguished name in OpenSSL's one-line form: a leading slash, then each
// component separated by slashes. Node reports the same components in the same order, newline
// separated, so only the separator differs.
function oneLine(distinguishedName: string): string {
  return `/${distinguishedName.split("\n").join("/")}`;
}

export async function deriveCertificateId(identity: {
  readonly userPath: string;
}): Promise<string> {
  const certificatePath = await singleFileIn(join(identity.userPath, "signcerts"));
  const certificate = new X509Certificate(await readFile(certificatePath));
  return `x509::${oneLine(certificate.subject)}::${oneLine(certificate.issuer)}`;
}
