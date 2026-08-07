/**
 * The sign-in decision (P25-02). Application layer — ADR-0006.
 *
 * ## The shape of every refusal
 *
 * One `{ ok: false }`, whatever went wrong. The caller turns it into one 401
 * with one German message. Distinguishing "no such address" from "wrong
 * password" hands a credential-stuffing run the first thing it wants — and the
 * list it would be building is a list of physicians.
 *
 * ## Why the password is verified even when there is no account
 *
 * `verifyPassword` against a fixed dummy hash. Argon2id takes tens of
 * milliseconds; skipping it for an unknown address makes "no such user" a
 * measurably faster response, which is the same oracle by a different route.
 * The staff plane does this and so does this.
 */

import { randomBytes } from "node:crypto";
import type { LearnerSessionRepository } from "../../auth/learner-session.repository.js";
import { verifyPassword, hashIp } from "../staff/credentials.js";
import type { ParticipantAuthRepository } from "./participant-auth.repository.js";

/** Failures before the account locks, and for how long. */
const LOCKOUT_THRESHOLD = 8;
const LOCKOUT_INTERVAL = "15 minutes";

/**
 * How long a session lasts.
 *
 * Twelve hours: long enough that a physician working through a 25-minute video
 * and a quiz over a lunch break is not signed out mid-course, short enough that
 * a shared clinic computer is not a standing invitation. There is no refresh —
 * signing in again is one form.
 */
const SESSION_HOURS = 12;

/**
 * An Argon2id hash of a value nobody knows, for the timing path above.
 *
 * Not a constant that looks like a password: it is generated at module load
 * from random bytes, so it cannot be recognised in a heap dump as "the dummy"
 * and it is not a value anybody could ever present.
 */
const DUMMY_HASH_PROMISE = import("node:crypto").then(async ({ randomBytes }) => {
  const { hashPassword } = await import("../staff/credentials.js");
  return hashPassword(randomBytes(32).toString("base64"));
});

export type SignInResult =
  | {
      readonly ok: true;
      readonly token: string;
      readonly expiresAt: Date;
      readonly mustChangePassword: boolean;
    }
  | { readonly ok: false };

export class ParticipantAuthService {
  constructor(
    private readonly repository: ParticipantAuthRepository,
    /** The same repository the guard verifies through — see its header. */
    private readonly sessions: LearnerSessionRepository,
    private readonly ipSalt: string,
  ) {}

  async signIn(input: {
    projectSlug: string;
    email: string;
    password: string;
    ip: string;
    userAgent: string | null;
    now: Date;
  }): Promise<SignInResult> {
    const project = await this.repository.findProject(input.projectSlug);

    // A project that authenticates against Keycloak has no password to check.
    // Refused with the same answer as everything else: telling a caller "this
    // customer uses a different identity provider" describes the customer's
    // infrastructure to anybody who asks.
    if (project === undefined || project.identityProvider !== "local") {
      await this.burnTime(input.password);
      return { ok: false };
    }

    const participant = await this.repository.findParticipant(
      input.email,
      project.customerId,
    );

    if (participant === undefined) {
      await this.burnTime(input.password);
      return { ok: false };
    }

    // A locked account fails without checking the password at all — but only
    // *after* the lookup, so the timing does not distinguish it from a wrong
    // password on an unlocked account.
    if (
      participant.lockedUntil !== null &&
      participant.lockedUntil.getTime() > input.now.getTime()
    ) {
      await this.burnTime(input.password);
      return { ok: false };
    }

    if (!(await verifyPassword(participant.passwordHash, input.password))) {
      await this.repository.recordFailure(
        participant.identityId,
        LOCKOUT_THRESHOLD,
        LOCKOUT_INTERVAL,
      );
      return { ok: false };
    }

    await this.repository.recordSuccess(participant.identityId);

    const expiresAt = new Date(input.now.getTime() + SESSION_HOURS * 3_600_000);

    // 32 bytes of CSPRNG. This is the only moment the token exists as a value:
    // the repository stores its SHA-256 and the caller puts the original in a
    // cookie, so nothing that survives this function can mint a session.
    const token = randomBytes(32).toString("base64url");
    await this.sessions.create({
      userId: participant.userId,
      projectId: project.projectId,
      token,
      expiresAt,
      // Hashed, never stored in the clear: it answers "was this the same
      // client?" without keeping a personal identifier (docs/gdpr.md §7).
      ipHash: input.ip === "" ? null : hashIp(input.ip, this.ipSalt),
      userAgent: input.userAgent,
    });

    return {
      ok: true,
      token,
      expiresAt,
      mustChangePassword: participant.mustChange,
    };
  }

  async signOut(token: string): Promise<void> {
    await this.sessions.revoke(token);
  }

  /** Spend the same time on a failure as on a success. See the header. */
  private async burnTime(password: string): Promise<void> {
    await verifyPassword(await DUMMY_HASH_PROMISE, password).catch(() => false);
  }
}
