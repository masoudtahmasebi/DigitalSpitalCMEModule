/**
 * The customer's own words, fetched at mount (P83-03).
 *
 * ## Why this is not `de` with a different import
 *
 * `de` is the platform's wording and stays a module constant, because every
 * component imports it directly and a component that had to thread a locale
 * object through five layers of props would be a rewrite of the whole widget
 * to make one customer's button say something else.
 *
 * So this hook returns the **merged** table — the same shape, the same keys,
 * the same functions — and the components that care take it from context. The
 * ones that do not keep importing `de` and keep rendering the default, which is
 * correct: a screen nobody has reworded should not re-render when the fetch
 * lands.
 *
 * ## Why it fails silently
 *
 * A learner's page must render. If the wording endpoint is unreachable, or
 * answers something unusable, or the customer has never touched it, the answer
 * is the same and it is the right one: the platform's own words. There is no
 * state here in which the widget shows nothing because a *label* could not be
 * loaded.
 *
 * ## Why it is validated again on arrival
 *
 * The API validates on write and again on read, and this validates a third
 * time. That is not superstition: `parseCopyOverrides` is what guarantees the
 * merged table has exactly the shape the components were compiled against, and
 * the widget is the one place where being wrong about that is a blank screen
 * rather than a bad response. It costs one pass over a small object, once.
 */

import { useEffect, useState } from "react";
import { applyCopyOverrides, parseCopyOverrides } from "@ds/domain";
import { COPY_KEYS, de } from "@ds/copy";

export type Copy = typeof de;

/**
 * One request per (host, project) for the lifetime of the page.
 *
 * The same de-duplication `branding.ts` does and for the same reason: a page
 * can host more than one `<ds-lms>`, and two widgets for one project asking two
 * questions with one answer is a request nobody needed.
 */
const inFlight = new Map<string, Promise<Copy>>();

async function load(apiBase: string, projectSlug: string): Promise<Copy> {
  // `\u0000` as the separator, written as an escape. A literal NUL makes the
  // file binary to `grep`, which is how `branding.ts` once hid three call sites
  // from `scripts/unused-rules.mjs` (§9.1).
  const key = `${apiBase}\u0000${projectSlug}`;
  const existing = inFlight.get(key);
  if (existing !== undefined) return existing;

  const request = fetch(new URL("/copy", apiBase), {
    headers: { accept: "application/json", "x-ds-project": projectSlug },
  })
    .then((response) => (response.ok ? response.json() : {}))
    .then((body: unknown) => applyCopyOverrides(de, parseCopyOverrides(body, COPY_KEYS)))
    .catch(() => de);

  inFlight.set(key, request);
  return request;
}

/**
 * The wording to render: the platform's, with the customer's in place of it.
 *
 * Starts at `de` rather than at a loading state, so the first paint has words
 * in it. A widget that rendered empty buttons for one round trip and then
 * filled them in would flicker on every mount for the benefit of the customers
 * who have changed nothing — which is all of them, on day one.
 */
export function useCopy(apiBase: string, projectSlug: string): Copy {
  const [copy, setCopy] = useState<Copy>(de);

  useEffect(() => {
    if (apiBase === "" || projectSlug === "") return;

    let cancelled = false;
    void load(apiBase, projectSlug).then((value) => {
      if (!cancelled) setCopy(value);
    });

    return () => {
      cancelled = true;
    };
  }, [apiBase, projectSlug]);

  return copy;
}
