/**
 * Participants whose credential is this platform's, not a customer's (P25-02).
 *
 * ## Why a second provider rather than a special case
 *
 * `IdentityProviderRegistry` was built in P12-02 so that adding one is "a class
 * and a row value" — and `assertProvidersCoverSchema` refuses to boot when the
 * schema permits a provider no class implements. This is the first time that
 * seam has been used for real, and it held: nothing in the guard, the tenant
 * interceptor or any route changes.
 *
 * ## What it verifies
 *
 * An opaque session token, against `learner_sessions`. Not a JWT: the platform
 * is both issuer and verifier here, so a signed self-describing token buys
 * nothing and costs revocation. A stolen JWT is valid until it expires; a
 * stolen row is one `UPDATE` away from useless.
 *
 * The comparison is on the **SHA-256** of the presented value, because the
 * table stores the hash. A database dump must not be a set of live sessions.
 *
 * ## The check that is easy to leave out
 *
 * A session names the project it was created through, and this refuses one
 * presented against a *different* project. Without it, a participant who signs
 * in at `/medice` could send their cookie with `X-DS-Project: ds` and be
 * authenticated in another tenant — RLS would then scope the data to whatever
 * that project's customer is, which is precisely the cross-tenant read the
 * whole architecture exists to prevent.
 *
 * It is asserted twice, on purpose: `local-identity-provider.test.ts` proves
 * the check is written, and `participant-auth.integration.test.ts` proves it is
 * actually *reached* over real HTTP. Deleting the comparison fails the second
 * one and only the second one — which is how we know the first was not enough
 * on its own.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import type { ProjectBinding } from "../modules/projects/project-binding.repository.js";
import type { IdentityProvider } from "./identity-provider.js";
import { TokenInvalidError, type VerifiedIdentity } from "./token-verifier.js";

/** What a session row has to be able to answer with. */
export interface LearnerSession {
  readonly userId: string;
  readonly projectId: string;
  readonly subject: string;
  readonly realm: string;
  readonly email?: string | undefined;
  readonly firstName?: string | undefined;
  readonly lastName?: string | undefined;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
}

export interface LearnerSessionLookup {
  /** By the SHA-256 of the presented token. Never by the token itself. */
  findByTokenHash(hash: Buffer): Promise<LearnerSession | undefined>;
  /** Best-effort; a failure here must never fail the request. */
  touch(hash: Buffer, at: Date): Promise<void>;
}

/**
 * The realm recorded on a local credential.
 *
 * The spelling is migration 0025's, verbatim: *"For 'local' it is the platform
 * itself, spelled `ds:local` rather than left empty — an empty string in a
 * unique key is a value that looks like an accident."* It is deliberately not a
 * URL, because nothing resolves it and a URL-shaped realm invites somebody to
 * try fetching a JWKS from it.
 *
 * It is part of `user_identities`' unique key, so the seed, the admin console
 * and this file must all agree on it — hence one exported constant rather than
 * three string literals.
 */
export const LOCAL_REALM = "ds:local";

export function hashSessionToken(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

export class LocalIdentityProvider implements IdentityProvider {
  readonly name = "local" as const;

  constructor(
    private readonly sessions: LearnerSessionLookup,
    /** Injected so expiry is testable without waiting. */
    private readonly now: () => Date = () => new Date(),
  ) {}

  async verify(credential: string, binding: ProjectBinding): Promise<VerifiedIdentity> {
    const hash = hashSessionToken(credential);
    const session = await this.sessions.findByTokenHash(hash);

    // One refusal for every reason. "No such session", "expired", "revoked" and
    // "wrong project" are all `invalid_session`: distinguishing them tells a
    // caller which of their guesses was closer, and none of the four is
    // something a legitimate client needs to tell apart.
    if (session === undefined) throw refuse();
    if (session.revokedAt !== null) throw refuse();
    if (session.expiresAt.getTime() <= this.now().getTime()) throw refuse();

    // The cross-tenant check. A session is scoped to the project it was created
    // through; presenting it against another project's binding is refused, not
    // silently honoured.
    //
    // `timingSafeEqual` on the ids is not paranoia about a timing attack on a
    // uuid — it is that the comparison is a boundary check, and boundary checks
    // in this codebase do not take shortcuts.
    const expected = Buffer.from(session.projectId);
    const actual = Buffer.from(binding.projectId);
    if (expected.byteLength !== actual.byteLength || !timingSafeEqual(expected, actual)) {
      throw refuse();
    }

    // Best-effort, and deliberately not awaited into the failure path: a
    // `last_seen_at` write that fails must not turn a valid session into a 401.
    void this.sessions.touch(hash, this.now()).catch(() => undefined);

    return {
      subject: session.subject,
      issuer: session.realm,
      ...(session.email === undefined ? {} : { email: session.email }),
      ...(session.firstName === undefined ? {} : { firstName: session.firstName }),
      ...(session.lastName === undefined ? {} : { lastName: session.lastName }),
      // No claimed roles. A local credential asserts identity and nothing more;
      // authorisation is `user_roles`, exactly as for a federated one (P1-04).
      realmRoles: [],
      // The shape `VerifiedIdentity` requires. There is no token to echo, and
      // putting the session id here would be handing a caller a value they
      // should never see.
      raw: {},
    };
  }
}

function refuse(): TokenInvalidError {
  return new TokenInvalidError("invalid_session");
}
