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
import {
  generateToken,
  hashIp,
  hashPassword,
  hashToken,
  verifyPassword,
} from "../staff/credentials.js";
import { resetStatus } from "@ds/domain";
import { canSend, sendNow } from "../../shared/mailer.js";
import { participantResetEmail } from "../staff/reset.copy.js";
import type { SecretCipher } from "../../shared/secret-cipher.js";
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
    /** Decrypts the project's stored SMTP password for one send (P40-03). */
    private readonly cipher: SecretCipher,
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

    // Disabled by an administrator (P21-04). Checked before the password, and
    // refused with the same answer as everything else — "your account has been
    // disabled" tells anybody holding a stolen address that it is a real one.
    //
    // This is the check that makes the console's "sperren" button mean
    // something. Without it, disabling an account writes a timestamp nothing
    // reads, and the person keeps signing in.
    if (participant.disabledAt !== null) {
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

  /**
   * The credential state behind a signed-in participant, for `me`.
   *
   * `undefined` for a federated one — they have no local password, and saying
   * so by omission is more honest than reporting `mustChange: false`, which
   * would imply there is a password and it is fine.
   */
  async credentialState(
    userId: string,
  ): Promise<{ mustChange: boolean; disabled: boolean } | undefined> {
    const credential = await this.repository.credentialForUser(userId);
    return credential === undefined
      ? undefined
      : { mustChange: credential.mustChange, disabled: credential.disabledAt !== null };
  }

  /**
   * A participant choosing their own password (P21-04).
   *
   * ## Why the current password is required
   *
   * The caller already holds a valid session, so this could take the new
   * password alone. It does not, because a session is a *bearer* credential: a
   * cookie captured on a shared clinic computer would otherwise be enough to
   * change the password and lock the physician out of their own CME record. Re-
   * proving knowledge of the password is what makes that one step harder.
   *
   * ## What it deliberately does not do
   *
   * It does not revoke the participant's other sessions. That reads like a
   * safety measure and is the wrong one here: `must_change` means this runs
   * immediately after a sign-in, and killing the session that is performing the
   * change would sign somebody out of a password change they just completed.
   * Ending sessions is what an administrator's reset does, and there the intent
   * is exactly the opposite.
   */
  async changePassword(input: {
    userId: string;
    currentPassword: string;
    newPassword: string;
  }): Promise<{ ok: boolean }> {
    const credential = await this.repository.credentialForUser(input.userId);

    // A federated participant, or a disabled one. Both refused, and identically
    // — the caller is already authenticated, so there is no enumeration to
    // worry about, but there is also nothing useful to tell them apart with.
    if (credential === undefined || credential.disabledAt !== null) {
      await this.burnTime(input.currentPassword);
      return { ok: false };
    }

    if (!(await verifyPassword(credential.passwordHash, input.currentPassword))) {
      await this.repository.recordFailure(
        credential.identityId,
        LOCKOUT_THRESHOLD,
        LOCKOUT_INTERVAL,
      );
      return { ok: false };
    }

    await this.repository.replacePassword(
      credential.identityId,
      await hashPassword(input.newPassword),
    );
    return { ok: true };
  }

  // --- Passwort vergessen (P40-03) -----------------------------------------

  /**
   * Ask for a reset link.
   *
   * Resolves nothing back to the caller — the controller answers 202 in every
   * case — for the same reason the staff plane's does: a different answer for a
   * known address turns the form into a way of asking "is this physician
   * enrolled with this customer", which is health-adjacent information about a
   * named person.
   *
   * The tenant is not the caller's to choose. It comes from
   * `resolve_project_binding` for the slug in `X-DS-Project`, exactly as
   * sign-in does, so a request naming one customer cannot reach an account
   * belonging to another — a person with the same address at two customers has
   * two credentials, and only the one for the named project is touched.
   */
  async beginPasswordReset(input: {
    projectSlug: string;
    email: string;
    resetUrl: (token: string) => string;
  }): Promise<void> {
    const project = await this.repository.findProject(input.projectSlug);
    // Also the `keycloak` case: a federated participant's password is not ours
    // to reset, and offering to would send them a link that cannot work.
    if (project === undefined || project.identityProvider !== "local") return;

    const participant = await this.repository.findParticipant(
      input.email,
      project.customerId,
    );
    if (participant === undefined || participant.disabledAt !== null) return;

    const sender = await this.repository.projectSender(
      project.customerId,
      project.projectId,
    );
    // No sender on the project means no way to deliver, so no token is minted:
    // a live credential in the database that nobody can ever spend is worse
    // than nothing.
    if (!canSend({ host: sender.host, fromAddress: sender.fromAddress })) return;

    const token = generateToken();
    await this.repository.issueResetToken({
      userIdentityId: participant.identityId,
      projectId: project.projectId,
      tokenHash: hashToken(token),
    });

    await sendNow(
      {
        host: sender.host ?? "",
        port: sender.port,
        username: sender.username,
        password:
          sender.passwordEnc === null ? null : this.cipher.decrypt(sender.passwordEnc),
        // Implicit TLS is inferred from the port, since `projects` has no
        // column for it: 465 is the only port on which SMTP is TLS from the
        // first byte.
        secure: sender.port === 465,
        fromAddress: sender.fromAddress ?? "",
        fromName: sender.fromName,
      },
      { ...participantResetEmail(input.resetUrl(token)), to: input.email },
    );
  }

  /**
   * Spend a reset link and set the password.
   *
   * The state check is not optional and its absence is a whole ticket on the
   * other plane (P39-01): without it a link never expires, can be replayed
   * indefinitely, and cannot be revoked. `resetStatus` owns the rule.
   */
  async completePasswordReset(input: {
    token: string;
    newPassword: string;
    now: Date;
  }): Promise<{ ok: boolean }> {
    const row = await this.repository.findResetToken(hashToken(input.token));
    if (row === undefined) return { ok: false };
    if (resetStatus(row, input.now) !== "valid") return { ok: false };

    await this.repository.replacePassword(
      row.userIdentityId,
      await hashPassword(input.newPassword),
    );
    await this.repository.acceptResetToken(row.id, input.now);
    return { ok: true };
  }

  /** Spend the same time on a failure as on a success. See the header. */
  private async burnTime(password: string): Promise<void> {
    await verifyPassword(await DUMMY_HASH_PROMISE, password).catch(() => false);
  }
}
