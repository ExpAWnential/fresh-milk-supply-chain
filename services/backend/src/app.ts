import express from "express";
import { batchRouter } from "./routes/batches.js";
import { publicRouter } from "./routes/public.js";
import { stakeholderRouter } from "./routes/stakeholders.js";
import {
  createTemperatureRouter,
  type TemperatureRouterDependencies
} from "./routes/temperature.js";

export type AppDependencies = TemperatureRouterDependencies;

export function createApp(dependencies: AppDependencies = {}) {
  const app = express();

  app.use(express.json());
  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/stakeholders", stakeholderRouter);
  app.use("/batches", batchRouter);
  app.use("/temperature", createTemperatureRouter(dependencies));
  app.use("/public", publicRouter);

  return app;
}
