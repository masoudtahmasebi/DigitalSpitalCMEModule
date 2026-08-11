/**
 * Picking a configuration value: runtime first, build-time second (P16-02).
 *
 * ## Why this is here rather than in each app
 *
 * The admin console and the portal both read their API base, project slug and
 * (for the portal) Keycloak client out of a `/config.js` written when their
 * container starts, falling back to Vite's build-time `import.meta.env` for
 * `pnpm dev`. Two apps, one precedence rule.
 *
 * Two copies of a precedence rule is two answers to "which one wins" the day
 * somebody changes one of them — and the wrong answer is a console silently
 * talking to a stale API baked into an old image. The rule is small enough to
 * duplicate and important enough not to.
 *
 * `packages/domain` is the pure package, and this is pure: an object in, a
 * string out, no I/O, no globals read. The *reading* of `window.__DS_CONFIG__`
 * stays in each app, where the DOM is.
 *
 * ## Why runtime wins
 *
 * A deployed container always generates `/config.js`, so a `VITE_API_BASE` left
 * behind in an image can never override what the host actually says. The
 * opposite precedence would make a stale build argument authoritative over the
 * live deployment — which is the failure this whole change exists to remove.
 */

/**
 * The shape `/config.js` puts on `window`.
 *
 * Every field is optional because the file is generated outside the bundle:
 * this type is a claim about it, not a guarantee, and `configValue` treats
 * anything that is not a non-empty string as absent.
 */
export interface RuntimeConfig {
  readonly apiBase?: string | undefined;
  readonly projectSlug?: string | undefined;
  readonly issuer?: string | undefined;
  readonly clientId?: string | undefined;
  readonly redirectUri?: string | undefined;
  /**
   * The commit this bundle was built from (P46-01).
   *
   * Absent under `pnpm dev`, where there is no image and therefore no
   * `DS_COMMIT`. `@ds/build-info` renders that as `unknown` rather than
   * treating it as a version skew.
   */
  readonly commit?: string | undefined;
  /** The release number this bundle was deployed as (P47-01). */
  readonly version?: string | undefined;
}

/**
 * The runtime value if there is a usable one, otherwise the build-time value,
 * otherwise the empty string.
 *
 * The empty string rather than `undefined` because both callers test their
 * whole config for completeness with `every(v => v !== "")` — one sentinel for
 * "not configured", checked in one place, rather than two spellings of absent.
 */
export function configValue(
  runtime: RuntimeConfig | undefined,
  key: keyof RuntimeConfig,
  buildTime: string | undefined,
): string {
  const value = runtime?.[key];
  if (typeof value === "string" && value !== "") return value;
  return typeof buildTime === "string" ? buildTime : "";
}
