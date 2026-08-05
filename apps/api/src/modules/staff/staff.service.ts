/**
 * Staff sign-in and session resolution (P12-03). Application layer — ADR-0006.
 *
 * Orchestration only. Every *decision* — may this account still be offered a
 * password check, is this session still good, must this role present a second
 * factor — is a pure function in `@ds/domain/staff-identity`, called with an
 * explicit `now`. This file supplies the clock, the hashing and the rows.
 *
 * ## The order of checks in `login`, and why it is that order
 *
 * 1. Look the account up. **Always** continue past a miss, with a decoy
 *    password verification, so an unknown address and a wrong password take the
 *    same time and return the same thing.
 * 2. Lockout, before the password. Checking the password first would let an
 *    attacker keep testing candidates against a locked account and learn from
 *    the timing which ones were close.
 * 3. Password.
 * 4. Second factor.
 *
 * A failure at 2, 3 or 4 returns the same opaque `invalid_credentials` to the
 * caller. Only the audit log knows which it was, which is where that
 * distinction belongs.
 */

import {
  canManage,
  lockoutStatus,
  resolveTenantContext,
  secondFactorStep,
  sessionStatus,
  verifyTotp,
  type AppRole,
  type RoleGrant,
  type StaffRole,
} from "@ds/domain";
import { SYSTEM_ACTOR, type AuditServicePort } from "../../audit/audit.service.js";
import {
  generateToken,
  hashIp,
  hashPassword,
  hashToken,
  verifyPassword,
} from "./credentials.js";
import { generateTotpSecret, otpauthUri, totpCode } from "./totp.js";
import type { SecretCipher } from "../../shared/secret-cipher.js";
import type {
  StaffAccount,
  StaffGrant,
  StaffRepositoryPort,
} from "./staff.repository.js";

/** What the caller is told. Deliberately coarse — see the header. */
export type LoginOutcome =
  | {
      readonly kind: "signed_in";
      readonly sessionToken: string;
      readonly csrfToken: string;
      readonly profile: StaffProfile;
    }
  /** Password was right; the account still owes a second factor. */
  | { readonly kind: "totp_required"; readonly challenge: string }
  /** Password was right; a required second factor has never been set up. */
  | { readonly kind: "totp_enrolment_required"; readonly challenge: string }
  | { readonly kind: "invalid_credentials" }
  | { readonly kind: "locked"; readonly until: Date };

export interface StaffProfile {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly grants: readonly StaffGrant[];
  /** The broadest role held — what the console builds its menu from. */
  readonly role: StaffRole;
  readonly capabilities: readonly string[];
}

export interface ResolvedStaffSession {
  readonly sessionId: string;
  readonly account: StaffAccount;
  readonly grants: readonly StaffGrant[];
  readonly csrfTokenHash: Buffer;
}

export type SessionFailure =
  "no_session" | "revoked" | "idle_timeout" | "absolute_timeout";

export interface StaffServiceDeps {
  readonly repository: StaffRepositoryPort;
  readonly audit: AuditServicePort;
  /** Salts the IP hash so it is not reversible by enumerating IPv4. */
  readonly ipSalt: string;
  /** Encrypts the TOTP secret at rest (CLAUDE.md §4 invariant 7). */
  readonly cipher: SecretCipher;
  /** What an authenticator app shows beside the code. */
  readonly totpIssuer: string;
  readonly now: () => Date;
}

export class StaffService {
  constructor(private readonly deps: StaffServiceDeps) {}

