/**
 * Admin console entry point (P9-01).
 *
 * A plain Vite SPA — no Shadow DOM, unlike the widget. This app owns its whole
 * page, so there is no host stylesheet to isolate from and nothing to isolate
 * the host from.
 */

import { Component, StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "./styles.css";

const container = document.getElementById("root");
if (container === null) throw new Error("no #root element to mount into");

/*
 * The last boundary (P233-01).
 *
 * `Shell` can throw too, and a boundary *inside* the thing that broke catches
 * nothing — so this one wraps everything. It is deliberately plain: no locale
 * lookup, no shared component, nothing that could itself be what failed. A
 * fallback that depends on the code that crashed is not a fallback.
 *
 * German and English side by side rather than through `de`, because reaching
 * the locale module is exactly the kind of thing that might have thrown.
 */
class LastResort extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: Error): void {
    console.error("[ds-admin] the console failed to start", error);
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div style={{ padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
        <h1 style={{ fontSize: "1.125rem", fontWeight: 600 }}>
          Die Verwaltung konnte nicht geladen werden
        </h1>
        <p style={{ marginTop: "0.5rem" }}>
          Bitte laden Sie die Seite neu. Bleibt der Fehler bestehen, wenden Sie sich an
          DigitalSpital.
        </p>
        <p style={{ marginTop: "1rem", color: "#5f6567" }}>
          The administration console failed to load. Please reload the page.
        </p>
      </div>
    );
  }
}

createRoot(container).render(
  <StrictMode>
    <LastResort>
      <App />
    </LastResort>
  </StrictMode>,
);
