/**
 * Ambient state, reset after every case — all of it, automatically (P215-01).
 *
 * ## The failure this exists to end
 *
 * `element.test.ts` waits a fixed number of React commits for the catalogue to
 * appear (`settle()`), then looks for a button. Whether five commits is enough
 * depends on whether `useBranding`'s module-scoped cache already holds an entry
 * for this test's `(apiBase, projectSlug)` — a cached branding resolves in
 * fewer turns than a fetched one. That cache is keyed on two values every
 * widget test uses, and nothing emptied it between cases.
 *
 * So the suite's result depended on the **order vitest chose its files in**,
 * which is a heuristic over file size and previous durations — it differs
 * between a laptop and a CI runner, and it changed the day a new test file was
 * added. The suite went red in CI on a commit that touched none of the code
 * involved, and was green locally six runs in a row. It reproduces with
 * `--sequence.shuffle`.
 *
 * ## Why a setup file and not an `afterEach` in the file that broke
 *
 * Because CLAUDE.md §9.8 has already been learned twice here — `localStorage`
 * in P22-08, the jsdom URL in P42-01 — and both times the fix was applied to
 * the store that broke rather than to all of them. *"Reset every ambient store
 * in `afterEach`, not only the one that broke."*
 *
 * A test that has to remember is a test that will forget. This runs for every
 * case in the package, so a cache added later joins by being listed here once.
 *
 * ## What belongs here
 *
 * Anything module-scoped and mutable that survives a case: the two request
 * caches, the jsdom URL, `localStorage`. Not React state, which dies with the
 * tree, and not the token cache in `cachingProvider` — that one lives in a
 * closure created per provider, so each test already gets its own.
 */

import { afterEach } from "vitest";
import { clearBrandingCache } from "./src/branding.js";
import { clearCopyCache } from "./src/copy.js";

afterEach(() => {
  clearBrandingCache();
  clearCopyCache();

  /*
   * The address, which P42-01 recorded leaking between cases and surfacing as
   * "Neue Fortbildung is not on the page" — a failure attributed to the wrong
   * code entirely. The widget reads and writes `location.hash`, so a case that
   * navigates leaves the next one somewhere it never asked to be.
   */
  if (window.location.hash !== "") {
    window.history.replaceState(null, "", window.location.pathname);
  }

  // P22-08's store. Wrapped because jsdom can be configured without it and a
  // reset that throws would fail every case for a reason unrelated to any of
  // them.
  try {
    window.localStorage.clear();
    window.sessionStorage.clear();
  } catch {
    // No storage in this environment; nothing to reset.
  }
});
