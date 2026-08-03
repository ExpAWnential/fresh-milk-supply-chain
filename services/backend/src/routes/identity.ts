/**
 * Who this backend is, and who else is on the network.
 *
 * Two questions, deliberately separate. The directory is the same from all six ports and is what
 * lets the demo page find them; the identity is different from each one and is what proves a given
 * port really answers as the company the directory claims.
 *
 * Registering a stakeholder means naming the certificate it signs with, and nothing else in the
 * system reports that string. A company reports its own, which is the only one it holds.
 */
import { Router } from "express";
import { ORGANISATIONS, originOf, type Organisation } from "../organisations.js";

// Public directory information only: names, ports and MSP IDs. No certificates, because a process
// only ever reads its own, and no paths on disk.
function entryFor(organisation: Organisation) {
  return {
    name: organisation.name,
    mspId: organisation.mspId,
    peerEndpoint: organisation.peerEndpoint,
    stakeholderId: organisation.stakeholderId,
    origin: originOf(organisation)
  };
}

export interface IdentityRouterDependencies {
  readonly identity: Organisation;
  // Derived once at startup rather than per request. A process whose wallet cannot be read has no
  // business starting at all, since it could not sign anything, so this can never fail here.
  readonly certificateId: string;
}

export function createIdentityRouter({
  identity,
  certificateId
}: IdentityRouterDependencies): Router {
  const router = Router();

  const directory = ORGANISATIONS.map(entryFor);

  router.get("/organisations", (_req, res) => {
    res.json(directory);
  });

  // The same entry, plus the one thing only this process can report. Built from the shared mapper
  // so the page's directory and a company's own answer cannot disagree about what a company
  // publishes.
  router.get("/identity", (_req, res) => {
    res.json({ ...entryFor(identity), certificateId });
  });

  return router;
}
