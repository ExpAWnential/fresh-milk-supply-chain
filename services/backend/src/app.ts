/**
 * Assembles the Express app from its routers.
 *
 * Dependencies are passed in rather than constructed here, which is what lets the whole API be
 * exercised without a Fabric network or a database.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Express } from "express";
import { createBatchRouter } from "./routes/batches.js";
import { createDemoRouter } from "./routes/demo.js";
import { createPublicRouter, type PublicReader } from "./routes/public.js";
import { createStakeholderRouter } from "./routes/stakeholders.js";
import {
  createTemperatureRouter,
  type TemperatureRouterDependencies
} from "./routes/temperature.js";

export interface AppDependencies extends TemperatureRouterDependencies {
  // Consumers hold no network identity, so the public view reads the ledger on their behalf.
  readonly readAsRegulator: PublicReader;
}

export function createApp(dependencies: AppDependencies): Express {
  const app = express();

  app.use(express.json());

  // Resolves the same from src/ under tsx and from dist/ after a build, since both sit one level
  // below the package root.
  app.use(express.static(join(dirname(fileURLToPath(import.meta.url)), "..", "public")));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/demo", createDemoRouter());
  app.use("/stakeholders", createStakeholderRouter(dependencies.connect));
  app.use("/batches", createBatchRouter(dependencies.connect));
  app.use("/temperature", createTemperatureRouter(dependencies));
  app.use("/public", createPublicRouter(dependencies.readAsRegulator));

  return app;
}
