/** Exposes public consortium identity without wallet paths or private material. */
import { Router } from "express";
import { ORGANISATIONS, originOf, type Organisation } from "../organisations.js";

// Expose public connection details only. Never publish wallet paths or private material.
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
  // Certificate identity was validated before the server started.
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

  // Extend the shared directory shape with this process's certificate ID.
  router.get("/identity", (_req, res) => {
    res.json({ ...entryFor(identity), certificateId });
  });

  return router;
}
