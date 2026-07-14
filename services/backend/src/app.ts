import express from "express";
import { batchRouter } from "./routes/batches.js";
import { stakeholderRouter } from "./routes/stakeholders.js";
import { temperatureRouter } from "./routes/temperature.js";

export function createApp() {
  const app = express();

  app.use(express.json());
  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/stakeholders", stakeholderRouter);
  app.use("/batches", batchRouter);
  app.use("/temperature", temperatureRouter);

  return app;
}
