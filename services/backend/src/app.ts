/** Assembles the API while keeping ledger and storage dependencies explicit for testing. */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Express, type RequestHandler } from "express";
import type { VerdictRepository } from "@fresh-milk/storage";
import { ORGANISATIONS, originOf, type Organisation } from "./organisations.js";
import { createBatchRouter } from "./routes/batches.js";
import { createIdentityRouter } from "./routes/identity.js";
import { createPublicRouter } from "./routes/public.js";
import { createSensorRouter } from "./routes/sensors.js";
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

// The browser client calls all six backends. Browsers treat the two loopback spellings as distinct origins.
const KNOWN_ORIGINS = new Set(
  ORGANISATIONS.flatMap((organisation) => [
    originOf(organisation),
    originOf(organisation).replace("//localhost:", "//127.0.0.1:")
  ])
);

const READ_ONLY_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const allowKnownOrigins: RequestHandler = (req, res, next) => {
  const origin = req.header("origin");
  const allowed = origin !== undefined && KNOWN_ORIGINS.has(origin);

  if (allowed) {
    res.setHeader("access-control-allow-origin", origin);
  }
  // CORS responses vary by request origin.
  res.setHeader("vary", "Origin");

  if (req.method === "OPTIONS") {
    res.setHeader("access-control-allow-methods", "GET, POST, PATCH, OPTIONS");
    res.setHeader("access-control-allow-headers", "content-type");
    res.status(204).end();
    return;
  }

  // Reject unknown browser writes outright. CORS headers alone would not prevent a simple POST.
  // Non-browser clients omit Origin and remain allowed.
  if (!READ_ONLY_METHODS.has(req.method) && origin !== undefined && !allowed) {
    res.status(403).json({ error: "this backend does not accept requests from that origin" });
    return;
  }

  next();
};

/** Creates the HTTP application without opening network or database connections at import time. */
export function createApp(dependencies: AppDependencies): Express {
  const app = express();

  app.use(allowKnownOrigins);
  app.use(express.json());

  app.use(express.static(join(dirname(fileURLToPath(import.meta.url)), "..", "public")));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use(createIdentityRouter(dependencies));
  app.use("/stakeholders", createStakeholderRouter(dependencies.connect));
  app.use("/sensors", createSensorRouter(dependencies.connect));
  app.use("/batches", createBatchRouter(dependencies.connect));
  app.use("/temperature", createTemperatureRouter(dependencies));
  app.use("/verdicts", createVerdictRouter(dependencies.connect, dependencies.verdictRepository));
  app.use("/public", createPublicRouter(dependencies.connect));

  return app;
}
