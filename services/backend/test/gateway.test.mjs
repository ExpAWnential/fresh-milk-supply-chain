import assert from "node:assert/strict";
import { copyFile, mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";
import { createFabricGatewayClient, singleFileIn } from "../dist/fabric/gateway.js";
import { FIXTURE_IDENTITY } from "./walletFixture.mjs";

// Building a gateway reads the certificate and private key off disk and parses the key. None of it
// touches the network, so the committed fixture organisation is enough to run the whole thing.

test("a gateway can be built from the wallet material on disk", async () => {
  const client = await createFabricGatewayClient(FIXTURE_IDENTITY);
  try {
    assert.equal(typeof client.submitTransaction, "function");
    assert.equal(typeof client.evaluateTransaction, "function");
    assert.equal(typeof client.close, "function");
  } finally {
    client.close();
  }
});

test("closing twice does not throw, so a failed request cannot leave a broken connection", async () => {
  const client = await createFabricGatewayClient(FIXTURE_IDENTITY);
  client.close();
  assert.doesNotThrow(() => client.close());
});

test("a gateway for an identity with no wallet material fails clearly", async () => {
  await assert.rejects(
    createFabricGatewayClient({
      ...FIXTURE_IDENTITY,
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
    createFabricGatewayClient({ ...FIXTURE_IDENTITY, userPath: root }),
    (error) => !/Expected exactly one file/.test(error.message)
  );

  await writeFile(join(root, "keystore", "a-second-key"), "not a key either");
  await assert.rejects(
    createFabricGatewayClient({ ...FIXTURE_IDENTITY, userPath: root }),
    /Expected exactly one file/
  );
});

// macOS writes .DS_Store into any directory that has been opened in Finder, and the keystore is one
// a developer does look inside. Counting it would make the wallet unreadable on that machine alone,
// with an error about a file count rather than the file.
test("an editor's dotfile alongside the key is not counted as a second file", async () => {
  const root = await mkdtemp(join(tmpdir(), "wallet-dotfile-"));
  await writeFile(join(root, ".DS_Store"), "");
  await writeFile(join(root, "the-only-real-file"), "contents");

  assert.equal(await singleFileIn(root), join(root, "the-only-real-file"));
});

test("an empty directory is reported rather than surfacing later as a missing file", async () => {
  const root = await mkdtemp(join(tmpdir(), "wallet-empty-"));

  await assert.rejects(singleFileIn(root), /Expected exactly one file .*found 0/);
});

// The certificate and key never change while the process runs, so they are read once and kept. The
// cache is keyed on the paths rather than on the organisation name, because material loaded from
// somewhere else must never be handed back for an identity that merely shares a name.
test("wallet material is cached by path, so a renamed identity cannot borrow it", async () => {
  const cached = await createFabricGatewayClient(FIXTURE_IDENTITY);
  cached.close();

  await assert.rejects(
    createFabricGatewayClient({ ...FIXTURE_IDENTITY, userPath: "/nonexistent/msp" }),
    /ENOENT|no such file/
  );
});

// A failed read must not be remembered. Caching the rejection would leave a backend started a
// moment too early permanently unable to sign, with a restart the only way out.
test("a wallet that could not be read is retried rather than cached as broken", async () => {
  const root = await mkdtemp(join(tmpdir(), "wallet-retry-"));
  const identity = { ...FIXTURE_IDENTITY, userPath: root };

  await assert.rejects(createFabricGatewayClient(identity), /ENOENT|no such file/);

  await mkdir(join(root, "signcerts"));
  await mkdir(join(root, "keystore"));
  // Located rather than named, so regenerating the fixture does not break this.
  for (const directory of ["signcerts", "keystore"]) {
    const source = await singleFileIn(join(FIXTURE_IDENTITY.userPath, directory));
    await copyFile(source, join(root, directory, basename(source)));
  }

  const client = await createFabricGatewayClient(identity);
  assert.equal(typeof client.submitTransaction, "function");
  client.close();
});