  async login(input: {
    email: string;
    password: string;
    userAgent: string | null;
    ip: string | null;
  }): Promise<LoginOutcome> {
    const now = this.deps.now();
    const account = await this.deps.repository.findByEmail(input.email);

    // The miss path does the same work as the hit path. `verifyPassword`
    // burns an Argon2 verification against a decoy when given `null`.
    if (account === undefined || account.disabledAt !== null) {
      await verifyPassword(null, input.password);
      await this.deps.audit.recordSystem({
        // No actor: on the unknown-account branch there is no id to name, and
        // naming one on the disabled branch would make the two distinguishable
        // in the log's shape.
        actor: SYSTEM_ACTOR,
        action: "staff.login_failed",
        // The address is recorded because the security log needs to show
        // credential stuffing against addresses that do not exist here.
        detail: { reason: account === undefined ? "unknown_account" : "disabled" },
      });
      return { kind: "invalid_credentials" };
    }

    const lock = lockoutStatus(
      { failedAttempts: account.failedAttempts, lastFailureAt: account.lastFailureAt },
      now,
    );
    if (lock.locked) {
      await verifyPassword(null, input.password);
      await this.deps.audit.recordSystem({
        actor: { identity: "staff", id: account.id },
        action: "staff.login_blocked_lockout",
      });
      return { kind: "locked", until: lock.until };
    }

    const ok = await verifyPassword(account.passwordHash, input.password);
    if (!ok) {
      await this.deps.repository.recordFailure(account.id, now);
      await this.deps.audit.recordSystem({
        actor: { identity: "staff", id: account.id },
        action: "staff.login_failed",
        detail: { reason: "bad_password" },
      });
      return { kind: "invalid_credentials" };
    }

    const grants = await this.deps.repository.grantsFor(account.id);
    const role = broadestRole(grants);
    if (role === undefined) {
      // Authenticated but holds no grant. Not a credential problem, and not
      // something to let through: there is nothing this person may do.
      await this.deps.audit.recordSystem({
        actor: { identity: "staff", id: account.id },
        action: "staff.login_no_grants",
      });
      return { kind: "invalid_credentials" };
    }

    const step = secondFactorStep(role, account.totpEnrolledAt !== null);
    if (step !== "not_required") {
      // The password is spent; the challenge carries the account forward
      // without the caller having to send it again. Short-lived and single-use
      // — issued as a session row that is not yet usable for anything else.
      const challenge = await this.issueChallenge(account, input);
      return step === "must_enrol"
        ? { kind: "totp_enrolment_required", challenge }
        : { kind: "totp_required", challenge };
    }

    return this.establishSession(account, grants, role, input, now);
  }

  /**
   * Resolve a presented session cookie.
   *
   * Returns a reason rather than `undefined` so the caller can tell a learner
   * "your session timed out" from "your access was withdrawn" — only one of
   * them means try again.
   */
  async resolveSession(
    sessionToken: string,
  ): Promise<ResolvedStaffSession | { readonly failure: SessionFailure }> {
    const now = this.deps.now();
    const row = await this.deps.repository.findSessionByToken(hashToken(sessionToken));
    if (row === undefined) return { failure: "no_session" };

    const verdict = sessionStatus(
      { createdAt: row.createdAt, lastSeenAt: row.lastSeenAt, revokedAt: row.revokedAt },
      now,
    );
    if (!verdict.valid) return { failure: verdict.reason };

    const account = await this.deps.repository.findById(row.adminUserId);
    if (account === undefined || account.disabledAt !== null) {
      // Disabling revokes sessions, but a race is possible and the account
      // being gone must win.
      await this.deps.repository.revokeSession(row.id, now);
      return { failure: "revoked" };
    }

    // Sliding idle window. Written on every request, which is a write per
    // request — acceptable for an admin console's traffic, and the alternative
    // (a periodic sweep) makes the idle timeout approximate.
    await this.deps.repository.touchSession(row.id, now);

    return {
      sessionId: row.id,
      account,
      grants: await this.deps.repository.grantsFor(account.id),
      csrfTokenHash: row.csrfTokenHash,
    };
  }

  async logout(sessionId: string): Promise<void> {
    await this.deps.repository.revokeSession(sessionId, this.deps.now());
  }

