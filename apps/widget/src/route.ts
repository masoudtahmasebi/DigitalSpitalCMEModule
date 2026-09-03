/**
 * The learner's address bar (P82-04).
 *
 * ## What was wrong
 *
 * The widget's screen was React state and nothing else, so every screen in a
 * course lived at one URL. Reported directly:
 *
 * > _"when i am in the course, and i refresh, the url is
 * > `…/medice/kurs/adhs-akademie-adult` and it goes to the main page of the
 * > course."_
 *
 * That is one symptom of three, and they always arrive together (CLAUDE.md
 * §9.8): back leaves the course, F5 loses your place, and "look at this
 * module" is a screenshot and a set of directions instead of a link. Each on
 * its own reads as the browser being awkward, which is why the console carried
 * the same defect for nine phases before anybody wrote it down as one.
 *
 * The console fixed its half in P42-01. This is the learner's half, and the
 * widget needs its own because the portal's `routes.ts` addresses the *course*
 * — `/medice/kurs/<slug>` — and stops there. Which section of it you are in is
 * a fact only the widget has.
 *
 * ## Why a fragment, and why prefixed
 *
 * A fragment because the portal is a static bundle behind a server that knows
 * one route: a deep path would 404 on reload, and reload is the case this
 * exists for.
 *
 * **Prefixed with `ds/`** because this is the one router in the repository that
 * does not own its page. `<ds-lms>` mounts inside a customer's WordPress site,
 * beside plugins and anchors that were there first — so the widget reads only
 * fragments it recognises and leaves every other one untouched. Without the
 * prefix, a course would hijack `#kontakt` on MEDICE's page and a theme's
 * scrollspy would look like a learner navigating.
 *
 * ## Why by hand
 *
 * Four screens and one parameter. `encode`/`decode` are pure, total and
 * exhaustively testable; a router library would be a dependency and a provider
 * in exchange for that. Same reasoning as `apps/admin/src/routes.ts`, and the
 * same German-in-the-URL rule (CLAUDE.md §5): a learner sending a colleague a
 * link should see the word they use for the thing.
 */

import { stripTrailingSlashes } from "@ds/domain";

/**
 * What the fragment can name.
 *
 * `content` covers a lesson **and** a quiz deliberately: which of the two a
 * content is, is a property of the course, and `screenFor` in `App.tsx` already
 * resolves it. Encoding the kind in the URL would put a second answer in a
 * place nobody can keep in step with the first — and a link to
 * `#ds/inhalt/<id>` would then be wrong the moment a content changed kind.
 */
export type WidgetRoute =
  | { readonly kind: "outline"; readonly tab: CourseTab }
  | { readonly kind: "content"; readonly contentId: string }
  | { readonly kind: "evaluation" }
  | { readonly kind: "reporting" };

/**
 * The four tabs of the course detail page (P123-01).
 *
 * Declared here rather than in `App.tsx` because the address is what makes a
 * tab a place rather than a rendering choice, and a type owned by the component
 * would have to be imported *backwards* by the router.
 *
 * The tab belongs to the `outline` route rather than being a route of its own:
 * a tab is which face of the course overview you are looking at, not a
 * different screen. Encoding it separately would allow `#ds/mediathek` to be
 * decoded while the learner is inside a video, which is not a state the product
 * has.
 */
export type CourseTab = "overview" | "speakers" | "certification" | "library";

/** Everything this router answers to. Anything else belongs to the host page. */
const PREFIX = "ds";

/**
 * The segment that names which course a route is inside (P156-02).
 *
 * ## Why the address needed this
 *
 * Every route here is course-**relative**: `ds/inhalt/<id>` names a content and
 * nothing else, because the course arrives on the `course-slug` attribute of
 * `<ds-lms>`. On a page that carries that attribute the address is complete.
 *
 * On a page that does **not** — a catalogue embed, where the learner picks the
 * course — it is not. The fragment starts naming contents inside whichever
 * course was opened, and on reload the attribute is still absent, so the
 * catalogue renders again and the fragment can never be applied: the component
 * that would read it is not mounted. Reported three times, most recently as
 * *"when i refresh … again the main page opens."*
 *
 * §9.8 in a form worth naming: the address existed and was **incomplete**,
 * which is the same defect as having none.
 *
 * ## Why a prefix segment and not a query
 *
 * A fragment has no query, and inventing one inside it would need its own
 * parser. A leading segment keeps `decode` a list of `switch`-able shapes and
 * lets the old form stay legal: a fragment with no `kurs/` is exactly the link
 * anybody has already sent, and it still names the same screen.
 */
const COURSE_SEGMENT = "kurs";

