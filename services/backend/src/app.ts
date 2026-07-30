/**
 * Assembles the Express app from its routers.
 *
 * Dependencies are passed in rather than constructed here, which is what lets the whole API be
 * exercised without a Fabric network or a database.
 */
import express, { type Express } from "express";
import { createBatchRouter } from "./routes/batches.js";
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
  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/stakeholders", createStakeholderRouter(dependencies.connect));
  app.use("/batches", createBatchRouter(dependencies.connect));
  app.use("/temperature", createTemperatureRouter(dependencies));
  app.use("/public", createPublicRouter(dependencies.readAsRegulator));

  return app;
}
