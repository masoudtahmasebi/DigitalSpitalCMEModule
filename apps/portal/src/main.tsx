/**
 * Standalone portal entry point (P11-01).
 *
 * A plain Vite SPA, like the admin console. The learner-facing part of the page
 * is `<ds-lms>`, which brings its own closed shadow root — so this shell's
 * Tailwind and the widget's cannot reach each other, on this host exactly as on
 * a customer's WordPress theme.
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
