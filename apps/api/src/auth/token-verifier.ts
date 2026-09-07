/**
 * Keycloak JWKS token validation (P1-01), implementing ADR-0003.
 *
 * The trust anchor for the entire system. Validating only the signature is the
 * common and dangerous mistake: a validly-signed token minted for a different
 * client or a different realm would then be accepted here. So issuer and
 * audience are checked against the project's own binding — never taken from the
 * token — alongside signature and expiry.
 *
 * `alg: none` and unsigned tokens are rejected structurally: only RS256 (and
 * the RSA family Keycloak realms use) is accepted, so a token asking to be
 * verified with no signature cannot slip through.
 *
 * This module is deliberately free of NestJS and of any network client of its
 * own — the JWKS is supplied as a `KeyResolver`, so it can be unit-tested
 * against locally generated keys with no running Keycloak (P1-01 acceptance
 * criterion), and the Redis-backed cache (P1-03) is injected at the edge.
 */

import { errors, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";

/**
 * Resolves the signing key for a token's `kid`. Backed by cached JWKS.
 *
 * ## This was `Parameters<typeof jwtVerify>[1]`, and that was wrong (P207-03)
 *
 * The comment here used to say deriving from `jwtVerify`'s own parameter type
 * "keeps this correct across future jose majors without another edit here".
 * It did the opposite, for a reason worth writing down:
 *
 * - In jose 6.2.4 `jwtVerify` had **one** signature, whose second parameter was
 *   `JWTVerifyGetKey` — a function. The derivation resolved to something
 *   callable and everything worked.
 * - From 6.2.10 `jwtVerify` is **overloaded**, and the second overload takes
 *   `KeyInput | JWTVerifyGetKey` so a caller can forward either form.
 *   `Parameters<>` on an overloaded function silently resolves to the **last**
 *   overload, so this type became a union including `CryptoKey` — and
 *   `JwksProvider`, which does not merely forward the resolver but **calls**
 *   it, stopped compiling with "not all constituents of type … are callable".
 *
 * Two different things had been conflated under one name: what `verifyToken`
 * *accepts* (anything `jwtVerify` accepts) and what `JwksProvider` *produces
 * and invokes* (a key-getter function). This is the second, which is what every
 * use in this codebase actually means, and it is still assignable to
 * `jwtVerify`'s parameter under both overloads.
 *
 * So: name the type jose exports for exactly this, rather than deriving one.
 * A derivation is only stable if what it derives from is; an overload set is
 * not.
 */
export type KeyResolver = JWTVerifyGetKey;

export type TokenRejectionReason =
  | "malformed"
  | "bad_signature"
  | "wrong_issuer"
  | "wrong_audience"
  | "expired"
  | "not_yet_valid"
  | "unsupported_alg"
  | "unknown_key"
  /**
   * The credential was an opaque session and it is not usable — absent,
   * revoked, expired, or presented against a project it was not created
   * through (P25-02).
   *
   * One reason for all four on purpose. Distinguishing them in the audit log
   * would be useful to us and equally useful to somebody probing, and none of
   * the four is something a legitimate client needs to tell apart. It is a
   * *separate* reason from the JWT ones because writing `bad_signature` for a
   * session that has no signature would make the audit trail say something
   * untrue.
   */
  | "invalid_session"
  /**
   * The project names a federating provider but carries no issuer/audience, so
   * there is nothing to verify against.
   *
   * `ProjectBindingRepository.resolve` refuses such a project before a provider
   * ever sees it, so this should not occur — it exists so that if it ever does,
   * the audit log says "misconfigured" rather than `bad_signature`, which would
   * send whoever reads it looking for an attacker instead of a blank column.
   */
  | "provider_misconfigured";

export class TokenInvalidError extends Error {
  constructor(readonly reason: TokenRejectionReason) {
    // The message stays internal — the API surfaces a generic 401 (ADR-0003).
    super(`token rejected: ${reason}`);
    this.name = "TokenInvalidError";
  }
}

export interface VerifiedIdentity {
  /** Keycloak `sub` — the stable primary user key (ADR-0003). */
  readonly subject: string;
  readonly issuer: string;
  readonly email?: string;
  readonly firstName?: string;
  readonly lastName?: string;
  /** Realm roles as claimed. Authorisation still checks local assignment (P1-04). */
  readonly realmRoles: readonly string[];
  readonly raw: JWTPayload;
}

export interface VerifierOptions {
  readonly issuer: string;
  readonly audience: string;
  readonly clockToleranceSec: number;
}

/**
 * The signing algorithms we accept. Restricting this list is what rejects
 * `alg: none` and any HMAC downgrade attempt — never widen it to include `none`
 * or a symmetric algorithm.
 */
const ACCEPTED_ALGORITHMS = ["RS256", "RS384", "RS512", "PS256"] as const;

export async function verifyToken(
  token: string,
  resolveKey: KeyResolver,
  options: VerifierOptions,
): Promise<VerifiedIdentity> {
  let payload: JWTPayload;

  try {
    const result = await jwtVerify(token, resolveKey, {
      issuer: options.issuer,
      audience: options.audience,
      algorithms: [...ACCEPTED_ALGORITHMS],
      clockTolerance: options.clockToleranceSec,
    });
    payload = result.payload;
  } catch (error) {
    throw new TokenInvalidError(classify(error));
  }

  if (typeof payload.sub !== "string" || payload.sub === "") {
    throw new TokenInvalidError("malformed");
  }

  return {
    subject: payload.sub,
    issuer: typeof payload.iss === "string" ? payload.iss : options.issuer,
    ...readString(payload, "email", "email"),
    ...readString(payload, "given_name", "firstName"),
    ...readString(payload, "family_name", "lastName"),
    realmRoles: readRealmRoles(payload),
    raw: payload,
  };
}

function classify(error: unknown): TokenRejectionReason {
  if (error instanceof errors.JWTExpired) return "expired";
  if (error instanceof errors.JWTClaimValidationFailed) {
    if (error.claim === "iss") return "wrong_issuer";
    if (error.claim === "aud") return "wrong_audience";
    if (error.claim === "nbf") return "not_yet_valid";
    return "malformed";
  }
  if (error instanceof errors.JOSEAlgNotAllowed) return "unsupported_alg";
  if (error instanceof errors.JWSSignatureVerificationFailed) return "bad_signature";
  if (error instanceof errors.JWKSNoMatchingKey) return "unknown_key";
  if (error instanceof errors.JWSInvalid || error instanceof errors.JWTInvalid)
    return "malformed";
  return "bad_signature";
}

function readString(
  payload: JWTPayload,
  claim: string,
  key: "email" | "firstName" | "lastName",
): Record<string, string> {
  const value = payload[claim];
  return typeof value === "string" && value !== "" ? { [key]: value } : {};
}

/** Keycloak nests realm roles under `realm_access.roles`. */
function readRealmRoles(payload: JWTPayload): readonly string[] {
  const realmAccess = payload["realm_access"];
  if (typeof realmAccess !== "object" || realmAccess === null) return [];

  const roles = (realmAccess as Record<string, unknown>)["roles"];
  if (!Array.isArray(roles)) return [];

  return roles.filter((role): role is string => typeof role === "string");
}