  /** "Sign out everywhere" — and what disabling an account must also do. */
  async logoutEverywhere(adminUserId: string): Promise<void> {
    await this.deps.repository.revokeAllSessions(adminUserId, this.deps.now());
  }

  /**
   * Set a password from an invitation or a reset link.
   *
   * Accepting the token and writing the password happen together, and every
   * existing session is revoked: a reset is what somebody does when they think
   * their account is compromised, and leaving the attacker's session alive
   * would defeat the point.
   */
  async redeemCredentialToken(input: {
    token: string;
    passwordHash: string;
  }): Promise<boolean> {
    const now = this.deps.now();
    const row = await this.deps.repository.findCredentialToken(hashToken(input.token));
    if (row === undefined) return false;

    await this.deps.repository.setPassword(row.adminUserId, input.passwordHash);
    await this.deps.repository.acceptCredentialToken(row.id, now);
    await this.deps.repository.revokeAllSessions(row.adminUserId, now);

    await this.deps.audit.recordSystem({
      actor: { identity: "staff", id: row.adminUserId },
      action: row.kind === "invite" ? "staff.invite_accepted" : "staff.password_reset",
    });
    return true;
  }

  /** Exposed so the controller can hash without importing the primitive. */
  hashPassword(password: string): Promise<string> {
    return hashPassword(password);
  }

  /**
   * Carry a half-finished login from the password step to the TOTP step.
   *
   * Reuses the session table deliberately: a challenge has the same lifetime
   * rules and the same revocation needs as a session, and a second table would
   * be the same expiry logic written twice.
   *
   * `purpose: "totp_challenge"` is what keeps it from *being* a session, and it
   * is not decoration. The first version of this relied on the client never
   * learning the row's CSRF token — which is no protection at all, because CSRF
   * is only checked on unsafe methods, so the challenge token authenticated
   * every `GET` in the admin API. The second factor could be skipped by using
   * the token the server hands you for not having passed it. See migration
   * 0022.
   */
  private async issueChallenge(
    account: StaffAccount,
    input: { userAgent: string | null; ip: string | null },
  ): Promise<string> {
    const token = generateToken();
    await this.deps.repository.createSession({
      adminUserId: account.id,
      tokenHash: hashToken(token),
      csrfTokenHash: hashToken(generateToken()),
      userAgent: input.userAgent,
      ipHash: input.ip === null ? null : hashIp(input.ip, this.deps.ipSalt),
      purpose: "totp_challenge",
    });
    await this.deps.audit.recordSystem({
      actor: { identity: "staff", id: account.id },
      action: "staff.totp_challenged",
    });
    return token;
  }

  // -------------------------------------------------------------------------
  // Second factor (P12-03)
  // -------------------------------------------------------------------------

  /**
   * Begin enrolment: mint a secret and return it once, as an `otpauth://` URI.
   *
   * Reached with a *challenge* token, not a session — the account has proved
   * its password and nothing else, and until `verifyTotp` succeeds it can do
   * nothing but this.
   *
   * The secret is staged, not enrolled. `totp_enrolled_at` stays null until a
   * code proves the authenticator app actually holds it; enrolling at the
   * moment the QR code is displayed would lock out anybody whose scan failed,
   * with no way back that does not involve database access.
   *
   * Calling this twice replaces the staged secret, which is what somebody who
   * closed the page before scanning needs. It cannot be used to replace an
   * *enrolled* secret: an enrolled account never reaches the enrolment branch
   * of `login`.
   */
  async beginTotpEnrolment(
    challengeToken: string,
  ): Promise<{ kind: "enrolling"; otpauthUri: string } | { kind: "rejected" }> {
    const account = await this.accountForChallenge(challengeToken);
    if (account === undefined) return { kind: "rejected" };

    // Refuse to re-issue for an already enrolled account even though `login`
    // should never route one here. A second factor that can be reset by
    // replaying an old challenge is not a second factor.
    if (account.totpEnrolledAt !== null) return { kind: "rejected" };

    const secret = generateTotpSecret();
    await this.deps.repository.stageTotpSecret(
      account.id,
      this.deps.cipher.encrypt(secret.toString("base64")),
    );
    await this.deps.audit.recordSystem({
      actor: { identity: "staff", id: account.id },
      action: "staff.totp_enrolment_started",
    });

    return {
      kind: "enrolling",
      otpauthUri: otpauthUri({
        secret,
        account: account.email,
        issuer: this.deps.totpIssuer,
      }),
    };
  }

