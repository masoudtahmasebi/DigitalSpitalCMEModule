/**
 * The portal's routes, as pure functions (P11-01, P21-03).
 *
 * No router library. There are three screens and two parameters, and a router
 * would bring a dependency, a context, and a set of behaviours nobody here
 * needs — while the part that is actually easy to get wrong, decoding slugs out
 * of a path, is a few lines that ought to be tested rather than trusted.
 *
 * Path-based rather than hash-based, so a learner can bookmark a course and a
 * link in an email opens it. That needs the server to serve `index.html` for
 * any unmatched path; `infra/nginx/portal.conf` does exactly that, the same way
 * the admin console's config does.
 *
 * ## The tenant is in the path now (P21-03)
 *
 * It used to be `PORTAL_PROJECT_SLUG`, baked into the container's runtime
 * config. One portal, one customer, decided by the deployment — which meant
 * `fortbildung.digitalspital.com` *was* MEDICE's front door, there was no way
 * to reach any other customer through it, and the root page immediately
 * bounced a visitor into MEDICE's Keycloak whether or not they had anything to
 * do with MEDICE.
 *
 *   /                    a welcome page. No tenant, no login, no redirect.
 *   /medice              MEDICE's catalogue.
 *   /medice/kurs/x       a course inside it.
 *
 * The root being *only* a welcome page is the point. A visitor who has not
 * named a customer has not told us which identity provider they belong to, and
 * guessing produced the reported bug: an unprompted redirect to
 * `login.medice.de` with no link back to anywhere.
 */

export type Route =
  /** No tenant named. A welcome page, and deliberately nothing else. */
  | { readonly kind: "welcome" }
  | { readonly kind: "catalogue"; readonly tenant: string }
  | { readonly kind: "course"; readonly tenant: string; readonly slug: string };

/** The path segment under which a course lives. German, because the URL is user-visible. */
const COURSE_PREFIX = "kurs";

/**
 * Slugs the platform issues, and therefore the only shape worth accepting.
 *
 * Matching the grammar `customers.slug` and `projects.slug` are checked
 * against, so a path that could not name a real tenant is answered here rather
 * than becoming an API round trip that returns nothing. It also keeps anything
 * path-like — `..`, an encoded slash, a scheme — out of a value that ends up in
 * an `X-DS-Project` header.
 */
const SLUG = /^[a-z0-9-]{1,64}$/;

/**
 * The grammar, checked without a nested quantifier.
 *
 * `^[a-z0-9]+(?:-[a-z0-9]+)*$` says the same thing in one expression and
 * `security/detect-unsafe-regex` refuses it — correctly enough to be worth
 * obeying rather than silencing, because the input is a path segment an
 * attacker chooses. The three rules below are each a single pass, the length
 * bound comes first, and the result is easier to read than the regex was.
 */
function isSlug(value: string): boolean {
  return (
    SLUG.test(value) &&
    !value.startsWith("-") &&
    !value.endsWith("-") &&
    !value.includes("--")
  );
}

function decode(raw: string): string | undefined {
  try {
    return decodeURIComponent(raw);
  } catch {
    // A malformed percent-escape. Not something anybody can have linked to.
    return undefined;
  }
}

/**
 * Read a route out of a path.
 *
 * Anything unrecognised is the **welcome** page rather than a 404 screen or a
 * guess at a tenant. An unknown path is almost always a stale link or a typo,
 * and landing somewhere that explains where you are beats both being told
 * nothing is here and being sent to some customer's login.
 *
 * A tenant slug that does not exist *is* reported, but by the API — this
 * function cannot know, and guessing would be a second opinion about what
 * exists.
 */
export function parseRoute(pathname: string): Route {
  const segments = pathname.split("/").filter((segment) => segment !== "");
  if (segments.length === 0) return { kind: "welcome" };

  const tenant = decode(segments[0] ?? "");
  if (tenant === undefined || !isSlug(tenant)) return { kind: "welcome" };

  if (segments.length === 1) return { kind: "catalogue", tenant };

  if (segments.length === 3 && segments[1] === COURSE_PREFIX) {
    const slug = decode(segments[2] ?? "");
    if (slug === undefined || slug === "") return { kind: "catalogue", tenant };
    return { kind: "course", tenant, slug };
  }

  // A tenant we understood followed by something we did not. The catalogue is
  // the right landing: they named a customer, so we know where they belong.
  return { kind: "catalogue", tenant };
}

/** The path for a route. The inverse of `parseRoute`, and tested as such. */
export function routePath(route: Route): string {
  if (route.kind === "welcome") return "/";
  const tenant = encodeURIComponent(route.tenant);
  return route.kind === "catalogue"
    ? `/${tenant}`
    : `/${tenant}/${COURSE_PREFIX}/${encodeURIComponent(route.slug)}`;
}

/** The tenant a route acts within, if it names one. */
export function routeTenant(route: Route): string | undefined {
  return route.kind === "welcome" ? undefined : route.tenant;
}
