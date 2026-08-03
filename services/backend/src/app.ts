/**
 * Assembles the Express app from its routers.
 *
 * Dependencies are passed in rather than constructed here, which is what lets the whole API be
 * exercised without a Fabric network or a database.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Express, type RequestHandler } from "express";
import type { VerdictRepository } from "@fresh-milk/storage";
import { ORGANISATIONS, originOf, type Organisation } from "./organisations.js";
import { createBatchRouter } from "./routes/batches.js";
import { createIdentityRouter } from "./routes/identity.js";
import { createPublicRouter } from "./routes/public.js";
import { createStakeholderRouter } from "./routes/stakeholders.js";
import { createVerdictRouter } from "./routes/verdicts.js";
import {
  createTemperatureRouter,
  type TemperatureRouterDependencies
} from "./routes/temperature.js";

export interface AppDependencies extends TemperatureRouterDependencies {
  readonly identity: Organisation;
  readonly certificateId: string;
  // Only the regulator keeps one. Everyone else answers 503 on the archive route.
  readonly verdictRepository?: VerdictRepository;
}

// The demo page is served by one company's backend and drives all six, so five of every six calls
// it makes are cross-origin. Both spellings of the loopback address are listed, because a browser
// treats them as different origins and opening the page on 127.0.0.1 would otherwise fail every
// cross-company call in a way that looks exactly like the other five backends being down.
const KNOWN_ORIGINS = new Set(
  ORGANISATIONS.flatMap((organisation) => [
    originOf(organisation),
    originOf(organisation).replace("//localhost:", "//127.0.0.1:")
  ])
);

// Anything that is not a read. These are the requests where being wrong about the origin means a
// transaction, not a leak.
const READ_ONLY_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Written out rather than taken from a package, and deliberately not "*". Echoing back only the
// origins this network runs keeps the allowance as narrow as the thing it exists for.
const allowKnownOrigins: RequestHandler = (req, res, next) => {
  const origin = req.header("origin");
  const allowed = origin !== undefined && KNOWN_ORIGINS.has(origin);

  if (allowed) {
    res.setHeader("access-control-allow-origin", origin);
  }
  // The answer differs per origin, so a cache keyed on the URL alone would serve the wrong one.
  res.setHeader("vary", "Origin");

  // POST with a JSON body and PATCH are both preflighted, so without this the browser never sends
  // the real request and the failure looks like the backend being down.
  if (req.method === "OPTIONS") {
    res.setHeader("access-control-allow-methods", "GET, POST, PATCH, OPTIONS");
    res.setHeader("access-control-allow-headers", "content-type");
    res.status(204).end();
    return;
  }

  // Withholding the allow-origin header only stops the caller *reading* the reply. A POST with no
  // body is a simple request, so it is never preflighted and the transaction commits before the
  // browser discards the response: any page open in another tab could suspend a stakeholder.
  // Writes therefore have to be refused outright, not merely made unreadable.
  //
  // A request with no Origin at all is not from a browser. curl and the oracle land here, and they
  // were never the thing at risk.
  if (!READ_ONLY_METHODS.has(req.method) && origin !== undefined && !allowed) {
    res.status(403).json({ error: "this backend does not accept requests from that origin" });
    return;
  }

  next();
};

export function createApp(dependencies: AppDependencies): Express {
  const app = express();

  // Before the routers and before the body parser, so a preflight is answered without either.
  app.use(allowKnownOrigins);
  app.use(express.json());

  // Resolves the same from src/ under tsx and from dist/ after a build, since both sit one level
  // below the package root.
  app.use(express.static(join(dirname(fileURLToPath(import.meta.url)), "..", "public")));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use(createIdentityRouter(dependencies));
  app.use("/stakeholders", createStakeholderRouter(dependencies.connect));
  app.use("/batches", createBatchRouter(dependencies.connect));
  app.use("/temperature", createTemperatureRouter(dependencies));
  app.use("/verdicts", createVerdictRouter(dependencies.connect, dependencies.verdictRepository));
  app.use("/public", createPublicRouter(dependencies.connect));

  return app;
}