/**
 * The shape of a course slug this will put in a URL, and accept back out.
 *
 * The same reasoning as `CONTENT_ID` one paragraph down: this value is compared
 * against slugs from the API and written into `location.hash`, so anything
 * path-like — an encoded slash, `..`, a scheme — has to be refused rather than
 * trusted. Slugs are lower-case, digits and hyphens, which is what the
 * authoring side produces.
 *
 * Written as a scan rather than as `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`, which the
 * repository's lint rule refuses as backtracking-prone — and is right to, for
 * the same reason the slash trimming in `decode` avoids a regex: this input is
 * a fragment, so whoever sends the link chooses it.
 */
const COURSE_SLUG_MAX = 120;

function isCourseSlug(value: string): boolean {
  if (value.length === 0 || value.length > COURSE_SLUG_MAX) return false;
  if (value.startsWith("-") || value.endsWith("-")) return false;

  let previousWasHyphen = false;
  for (const character of value) {
    const lower = character >= "a" && character <= "z";
    const digit = character >= "0" && character <= "9";
    const hyphen = character === "-";
    if (!lower && !digit && !hyphen) return false;
    if (hyphen && previousWasHyphen) return false;
    previousWasHyphen = hyphen;
  }
  return true;
}

const CONTENT_SEGMENT = "inhalt";
const EVALUATION_SEGMENT = "evaluation";
const REPORTING_SEGMENT = "punktemeldung";

/**
 * The segment naming each tab, in the learner's own German (§5).
 *
 * `overview` is deliberately absent: it encodes as the bare prefix, so `#ds`
 * stays exactly what it has always meant — the course overview — and every link
 * anybody has already sent keeps working. Adding `ds/uebersicht` as a synonym
 * would give one screen two addresses, which is how the two drift.
 */
const TAB_SEGMENTS = {
  speakers: "referenten",
  certification: "zertifizierung",
  library: "mediathek",
} as const satisfies Record<Exclude<CourseTab, "overview">, string>;

const TAB_FOR_SEGMENT: ReadonlyMap<string, CourseTab> = new Map(
  Object.entries(TAB_SEGMENTS).map(([tab, segment]) => [segment, tab as CourseTab]),
);

/**
 * The shape of an identifier this will put in a URL, and accept back out.
 *
 * Content ids are UUIDs. Checking the grammar rather than trusting the string
 * keeps anything path-like — an encoded slash, `..`, a scheme — out of a value
 * that is compared against ids from the API and written into `location.hash`.
 */
const CONTENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The fragment for a route, without the leading `#`.
 *
 * The outline encodes as the bare prefix rather than as an empty string: a
 * fragment of `#` is what a browser writes for "top of page", and it would make
 * returning to the outline indistinguishable from a link that names nothing.
 */
export function encode(route: WidgetRoute, courseSlug?: string): string {
  const within = encodeWithin(route);
  if (courseSlug === undefined || !isCourseSlug(courseSlug)) return within;
  // `ds` + `kurs/<slug>` + whatever the screen adds. The outline encodes as the
  // bare prefix, so the course form of it is `ds/kurs/<slug>` and not a
  // trailing slash.
  const rest = within === PREFIX ? "" : `/${within.slice(PREFIX.length + 1)}`;
  return `${PREFIX}/${COURSE_SEGMENT}/${courseSlug}${rest}`;
}

/**
 * Which course a fragment names, when it names one.
 *
 * Separate from `decode` because the two answers are wanted at different
 * moments and by different components: the course decides which screen tree to
 * mount at all, and the route decides where inside it to go.
 */
export function decodeCourseSlug(hash: string): string | undefined {
  const segments = fragmentSegments(hash);
  if (segments === undefined) return undefined;
  if (segments[1] !== COURSE_SEGMENT) return undefined;
  const slug = decodeSegment(segments[2] ?? "");
  if (slug === undefined || !isCourseSlug(slug)) return undefined;
  return slug;
}

/**
 * Leave the catalogue's address behind when the learner does (DEP-33).
 *
 * ## The defect
 *
 * **Zurück zur Übersicht** unmounted the course and rendered the catalogue, and
 * left the fragment naming the tab the learner had been on. The URL was stale
 * immediately, and a reload put them back inside the course — because the
 * fragment is what decides which course mounts at all (`decodeCourseSlug`).
 * Reported as: *"the browser loads the old tab URL (/referenten) instead of the
 * course overview."*
 *
 * That is §9.8's third symptom, and it arrives with the other two: the address
 * bar disagrees with the screen, and "look at this list" links into a course.
 *
 * ## Why removing the fragment rather than writing one
 *
 * The catalogue **is** the page. There is no `WidgetRoute` for it and there
 * should not be: this router addresses positions *within* a course, and the
 * absence of a course fragment already means "the catalogue", which is what a
 * first visit looks like. Writing `#ds` instead would invent a second spelling
 * of the same state.
 *
 * ## Why only our own fragment
 *
 * `<ds-lms>` does not own its page (see this file's header). A learner may have
 * arrived at `…/fortbildungen#kontakt` from the theme's own menu, and clearing
 * that would move a WordPress page under them. So this removes the fragment
 * only when it is one this router wrote, and reports whether it did.
 *
 * `replaceState`, like every other write here: the catalogue is where the
 * course page was, not a step forward from it, and pushing would make Back a
 * no-op that redraws the same screen.
 */
