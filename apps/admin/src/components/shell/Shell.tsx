/**
 * The frame every console screen renders inside.
 *
 * Moved out of `App.tsx` unchanged. What it does has not been altered in this
 * commit; what has changed is that the top bar is now a component with its own
 * tests rather than sixty lines of JSX in the middle of a file that also held
 * the router.
 *
 * ## The one thing this file decides
 *
 * Whether the console is signed in — and it decides it from `onSignOut` being
 * present, which is how it has always worked and is worth naming because it is
 * not obvious. Signed out there is no sidebar, no scope and no session
 * controls, and the content is centred in a narrow column: a lone form in a
 * full screen is the one case where the column *is* the layout.
 *
 * Signed in there is no width cap at all (P104-02). `max-w-6xl` centred every
 * screen in a 72rem column, which on a wide monitor left a band of empty grey
 * on both sides of a *table* — and a table is the one thing that genuinely
 * wants the width, because the alternative is truncated titles and a horizontal
 * scrollbar. P100-01 capped the things that should be capped: prose at
 * `max-w-3xl`, form fields at `max-w-2xl`, each where it is rendered.
 *
 * ## The sidebar's open state is not here
 *
 * On a narrow screen the sidebar collapses (P30-02), and `md:flex` originally
 * put it *above* the content rather than beside it — so on a phone every screen
 * opened with eleven navigation buttons and the operator scrolled past all of
 * them to reach the thing they had just navigated to.
 *
 * The open/closed state lives in `Console`, because the thing that has to close
 * the menu is a navigation click, and those buttons are built there. Passing a
 * callback down and having this file guess when a click inside `nav` was a
 * navigation would be the same state in two places.
 */

import type { ReactNode } from "react";
import { de } from "../../locale/de.js";
import { buildCommit, buildVersion } from "../../config.js";
import { BuildFooter } from "../BuildFooter.js";
import { TopBar } from "./TopBar.js";
import { ErrorBoundary } from "../ErrorBoundary.js";

export function Shell(props: {
  children: ReactNode;
  /**
   * Where the build footer asks the API for its commit. Undefined before the
   * configuration has been read — the footer copes, and still reports this
   * bundle's own build.
   */
  apiBase?: string | undefined;
  operator?: string;
  onSignOut?: () => void;
  /** The navigation column. Absent before sign-in, when there is nowhere to go. */
  nav?: ReactNode;
  /** Scope controls for the app bar — the customer picker. */
  scope?: ReactNode;
  menuOpen?: boolean;
  onToggleMenu?: () => void;
  /**
   * Which screen is being shown, so the per-screen boundary resets when the
   * operator navigates. Any stable string identifying the destination.
   */
  screenKey?: string;
}) {
  const signedIn = props.onSignOut !== undefined;
  const menuOpen = props.menuOpen ?? false;

  return (
    <div className="min-h-screen bg-[color:var(--ds-admin-surface)] md:flex">
      {signedIn ? (
        <aside
          className={`shrink-0 bg-[color:var(--ds-admin-ink)] md:block md:min-h-screen md:w-64 ${
            menuOpen ? "block" : "hidden"
          }`}
        >
          <div className="flex items-center gap-2.5 px-4 py-4">
            <span
              aria-hidden
              className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-500 text-xs font-bold text-white shadow-sm"
            >
              DS
            </span>
            <span className="truncate text-sm font-semibold text-white">
              {de.appShort}
            </span>
          </div>
          {props.nav}
        </aside>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          signedIn={signedIn}
          operator={props.operator}
          onSignOut={props.onSignOut}
          scope={props.scope}
          menuOpen={menuOpen}
          onToggleMenu={props.onToggleMenu}
        />

        <main className="min-w-0 flex-1 p-5 sm:p-6">
          <div className={signedIn ? "" : "mx-auto max-w-md pt-12"}>
            {/*
             * One broken screen keeps the app bar, the sidebar and the customer
             * picker, so the operator can go somewhere else (P233-01). Without
             * it a render-time throw anywhere unmounted the whole tree and left
             * a blank page — which looks exactly like a failed deploy.
             *
             * `resetKey` is the screen, so navigating away from a screen that
             * threw and back to it tries again. Without that the boundary's own
             * state outlives the children it wraps, and the fix produces §9.8's
             * defect: a place you cannot get back to.
             */}
            <ErrorBoundary resetKey={props.screenKey}>{props.children}</ErrorBoundary>
          </div>
        </main>

        {/* Rendered here rather than passed in at each of the five call sites,
            so it cannot be forgotten on one — and specifically not on the
            misconfigured and signed-out branches, which are where "which build
            is this?" is most often asked. `apiBase` is undefined on the
            misconfigured branch; the footer then shows this bundle's commit and
            `unknown` for the API, which is the true answer. */}
        <BuildFooter
          apiBase={props.apiBase}
          commit={buildCommit()}
          version={buildVersion()}
        />
      </div>
    </div>
  );
}
