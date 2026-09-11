/**
 * The project's branding, fetched once per mounted widget.
 *
 * ## Why this is a hook and not a prop from `element.ts`
 *
 * `element.ts` already fetches branding, but for a different purpose: it turns
 * the colours into CSS custom properties on the wrapper, before React exists
 * and independently of whether React ever renders. That path has to stay — the
 * loading and error states are branded too, and they draw without a token.
 *
 * What it cannot do is hand a *value* to a component. The catalogue needs three
 * of them (the heading, the hero photograph and the seal), and threading them
 * through the element would mean re-rendering the React root when an
 * unauthenticated fetch resolves. A hook keeps the dependency where it is used.
 *
 * ## Why the response is re-validated here
 *
 * `parseBranding` runs again even though the API already validated on write and
 * on read. These values end up in `src` attributes and in text, and the widget
 * does not get to assume the response came from an API it trusts — the same
 * argument as the comment in `element.ts`. Validation is cheap; a logo URL that
 * turned out to be `javascript:` is not.
 *
 * ## Failure is silent
 *
 * An unbranded catalogue is a cosmetic problem with a correct fallback in the
 * locale file. An error banner about a missing heading would be worse than the
 * missing heading, and there is nothing a physician could do about either.
 */

import { useEffect, useState } from "react";
import { parseBranding, type Branding } from "@ds/domain";

/**
 * In-flight and settled requests, keyed by the pair that identifies them.
 *
 * Without this, every component that wants branding issues its own request:
 * the logo above the catalogue, the logo above the player, and now the hero.
 * They are the same request, it is unauthenticated, and it is on the critical
 * path of the first paint. The cache is module-scoped and never invalidated
 * because branding cannot change within the lifetime of a mounted widget — a
 * rebrand arrives on the next page load, which is also what the API's
 * `cache-control: max-age=300` assumes.
 */
const inFlight = new Map<string, Promise<Branding>>();

/**
 * Empty it. Exported for tests, and called for them automatically (P215-01).
 *
 * A cache that outlives a case is state that lies (§9.8). This one is keyed on
 * (apiBase, projectSlug), which every widget test uses the same two values for
 * — so whether a case pays for the fetch depends on which case ran before it,
 * and a test that waits a fixed number of React commits passes or fails on
 * that. `element.test.ts` did exactly that and went red in CI on a commit that
 * changed nothing but the *order* vitest picked its files in.
 *
 * `vitest.setup.ts` calls this after every case so no test has to remember.
 */
export function clearBrandingCache(): void {
  inFlight.clear();
}

function load(apiBase: string, projectSlug: string): Promise<Branding> {
  /*
   * `\u0000` as the separator, written as an escape and not as the byte.
   *
   * The separator itself is deliberate: a NUL cannot occur in a URL or in a
   * project slug, so no pair of values can collide the way `a` + `b|c` and
   * `a|b` + `c` would under an ordinary delimiter.
   *
   * Writing it **literally** was the mistake, and it cost more than it looks.
   * A file containing a NUL byte is binary to `grep`, which prints "binary
   * file matches" and no lines — so every grep-based tool in this repository
   * silently skipped this file. `scripts/unused-rules.mjs` searches for a
   * rule's callers exactly that way: `parseBranding` has three call sites
   * here and the scan counted none of them (CLAUDE.md §9.1 — the check that
   * silently covers less than it claims).
   */
  const key = `${apiBase}\u0000${projectSlug}`;
  const existing = inFlight.get(key);
  if (existing !== undefined) return existing;

  const request = fetch(new URL("/branding", apiBase), {
    headers: { accept: "application/json", "x-ds-project": projectSlug },
  })
    .then((response) => (response.ok ? response.json() : {}))
    .then((body: unknown) => parseBranding(body))
    .catch(() => ({}) as Branding);

  inFlight.set(key, request);
  return request;
}

export function useBranding(apiBase: string, projectSlug: string): Branding {
  const [branding, setBranding] = useState<Branding>({});

  useEffect(() => {
    if (apiBase === "" || projectSlug === "") return;

    let cancelled = false;
    void load(apiBase, projectSlug).then((value) => {
      if (!cancelled) setBranding(value);
    });

    return () => {
      cancelled = true;
    };
  }, [apiBase, projectSlug]);

  return branding;
}
