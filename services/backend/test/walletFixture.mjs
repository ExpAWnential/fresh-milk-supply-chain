import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The committed self-signed organisation under fixtures/wallet. Everything that has to read a real
// certificate and key off disk points here, so those tests run on a clean checkout rather than
// skipping until somebody has brought the network up.
const walletRoot = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "wallet");

// Shaped like what walletFor() returns, because that is what the gateway takes.
export const FIXTURE_IDENTITY = {
  name: "fixture",
  domain: "fixture.example.com",
  mspId: "FixtureMSP",
  // Nothing listens here. Building a gateway opens no connection, so a peer that does not exist is
  // enough for everything these tests reach.
  peerEndpoint: "localhost:17051",
  stakeholderId: "fixture-001",
  backendPort: 3999,
  userPath: join(walletRoot, "msp"),
  peerHostAlias: "peer0.fixture.example.com",
  peerTlsCaPath: join(walletRoot, "tlsca", "tlsca.fixture.example.com-cert.pem")
};

// The certificate was issued by the fixture's own authority rather than self-signed, so subject and
// issuer differ and a helper that returned one of them twice would be caught.
export const FIXTURE_CERTIFICATE_ID =
  "x509::/C=AU/ST=Victoria/L=Melbourne/OU=client/CN=User1@fixture.example.com" +
  "::/C=AU/ST=Victoria/L=Melbourne/O=fixture.example.com/CN=ca.fixture.example.com";