export function clearCourseFragment(): boolean {
  if (typeof window === "undefined") return false;
  if (fragmentSegments(window.location.hash) === undefined) return false;
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${window.location.search}`,
  );
  return true;
}

/**
 * A fragment split into segments, or `undefined` when it is not ours.
 *
 * Shared by `decode` and `decodeCourseSlug` so the two cannot disagree about
 * what counts as this router's fragment — which is the whole reason the leading
 * slashes are trimmed without a regex; see `decode`.
 */
function fragmentSegments(hash: string): string[] | undefined {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  let start = 0;
  while (raw.charAt(start) === "/") start += 1;
  const trimmed = stripTrailingSlashes(raw.slice(start));
  if (trimmed === "") return undefined;
  const segments = trimmed.split("/");
  if (segments[0] !== PREFIX) return undefined;
  return segments;
}

function encodeWithin(route: WidgetRoute): string {
  switch (route.kind) {
    case "outline":
      return route.tab === "overview" ? PREFIX : `${PREFIX}/${TAB_SEGMENTS[route.tab]}`;
    case "content":
      return `${PREFIX}/${CONTENT_SEGMENT}/${route.contentId}`;
    case "evaluation":
      return `${PREFIX}/${EVALUATION_SEGMENT}`;
    case "reporting":
      return `${PREFIX}/${REPORTING_SEGMENT}`;
  }
}

/**
 * Read a route out of a fragment, or `undefined` when it is not ours.
 *
 * `undefined` and `{kind:"outline"}` are different answers and the difference
 * is load-bearing: the first means *this fragment belongs to the host page,
 * change nothing*, the second means *the learner asked for the course
 * overview*. Collapsing them would make an unrelated `#kontakt` on a WordPress
 * page close whatever the learner was watching.
 */
export function decode(hash: string): WidgetRoute | undefined {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;

  /*
   * Slashes off both ends, without a regex.
   *
   * `/^\/+/` and `/\/+$/` say this in fewer characters and backtrack
   * quadratically on a long run of slashes — and this input is a fragment, so
   * whoever sends the link chooses it. The repository's own lint rule refuses
   * them for exactly that reason, and it is right to.
   */
  let start = 0;
  while (raw.charAt(start) === "/") start += 1;
  const trimmed = stripTrailingSlashes(raw.slice(start));
  if (trimmed === "") return undefined;

  let segments = trimmed.split("/");
  if (segments[0] !== PREFIX) return undefined;

  // `ds/kurs/<slug>/…` names the course as well; the screen is decoded from
  // what follows, so both forms answer identically (P156-02).
  if (segments[1] === COURSE_SEGMENT) {
    const slug = decodeSegment(segments[2] ?? "");
    if (slug === undefined || !isCourseSlug(slug)) return undefined;
    segments = [PREFIX, ...segments.slice(3)];
  }

  if (segments.length === 1) return { kind: "outline", tab: "overview" };

  if (segments.length === 2) {
    const tab = TAB_FOR_SEGMENT.get(segments[1] ?? "");
    if (tab !== undefined) return { kind: "outline", tab };
  }

  if (segments[1] === EVALUATION_SEGMENT && segments.length === 2) {
    return { kind: "evaluation" };
  }
  if (segments[1] === REPORTING_SEGMENT && segments.length === 2) {
    return { kind: "reporting" };
  }
  if (segments[1] === CONTENT_SEGMENT && segments.length === 3) {
    const id = decodeSegment(segments[2] ?? "");
    if (id === undefined || !CONTENT_ID.test(id)) return undefined;
    return { kind: "content", contentId: id };
  }

  /*
   * Ours by prefix and meaningless by shape — a truncated link, or a fragment
   * from a version of this file that knew another screen. The outline is the
   * right answer rather than `undefined`: the learner asked for something in
   * this course and the course's own first page is the honest fallback, where
   * leaving the fragment alone would show them whatever screen happened to be
   * mounted and no explanation.
   */
  return { kind: "outline", tab: "overview" };
}

function decodeSegment(raw: string): string | undefined {
  try {
    return decodeURIComponent(raw);
  } catch {
    // A malformed percent-escape. Nobody can have linked to it.
    return undefined;
  }
}
