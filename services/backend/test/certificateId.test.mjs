import assert from "node:assert/strict";
import test from "node:test";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { deriveCertificateId } from "../dist/fabric/certificateId.js";

const organizations =
  process.env.FABRIC_ORGANIZATIONS_PATH ??
  join(homedir(), "fabric-samples", "test-network", "organizations", "peerOrganizations");

const farmMsp = join(organizations, "org1.example.com", "users", "User2@org1.example.com", "msp");

// The certificates the network generated are the only fixture worth testing against, because the
// point of this helper is matching what Fabric itself reports. A machine that has never started the
// network has nothing to compare with, so those runs skip rather than fail.
async function networkIsGenerated() {
  try {
    await access(join(farmMsp, "signcerts"));
    return true;
  } catch {
    return false;
  }
}

test("the derived ID matches the form Fabric stores on the ledger", async (t) => {
  if (!(await networkIsGenerated())) {
    t.skip("Fabric test-network crypto material is not generated");
    return;
  }

  assert.equal(
    await deriveCertificateId({ userPath: farmMsp }),
    "x509::/C=US/ST=California/L=San Francisco/OU=client/CN=User2@org1.example.com" +
      "::/C=US/ST=California/L=San Francisco/O=org1.example.com/CN=ca.org1.example.com"
  );
});

test("a directory holding no certificate is reported rather than guessed at", async () => {
  await assert.rejects(
    deriveCertificateId({ userPath: join(organizations, "does-not-exist") }),
    // Either the directory is absent or it holds nothing; both must surface, never a partial ID.
    (error) => error instanceof Error
  );
});
