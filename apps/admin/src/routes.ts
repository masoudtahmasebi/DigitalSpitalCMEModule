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
  | { kind: "copy" }
  | { kind: "media" }
  | { kind: "punktemeldungen" }
  | { kind: "customers" }
  | { kind: "participants" }
  | { kind: "learners" }
  | { kind: "certificates" }
  | { kind: "staff" }
  | { kind: "security" }
  | {
      kind: "course";
      slug: string;
      tab: RouteCourseTab;
      /**
       * The quiz open under the structure tab, if any (P74-06).
       *
       * A quiz is a level below the tabs — a content, in a chapter, in a
       * module — so it is not a tab of its own. It was held in React state and
       * nowhere else, which is the defect this whole file exists to fix, one
       * level deeper than P42-01 reached: this file's own header names "somebody
       * deep in a course's quiz editor who pressed F5" as the motivating case,
       * and the fix stopped at the tab. Reported as _"when in here i added a
       * question, i can not easily go back to the inhalt darstellung"_ — because
       * Back left the console rather than closing the quiz.
       */
      quizContentId?: string;
    };

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
  // German in the URL, like every other screen: an operator sending a
  // colleague a link should see the word they use for the thing.
  copy: "texte",
  media: "mediathek",
  customers: "kunden",
  participants: "zugaenge",
  learners: "teilnehmende",
  certificates: "bescheinigungen",
  // The Punktemeldung queue (P110-01), beside the certificates it produces.
  punktemeldungen: "punktemeldungen",
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
    const course = `#/fortbildungen/${encodeURIComponent(route.slug)}/${route.tab}`;
    return route.quizContentId === undefined
      ? course
      : `${course}/quiz/${encodeURIComponent(route.quizContentId)}`;
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

  /*
   * A course, and only if its tab is one that exists: `#/fortbildungen/x/quatsch`
   * is a bad link, not a request for a tab to be invented.
   *
   * The optional `/quiz/<contentId>` tail is the one level below a tab
   * (P74-06). Its id is not validated as a uuid: this decides *which screen*,
   * and whether a content exists is the API's answer to the request the screen
   * then makes — a second opinion here would produce a "not found" the server
   * never said.
   *
   * Split on `/` rather than matched by one pattern. The pattern that expressed
   * this had an optional group after a greedy one and backtracks on input built
   * to make it — reading a value straight out of the address bar, which is the
   * same trap `stripTrailingSlashes` exists for (P49-01).
   */
  const parts = path.split("/");
  if (parts[0] === "fortbildungen" && (parts.length === 3 || parts.length === 5)) {
    const slug = decodeURIComponent(parts[1] ?? "");
    const tab = (parts[2] ?? "") as RouteCourseTab;
    const hasQuiz = parts.length === 5;
    if (hasQuiz && parts[3] !== "quiz") return undefined;

    const quizContentId = hasQuiz ? decodeURIComponent(parts[4] ?? "") : undefined;
    if (slug !== "" && slug !== "neu" && TABS.includes(tab) && quizContentId !== "") {
      return {
        kind: "course",
        slug,
        tab,
        // Spread rather than assigned: `exactOptionalPropertyTypes` makes
        // "absent" and "present and undefined" different values, and only the
        // first round-trips back through `encode` to the URL that was decoded.
        ...(quizContentId === undefined ? {} : { quizContentId }),
      };
    }
    return undefined;
  }

  for (const [kind, segment] of Object.entries(SEGMENTS)) {
    if (segment === path) return { kind } as Route;
  }
  return undefined;
}
