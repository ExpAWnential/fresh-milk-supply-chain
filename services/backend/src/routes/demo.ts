/**
 * Read-only support for the demo page.
 *
 * Registering a stakeholder means naming the certificate it signs with, and nothing else in the
 * system reports that string. Without this, setting up a demo would mean copying distinguished
 * names out of a certificate by hand.
 */
import { Router } from "express";
import { DEMO_IDENTITY_NAMES, getDemoIdentity, type DemoIdentity } from "../demoIdentity.js";
import { deriveCertificateId } from "../fabric/certificateId.js";

// The IDs each role is registered under. Kept here rather than in the page so the two cannot
// disagree about who is who.
const STAKEHOLDER_IDS: Record<string, string> = {
  regulator: "regulator-001",
  farm: "farm-001",
  processor: "processor-001",
  logistics: "logistics-001",
  retailer: "retailer-001",
  oracle: "oracle-001"
};

export type CertificateIdReader = (identity: DemoIdentity) => Promise<string>;

export function createDemoRouter(
  readCertificateId: CertificateIdReader = deriveCertificateId
): Router {
  const router = Router();

  router.get("/identities", async (_req, res) => {
    try {
      const identities = await Promise.all(
        DEMO_IDENTITY_NAMES.map(async (role) => ({
          role,
          stakeholderId: STAKEHOLDER_IDS[role],
          certificateId: await readCertificateId(getDemoIdentity(role))
        }))
      );
      res.json(identities);
    } catch (error) {
      // Half a list is worse than none: the page would register some roles and silently skip the
      // rest, leaving a registry nobody can reason about.
      console.error("Could not read the demo certificates.", error);
      res.status(500).json({ error: "the demo certificates could not be read" });
    }
  });

  return router;
}