  /**
   * Finish a login by presenting a code.
   *
   * Serves both paths — confirming a new enrolment and satisfying an existing
   * one — because they differ only in whether `totp_enrolled_at` gets set. A
   * separate "confirm enrolment" endpoint would be the same verification
   * written twice, and the second copy is where the replay check would be
   * forgotten.
   *
   * The challenge is spent whatever the outcome: a wrong code sends the
   * operator back to the password form. That is deliberately unforgiving —
   * allowing retries against a live challenge turns a 30-second window into an
   * unbounded one, and the cost of getting it wrong is retyping a password.
   */
  async verifyTotp(input: {
    challengeToken: string;
    code: string;
    userAgent: string | null;
    ip: string | null;
  }): Promise<LoginOutcome> {
    const now = this.deps.now();
    const challenge = await this.deps.repository.findChallengeByToken(
      hashToken(input.challengeToken),
    );
    if (challenge === undefined) return { kind: "invalid_credentials" };

    // A challenge ages out on the same rules as a session, which is far more
    // time than anyone needs to read six digits off a phone.
    const status = sessionStatus(
      {
        createdAt: challenge.createdAt,
        lastSeenAt: challenge.lastSeenAt,
        revokedAt: challenge.revokedAt,
      },
      now,
    );

    // Single-use, before anything is decided: a challenge that survived a wrong
    // guess would let an attacker walk the code space at leisure.
    await this.deps.repository.revokeSession(challenge.id, now);
    if (!status.valid) return { kind: "invalid_credentials" };

    const account = await this.deps.repository.findById(challenge.adminUserId);
    if (account === undefined || account.disabledAt !== null) {
      return { kind: "invalid_credentials" };
    }

    const secret = this.totpSecretOf(account);
    if (secret === undefined) return { kind: "invalid_credentials" };

    const verdict = verifyTotp({
      code: input.code,
      now,
      lastUsedCounter: account.totpLastCounter,
      codeFor: (counter) => totpCode(secret, counter),
    });

    if (!verdict.ok) {
      // Counted against the lockout, like a wrong password: without it the
      // second factor is six digits with unlimited attempts.
      await this.deps.repository.recordFailure(account.id, now);
      await this.deps.audit.recordSystem({
        actor: { identity: "staff", id: account.id },
        action: "staff.totp_failed",
        detail: { reason: verdict.reason },
      });
      return { kind: "invalid_credentials" };
    }

    const grants = await this.deps.repository.grantsFor(account.id);
    const role = broadestRole(grants);
    if (role === undefined) return { kind: "invalid_credentials" };

    if (account.totpEnrolledAt === null) {
      await this.deps.repository.completeTotpEnrolment(account.id, now, verdict.counter);
      await this.deps.audit.recordSystem({
        actor: { identity: "staff", id: account.id },
        action: "staff.totp_enrolled",
      });
    } else {
      await this.deps.repository.recordTotpCounter(account.id, verdict.counter);
    }

    return this.establishSession(account, grants, role, input, now);
  }

  private async accountForChallenge(token: string): Promise<StaffAccount | undefined> {
    const challenge = await this.deps.repository.findChallengeByToken(hashToken(token));
    if (challenge === undefined) return undefined;

    const status = sessionStatus(
      {
        createdAt: challenge.createdAt,
        lastSeenAt: challenge.lastSeenAt,
        revokedAt: challenge.revokedAt,
      },
      this.deps.now(),
    );
    if (!status.valid) return undefined;

    const account = await this.deps.repository.findById(challenge.adminUserId);
    return account === undefined || account.disabledAt !== null ? undefined : account;
  }

