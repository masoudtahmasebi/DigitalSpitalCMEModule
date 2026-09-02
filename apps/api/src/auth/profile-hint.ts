/**
 * The name and email the host page already holds (P105-01).
 *
 * ## Why this exists
 *
 * MEDICE's physicians sign in through their own Keycloak, and the access token
 * that reaches us carries **no `email`, `given_name` or `family_name`** — the
 * realm has no mapper for them. `verifyToken` reads all three when present, so
 * a completed course arrived with nothing to print on the
 * Teilnahmebescheinigung, and a certificate with no name is not a valid
 * document.
 *
 * The data is not missing. MEDICE's theme calls
 * `Keycloak::getUserInfoByToken()` at sign-in and keeps the profile in the PHP
 * session — the same session the plugin already reads the token out of. It
 * simply never crossed to us.
 *
 * ## What this is allowed to decide, and what it is not
 *
 * **Nothing about identity.** The person is resolved before this is consulted,
 * from the `sub` of a token verified against the customer's JWKS (ADR-0003).
 * This fills *attributes* on an identity that is already established, and only
 * ones the token itself did not supply — coalesce, never overwrite.
 *
 * That distinction is what makes it safe, and it is worth stating precisely
 * rather than gesturing at:
 *
 * - `provision_learner` matches on `(provider, realm, sub)`. Email is **not** a
 *   lookup key anywhere; migration 0025 only ever does
 *   `SET email = coalesce(p_email, u.email)`. So a hint cannot cause one person
 *   to be resolved as another, which is the escalation CLAUDE.md §4 invariant 2
 *   exists to prevent.
 * - The worst a malicious page can do is put a wrong name on the account of
 *   somebody sitting at that page, looking at their own screen. That is a
 *   data-quality fault, not an identity one, and an operator can correct it
 *   (`adminCorrectLearnerName`).
 *
 * A token that *does* carry the claims wins, always. A realm that adds the
 * mappers later needs no change here and no coordination: the hint simply
 * stops being used.
 *
 * ## GDPR
 *
 * A new category of personal data now crosses from the host site, so the
 * learner is told. `docs/gdpr.md` records it, and the widget says so where a
 * physician can see it rather than in a policy nobody opens — the client's own
 * instruction: *"we should add a sign that your progress is synced with your
 * medice account."*
 *
 * Pure: no I/O, no clock. The header is an argument.
 */

/** The three fields a host page may offer. Everything else is ignored. */
export interface ProfileHint {
  readonly email?: string;
  readonly firstName?: string;
  readonly lastName?: string;
}

/**
 * Longer than a realistic name, short enough that a header cannot be used to
 * push kilobytes through the guard on every request.
 */
const MAX_FIELD = 200;

/** Control characters, which have no place in a name or an address. */
// eslint-disable-next-line no-control-regex -- refusing control characters is the point
const CONTROL = /[\u0000-\u001f\u007f]/u;

/**
 * `X-DS-Profile: base64url(JSON)`.
 *
 * Base64 because a name may contain any UTF-8 — `Müller-Lüdenscheidt` is not
 * expressible in a raw header value, and a header carrying a CR or LF is a
 * response-splitting primitive. Decoding to nothing is not an error: a page
 * that offers a malformed hint gets the behaviour of a page that offered none.
 */
export function parseProfileHint(header: unknown): ProfileHint {
  if (typeof header !== "string" || header === "") return {};

  let body: unknown;
  try {
    body = JSON.parse(Buffer.from(header, "base64url").toString("utf8"));
  } catch {
    return {};
  }

  if (typeof body !== "object" || body === null) return {};
  const record = body as Record<string, unknown>;

  return {
    ...field(record, "email"),
    ...field(record, "firstName"),
    ...field(record, "lastName"),
  };
}

/**
 * Merge a hint into a verified identity — **only where the token was silent.**
 *
 * The direction is the whole point, and is why this is a named function rather
 * than a spread at the call site. `{...hint, ...identity}` reads the same way to
 * a reviewer and does the opposite thing on the day a realm starts sending a
 * claim: written the other way round, the page's value would win over the
 * customer's own IdP.
 */
export function withProfileHint<T extends ProfileHint>(
  identity: T,
  hint: ProfileHint,
): T {
  return {
    ...identity,
    ...(identity.email === undefined && hint.email !== undefined
      ? { email: hint.email }
      : {}),
    ...(identity.firstName === undefined && hint.firstName !== undefined
      ? { firstName: hint.firstName }
      : {}),
    ...(identity.lastName === undefined && hint.lastName !== undefined
      ? { lastName: hint.lastName }
      : {}),
  };
}

function field(
  record: Record<string, unknown>,
  key: "email" | "firstName" | "lastName",
): Partial<Record<typeof key, string>> {
  const value = record[key];
  if (typeof value !== "string") return {};

  const trimmed = value.trim();
  if (trimmed === "" || trimmed.length > MAX_FIELD) return {};
  if (CONTROL.test(trimmed)) return {};
  if (key === "email" && !trimmed.includes("@")) return {};

  return { [key]: trimmed } as Partial<Record<typeof key, string>>;
}
