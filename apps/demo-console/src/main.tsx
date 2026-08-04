/** Selects the live console by default and the self-contained simulation when requested. */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { LiveApp } from "./LiveApp";
import { SimApp } from "./SimApp";
import "./styles/global.css";

const sim = new URLSearchParams(location.search).get("mode") === "sim";

createRoot(document.getElementById("root")!).render(
  <StrictMode>{sim ? <SimApp /> : <LiveApp />}</StrictMode>
);
