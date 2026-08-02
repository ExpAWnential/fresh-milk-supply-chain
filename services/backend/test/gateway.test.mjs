import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createFabricGatewayClient } from "../dist/fabric/gateway.js";
import { getDemoIdentity } from "../dist/demoIdentity.js";

// Building a gateway reads the certificate and private key off disk and parses the key. None of
// that needs the network to be running, but it does need the wallet material the network
// generates, so the suite skips where that is absent.
const regulator = getDemoIdentity("regulator");
const walletPresent = existsSync(regulator.userPath) && existsSync(regulator.peerTlsCaPath);

test(
  "a gateway can be built from the wallet material on disk",
  { skip: walletPresent ? false : "Fabric wallet material is not present" },
  async () => {
    const client = await createFabricGatewayClient(regulator);
    try {
      assert.equal(typeof client.submitTransaction, "function");
      assert.equal(typeof client.evaluateTransaction, "function");
      assert.equal(typeof client.close, "function");
    } finally {
      client.close();
    }
  }
);

test(
  "closing twice does not throw, so a failed request cannot leave a broken connection",
  { skip: walletPresent ? false : "Fabric wallet material is not present" },
  async () => {
    const client = await createFabricGatewayClient(regulator);
    client.close();
    assert.doesNotThrow(() => client.close());
  }
);

test("a gateway for an identity with no wallet material fails clearly", async () => {
  await assert.rejects(
    createFabricGatewayClient({
      ...regulator,
      userPath: "/nonexistent/msp",
      peerTlsCaPath: "/nonexistent/tlsca.pem"
    }),
    /ENOENT|no such file/
  );
});

test("wallet material is located without relying on Fabric's generated file names", async () => {
  const root = await mkdtemp(join(tmpdir(), "wallet-"));
  await mkdir(join(root, "signcerts"));
  await mkdir(join(root, "keystore"));
  await writeFile(join(root, "signcerts", "some-generated-name.pem"), "not a certificate");
  await writeFile(join(root, "keystore", "another-generated-name"), "not a key");

  // Both directories hold exactly one file, so the lookup succeeds and the failure comes later,
  // when the contents turn out not to be a usable key.
  await assert.rejects(
    createFabricGatewayClient({ ...regulator, userPath: root }),
    (error) => !/Expected exactly one file/.test(error.message)
  );

  await writeFile(join(root, "keystore", "a-second-key"), "not a key either");
  await assert.rejects(
    createFabricGatewayClient({ ...regulator, userPath: root }),
    /Expected exactly one file/
  );
});
