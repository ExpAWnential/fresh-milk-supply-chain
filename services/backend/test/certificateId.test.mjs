import assert from "node:assert/strict";
import test from "node:test";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { deriveCertificateId } from "../dist/fabric/certificateId.js";
import { findOrganisation, walletFor } from "../dist/organisations.js";
import { config } from "../dist/config.js";
import { FIXTURE_IDENTITY, FIXTURE_CERTIFICATE_ID } from "./walletFixture.mjs";

// Resolved the same way the backend resolves it, rather than rebuilt here. A second copy of the
// path logic would keep passing after the real one moved, which is exactly what it must not do.
const farm = walletFor(findOrganisation("farm"), config.fabricOrganizationsPath);

// The committed fixture is what makes this run everywhere. Its certificate was issued by the
// fixture's own authority rather than self-signed, so subject and issuer differ and a helper that
// reported one of them twice would be caught.
test("the derived ID is the subject and issuer, each in OpenSSL's one-line form", async () => {
  assert.equal(await deriveCertificateId(FIXTURE_IDENTITY), FIXTURE_CERTIFICATE_ID);
});

// Node reports the distinguished name newline separated and Fabric writes it slash separated, so
// the separator is the whole of the transformation and the only thing that can be wrong.
test("no newline survives into the ID, which the registry stores as a single line", async () => {
  const derived = await deriveCertificateId(FIXTURE_IDENTITY);

  assert.doesNotMatch(derived, /\n/);
  assert.equal(derived.split("::").length, 3);
  assert.ok(derived.startsWith("x509::/"));
});

// The fixture proves the transformation. Only the certificates the network generated prove it
// still matches what Fabric itself puts on the ledger, so this runs where they exist.
async function networkIsGenerated() {
  try {
    await access(join(farm.userPath, "signcerts"));
    return true;
  } catch {
    return false;
  }
}

test("the derived ID matches the form Fabric stores on the ledger", async (t) => {
  if (!(await networkIsGenerated())) {
    t.skip("network crypto material is not generated");
    return;
  }

  assert.equal(
    await deriveCertificateId(farm),
    "x509::/C=US/ST=California/L=San Francisco/OU=client/CN=User1@farm.example.com" +
      "::/C=US/ST=California/L=San Francisco/O=farm.example.com/CN=ca.farm.example.com"
  );
});

test("a directory holding no certificate is reported rather than guessed at", async () => {
  await assert.rejects(
    deriveCertificateId({ userPath: join(FIXTURE_IDENTITY.userPath, "does-not-exist") }),
    // Either the directory is absent or it holds nothing; both must surface, never a partial ID.
    (error) => error instanceof Error
  );
});
