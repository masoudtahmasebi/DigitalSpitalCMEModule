/**
 * The screen that a thrown render error leaves behind (P233-01).
 *
 * ## The defect
 *
 * There was no error boundary anywhere in the console —
 * `grep -rn "componentDidCatch\|getDerivedStateFromError" apps/admin/src`
 * returned nothing. React's behaviour without one is to unmount the **whole
 * tree**, so any render-time throw on any screen left an operator looking at a
 * blank white page.
 *
 * That is the worst answer the console can give, and not only because it says
 * nothing. It says nothing *in the shape of something else*: a blank page is
 * what a failed deploy looks like, what an expired session looked like before
 * P40, and what a wrong URL looks like. So the first thing it costs is the
 * hour somebody spends checking the server (§9.9 — "which build and which
 * data?"), for a fault that is in the bundle they already have.
 *
 * ## Two boundaries, not one, and why
 *
 * **Per screen**, inside `Shell`: one broken screen keeps the app bar, the
 * sidebar and the customer picker, so the operator can go somewhere else. That
 * is what the review meant by *route-level* — a failure that is the size of the
 * thing that failed.
 *
 * **At the root**, in `main.tsx`: `Shell` itself can throw, and a boundary
 * inside the thing that broke catches nothing. This one is deliberately plain —
 * no `de` lookup, no shared component, nothing that could be the thing that
 * threw. A boundary whose fallback depends on the code that failed is not a
 * boundary.
 *
 * ## What it does not do
 *
 * It does not report anywhere. There is no client-side error endpoint on this
 * platform and inventing one is a decision with a GDPR shape — a stack trace
 * from an operator's browser is personal data about that operator's session —
 * so it is `docs/show-stoppers.md`'s kind of question rather than mine (§7).
 * The message therefore says what a person can do, which is reload, and names
 * the build so a report to DigitalSpital identifies the bundle.
 */

import { Component, type ErrorInfo, type ReactNode } from "react";
import { de } from "../locale/de.js";
import { buildCommit } from "../config.js";
import { Button, Notice } from "./ui.js";

interface Props {
  children: ReactNode;
  /**
   * Resets the boundary when it changes — the route key, at the screen level.
   *
   * Without it a screen that threw once stays broken after the operator
   * navigates away and back, because the boundary's state outlives the
   * children it is wrapping. That is the same defect as §9.8's "a place you
   * cannot get back to", produced by the thing meant to help.
   */
  resetKey?: string | undefined;
}

interface State {
  failed: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidUpdate(previous: Props): void {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) {
      this.setState({ failed: false });
    }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    /*
     * The console is the only place this goes, and that is deliberate rather
     * than unfinished — see the header. It is also the one place a developer
     * looking over an operator's shoulder will think to look.
     */
    console.error("[ds-admin] a screen failed to render", error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <Notice tone="error" title={de.error.crashTitle}>
        <p className="mt-1">{de.error.crashBody}</p>
        <p className="mt-2 text-xs opacity-80">
          {de.error.crashBuild(buildCommit() ?? "unknown")}
        </p>
        <div className="mt-3">
          <Button variant="secondary" onClick={() => window.location.reload()}>
            {de.error.crashReload}
          </Button>
        </div>
      </Notice>
    );
  }
}
