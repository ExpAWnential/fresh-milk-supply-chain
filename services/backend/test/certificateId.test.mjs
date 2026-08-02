import assert from "node:assert/strict";
import test from "node:test";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { deriveCertificateId } from "../dist/fabric/certificateId.js";
import { getDemoIdentity } from "../dist/demoIdentity.js";

// Resolved the same way the backend resolves it, rather than rebuilt here. A second copy of the
// path logic would keep passing after the real one moved, which is exactly what it must not do.
const farm = getDemoIdentity("farm");

// The certificates the network generated are the only fixture worth testing against, because the
// point of this helper is matching what Fabric itself reports. A machine that has never started the
// network has nothing to compare with, so those runs skip rather than fail.
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
    deriveCertificateId({ userPath: join(farm.userPath, "does-not-exist") }),
    // Either the directory is absent or it holds nothing; both must surface, never a partial ID.
    (error) => error instanceof Error
  );
});