  /**
   * Decrypt the stored secret.
   *
   * A failure here means the stored ciphertext cannot be read with the current
   * KMS key — a key rotation that lost the old key, or a corrupted row. Either
   * way the honest answer is "this account has no usable second factor", not a
   * 500 that says the database is broken.
   */
  private totpSecretOf(account: StaffAccount): Buffer | undefined {
    if (account.totpSecretEnc === null) return undefined;
    try {
      const plaintext = this.deps.cipher.decrypt(account.totpSecretEnc);
      return plaintext === null ? undefined : Buffer.from(plaintext, "base64");
    } catch {
      return undefined;
    }
  }

  private async establishSession(
    account: StaffAccount,
    grants: readonly StaffGrant[],
    role: StaffRole,
    input: { userAgent: string | null; ip: string | null },
    now: Date,
  ): Promise<LoginOutcome> {
    const sessionToken = generateToken();
    const csrfToken = generateToken();

    await this.deps.repository.createSession({
      adminUserId: account.id,
      tokenHash: hashToken(sessionToken),
      csrfTokenHash: hashToken(csrfToken),
      userAgent: input.userAgent,
      ipHash: input.ip === null ? null : hashIp(input.ip, this.deps.ipSalt),
      purpose: "session",
    });
    await this.deps.repository.clearFailures(account.id, now);
    await this.deps.audit.recordSystem({
      actor: { identity: "staff", id: account.id },
      action: "staff.login_succeeded",
      detail: { role },
    });

    return {
      kind: "signed_in",
      sessionToken,
      csrfToken,
      profile: profileOf(account, grants, role),
    };
  }
}

/**
 * The broadest role a set of grants confers.
 *
 * Broadest rather than first: an account with both a `course_editor` grant on
 * one customer and a `customer_admin` grant on another is a customer
 * administrator, and a menu built from whichever row the database returned
 * first would flicker between the two.
 */
export function broadestRole(grants: readonly StaffGrant[]): StaffRole | undefined {
  const order: readonly StaffRole[] = [
    "course_editor",
    "department_admin",
    "customer_admin",
    "super_admin",
  ];
  let best: StaffRole | undefined;
  for (const grant of grants) {
    if (best === undefined || order.indexOf(grant.role) > order.indexOf(best)) {
      best = grant.role;
    }
  }
  return best;
}

function profileOf(
  account: StaffAccount,
  grants: readonly StaffGrant[],
  role: StaffRole,
): StaffProfile {
  const entities = [
    "customer",
    "department",
    "project",
    "course",
    "content",
    "staff_user",
    "learner_record",
    "certificate",
  ] as const;

  return {
    id: account.id,
    email: account.email,
    displayName: account.displayName,
    grants,
    role,
    capabilities: entities.filter((entity) => canManage(role, entity)),
  };
}

/**
 * Which customer a staff request acts within.
 *
 * The same `resolveTenantContext` the learner plane uses, so the two
 * authentication paths cannot diverge on *authorization* even though they are
 * deliberately separate on authentication (ADR-0012).
 */
export function staffTenantContext(
  grants: readonly StaffGrant[],
  customerId: string,
): ReturnType<typeof resolveTenantContext> {
  // `RoleGrant.role` is `AppRole`, which is `StaffRole` plus `learner`. Every
  // StaffRole is an AppRole, so the widening is safe and explicit here rather
  // than a cast at the call site.
  const asRoleGrants: RoleGrant[] = grants.map((grant) => ({
    role: grant.role satisfies AppRole,
    customerId: grant.customerId,
    departmentId: grant.departmentId,
  }));
  return resolveTenantContext(asRoleGrants, customerId);
}
