/**
 * Recognising a staff session on a request (P12-03), implementing ADR-0012.
 *
 * The second of the two authentication paths. It ends where the learner path
 * ends — at `resolveTenantContext` and a single `Principal` — so nothing
 * downstream has to know which plane a request arrived on.
 *
 * ## Why the cookie is parsed here rather than with `cookie-parser`
 *
 * One cookie, one format, four lines. A middleware for it would be a
 * dependency in the login path of the platform's own operations tooling, and
 * the login path is the one place where "fewer moving parts" is worth more
 * than convenience.
 *
 * ## The CSRF check, and what it deliberately does not cover
 *
 * Only state-changing methods. A `GET` that changes nothing cannot be abused by
 * a cross-origin form, and requiring a header on reads would break the
 * console's initial `session` call, which happens before it has a token to
 * echo.
 *
 * `GET` is therefore trusted to be safe, which is a real assumption: an
 * endpoint that mutates on `GET` would be exempt from this check. That is a
 * property of the contract, not of this file, and the contract has none.
 */

import { tokenMatches } from "../modules/staff/credentials.js";
import type {
  ResolvedStaffSession,
  SessionFailure,
} from "../modules/staff/staff.service.js";

export const SESSION_COOKIE = "ds_staff_session";
export const CSRF_HEADER = "x-ds-csrf";

/** Methods that may change state, and therefore need the CSRF token. */
const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Pull one cookie out of a `Cookie` header.
 *
 * Values are percent-decoded because Express encodes on the way out; a session
 * token is base64url and needs no encoding, but a token that *did* would
 * otherwise fail to match with no clue why.
 */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (header === undefined) return undefined;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() !== name) continue;
    return decodeURIComponent(part.slice(index + 1).trim());
  }
  return undefined;
}

export type StaffAuthResult =
  | { readonly kind: "none" }
  | { readonly kind: "session"; readonly session: ResolvedStaffSession }
  | { readonly kind: "rejected"; readonly reason: SessionFailure | "csrf" };

/**
 * Resolve and validate a staff session from a raw request.
 *
 * Returns `none` — not `rejected` — when there is no cookie at all, so the
 * caller can fall through to the learner path. A request carrying neither
 * credential is not a staff request that failed; it is not a staff request.
 */
export async function authenticateStaff(input: {
  method: string;
  cookieHeader: string | undefined;
  csrfHeader: string | undefined;
  resolve: (token: string) => Promise<ResolvedStaffSession | { failure: SessionFailure }>;
}): Promise<StaffAuthResult> {
  const token = readCookie(input.cookieHeader, SESSION_COOKIE);
  if (token === undefined) return { kind: "none" };

  const resolved = await input.resolve(token);
  if ("failure" in resolved) return { kind: "rejected", reason: resolved.failure };

  if (UNSAFE_METHODS.has(input.method.toUpperCase())) {
    if (
      input.csrfHeader === undefined ||
      !tokenMatches(input.csrfHeader, resolved.csrfTokenHash)
    ) {
      return { kind: "rejected", reason: "csrf" };
    }
  }

  return { kind: "session", session: resolved };
}
