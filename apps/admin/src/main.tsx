/**
 * Admin console entry point (P9-01).
 *
 * A plain Vite SPA — no Shadow DOM, unlike the widget. This app owns its whole
 * page, so there is no host stylesheet to isolate from and nothing to isolate
 * the host from.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "./styles.css";

const container = document.getElementById("root");
if (container === null) throw new Error("no #root element to mount into");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
