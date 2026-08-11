/**
 * The console's address bar (P42-01).
 *
 * ## What was wrong
 *
 * `view` was React state and nothing else. Every screen in the console lived at
 * the same URL, which costs three things a person notices immediately:
 *
 * - **Back does nothing useful.** The browser's back button left the console
 *   entirely, because as far as the browser was concerned nothing had happened
 *   since the page loaded.
 * - **Reload loses your place.** Somebody deep in a course's quiz editor who
 *   pressed F5 landed on the course list.
 * - **Nothing can be linked.** "Look at this course" is a screenshot and a
 *   sentence of directions rather than a URL.
 *
 * ## Why the fragment, and why by hand
 *
 * The fragment (`#/fortbildungen/adhs/quiz`) rather than a path, because the
 * console is a static bundle behind a server that knows one route: any deep
 * path would 404 on reload unless the server were taught to rewrite, and the
 * whole point here is that reload works.
 *
 * By hand rather than a router library, because this is a closed union of ten
 * screens with at most two parameters, and `@ds/admin` has no routing
 * dependency today. A router would be a dependency, a provider and a set of
 * idioms in exchange for `encode`/`decode` — which are forty lines and, being
 * pure, are exhaustively testable in a way a `<Route>` tree is not.
 *
 * ## German in the URL
 *
 * `#/fortbildungen`, not `#/courses`. The console's copy is authoritative and
 * German (CLAUDE.md §5); an operator sending a colleague a link should see the
 * word they use for the thing. The `kind` values stay English because they are
 * code.
 */

import { stripTrailingSlashes } from "@ds/domain";

/** Mirrors the `CourseTab` union in `App.tsx`. */
export type RouteCourseTab =
  "settings" | "presentation" | "structure" | "experts" | "evaluation" | "participants";

export type Route =
  | { kind: "courses" }
  | { kind: "new-course" }
  | { kind: "organisation" }
  | { kind: "branding" }
  | { kind: "customers" }
  | { kind: "participants" }
  | { kind: "learners" }
  | { kind: "certificates" }
  | { kind: "staff" }
  | { kind: "security" }
  | { kind: "course"; slug: string; tab: RouteCourseTab };

/**
 * One table, read in both directions.
 *
 * Two lists would be two places to add a screen, and the one that gets
 * forgotten is the decode — which fails silently by falling back to the course
 * list, so a link somebody sent would open the wrong page rather than error.
 */
const SEGMENTS: Readonly<Record<Exclude<Route["kind"], "course">, string>> = {
  courses: "fortbildungen",
  "new-course": "fortbildungen/neu",
  organisation: "organisation",
  branding: "erscheinungsbild",
  customers: "kunden",
  participants: "zugaenge",
  learners: "teilnehmende",
  certificates: "bescheinigungen",
  staff: "konten",
  security: "sicherheit",
};

const TABS: readonly RouteCourseTab[] = [
  "structure",
  "presentation",
  "settings",
  "experts",
  "evaluation",
  "participants",
];

/** The fragment for a route, including the leading `#`. */
export function encode(route: Route): string {
  if (route.kind === "course") {
    return `#/fortbildungen/${encodeURIComponent(route.slug)}/${route.tab}`;
  }
  return `#/${SEGMENTS[route.kind]}`;
}

/**
 * The route a fragment names, or `undefined` if it names none.
 *
 * `undefined` rather than a default, so the caller decides — the app falls back
 * to the course list, and the password-reset screen (which owns
 * `#passwort-neu?…`) is checked before this is consulted at all.
 */
export function decode(hash: string): Route | undefined {
  // `stripTrailingSlashes` rather than `\/+$`, which is quadratic on a long
  // run of slashes and reads a value straight out of the address bar (P49-01).
  const path = stripTrailingSlashes(hash.replace(/^#\/?/u, ""));
  if (path === "") return undefined;

  // A course, and only if its tab is one that exists: `#/fortbildungen/x/quatsch`
  // is a bad link, not a request for a tab to be invented.
  const course = /^fortbildungen\/([^/]+)\/([a-z]+)$/u.exec(path);
  if (course !== null) {
    const slug = decodeURIComponent(course[1] ?? "");
    const tab = course[2] as RouteCourseTab;
    if (slug !== "" && slug !== "neu" && TABS.includes(tab)) {
      return { kind: "course", slug, tab };
    }
    return undefined;
  }

  for (const [kind, segment] of Object.entries(SEGMENTS)) {
    if (segment === path) return { kind } as Route;
  }
  return undefined;
}
