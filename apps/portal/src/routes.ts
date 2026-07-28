/**
 * The portal's two routes, as pure functions (P11-01).
 *
 * No router library. There are two screens and one parameter, and a router
 * would bring a dependency, a context, and a set of behaviours nobody here
 * needs — while the part that is actually easy to get wrong, decoding a slug
 * out of a path, is six lines that ought to be tested rather than trusted.
 *
 * Path-based rather than hash-based, so a learner can bookmark a course and a
 * link in an email opens it. That needs the server to serve `index.html` for
 * any unmatched path; `infra/nginx/portal.conf` does exactly that, the same way
 * the admin console's config does.
 */

export type Route =
  { readonly kind: "catalogue" } | { readonly kind: "course"; readonly slug: string };

/** The path segment under which a course lives. German, because the URL is user-visible. */
const COURSE_PREFIX = "kurs";

/**
 * Read a route out of a path.
 *
 * Anything unrecognised is the catalogue rather than a 404 screen: an unknown
 * path in a two-screen app is almost always a stale link or a typo, and landing
 * on the list is more useful than being told nothing is here. A course slug
 * that does not exist *is* reported, but by the API — this function cannot
 * know, and guessing would be a second opinion about what exists.
 */
export function parseRoute(pathname: string): Route {
  const segments = pathname.split("/").filter((segment) => segment !== "");

  if (segments.length === 2 && segments[0] === COURSE_PREFIX) {
    const raw = segments[1] ?? "";
    let slug: string;
    try {
      slug = decodeURIComponent(raw);
    } catch {
      // A malformed percent-escape. Not a course anybody can have linked to.
      return { kind: "catalogue" };
    }
    return slug === "" ? { kind: "catalogue" } : { kind: "course", slug };
  }

  return { kind: "catalogue" };
}

/** The path for a route. The inverse of `parseRoute`, and tested as such. */
export function routePath(route: Route): string {
  return route.kind === "catalogue"
    ? "/"
    : `/${COURSE_PREFIX}/${encodeURIComponent(route.slug)}`;
}
