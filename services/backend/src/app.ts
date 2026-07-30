import express, { type Express } from "express";
import type { TemperatureRepository } from "@fresh-milk/storage";
import { createBatchRouter } from "./routes/batches.js";
import { createPublicRouter, type PublicReader } from "./routes/public.js";
import { createStakeholderRouter } from "./routes/stakeholders.js";
import { createTemperatureRouter } from "./routes/temperature.js";
import type { GatewayConnector } from "./fabric/request.js";
import type { AnchoredEvidenceReader } from "./services/evidenceVerification.js";
import type { Request as ExpressRequest } from "express";

export interface AppDependencies {
  // How a request reaches the ledger. Injected so the routes can be exercised without a network.
  readonly connect: GatewayConnector;
  readonly readAsRegulator: PublicReader;
  readonly temperatureRepository?: TemperatureRepository;
  readonly readerForRequest?: (request: ExpressRequest) => AnchoredEvidenceReader;
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
