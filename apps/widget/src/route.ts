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
  | { readonly kind: "outline" }
  | { readonly kind: "content"; readonly contentId: string }
  | { readonly kind: "evaluation" }
  | { readonly kind: "reporting" };

/** Everything this router answers to. Anything else belongs to the host page. */
const PREFIX = "ds";

const CONTENT_SEGMENT = "inhalt";
const EVALUATION_SEGMENT = "evaluation";
const REPORTING_SEGMENT = "punktemeldung";

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
export function encode(route: WidgetRoute): string {
  switch (route.kind) {
    case "outline":
      return PREFIX;
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

  const segments = trimmed.split("/");
  if (segments[0] !== PREFIX) return undefined;

  if (segments.length === 1) return { kind: "outline" };

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
  return { kind: "outline" };
}

function decodeSegment(raw: string): string | undefined {
  try {
    return decodeURIComponent(raw);
  } catch {
    // A malformed percent-escape. Nobody can have linked to it.
    return undefined;
  }
}
