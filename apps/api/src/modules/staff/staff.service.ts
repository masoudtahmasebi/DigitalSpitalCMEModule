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
  applicableSecondFactorPolicy,
  canRemoveOwnSecondFactor,
  canResetSecondFactorOf,
  DEFAULT_CUSTOMER_SECOND_FACTOR,
  canGrant,
  inviteStatus,
  resetStatus,
  sessionStatus,
  verifyTotp,
  type AppRole,
  type StaffScope,
  type RoleGrant,
  type StaffRole,
  type SecondFactorPolicy,
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
  StaffAccountSummary,
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
  /** Whether this operator has a second factor set up (P22-02). */
  readonly secondFactorEnrolled: boolean;
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

    // Which policy applies is the account's *scope*, not its role (P22-02).
    // `applicableSecondFactorPolicy` takes the strictest of the scopes these
    // grants reach, so an operator who can act inside a customer that requires
    // a second factor presents one — holding a relaxed grant elsewhere is not
    // a way around it.
    const policy = await this.policyFor(grants);
    const step = secondFactorStep(policy, account.totpEnrolledAt !== null);
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
   *
   * ## The state check, and what it was like without one (P39-01)
   *
   * `inviteStatus` and `resetStatus` were written in `@ds/domain`, exported,
   * unit-tested against their boundaries — and **called from nowhere**. This
   * method looked the token up by hash and, if a row came back, set the
   * password. It read `created_at`, `accepted_at` and `revoked_at` out of the
   * database and used none of them.
   *
   * Three consequences, and each is an account takeover on the console:
   *
   * - **Nothing expired.** `INVITE_VALID_DAYS = 7` and
   *   `RESET_VALID_MINUTES = 60` were documentation. A link in an inbox worked
   *   a year later.
   * - **Nothing was spent.** `acceptCredentialToken` sets `accepted_at` only
   *   while it is null, so a second redemption changed no row — but
   *   `setPassword` had already run. The same link could be replayed forever,
   *   each time choosing a new password for somebody else's account.
   * - **Revocation did nothing.** `issueCredentialToken` revokes any
   *   outstanding token of the same kind precisely so a forwarded invitation
   *   stops working. That `UPDATE` was write-only.
   *
   * So the rule is consulted here, and the two lifetimes are kept apart by
   * `kind` — an invitation is an offer to somebody with no account yet, a reset
   * link is a live bypass of the password on an account that already exists.
   */
  async redeemCredentialToken(input: {
    token: string;
    passwordHash: string;
  }): Promise<boolean> {
    const now = this.deps.now();
    const row = await this.deps.repository.findCredentialToken(hashToken(input.token));
    if (row === undefined) return false;

    const verdict =
      row.kind === "invite" ? inviteStatus(row, now) : resetStatus(row, now);
    if (verdict !== "valid") {
      // Not distinguished for the caller — `redeem` answers "this link is no
      // longer valid" for every reason alike, so a spent link cannot be told
      // from one that never existed. Recorded here, because an expired link
      // being presented is ordinary and a *revoked* one being presented is
      // somebody using a link that was taken away from them.
      await this.deps.audit.recordSystem({
        actor: { identity: "staff", id: row.adminUserId },
        action: "staff.credential_token_refused",
        detail: { kind: row.kind, verdict },
      });
      return false;
    }

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

  // -------------------------------------------------------------------------
  // Operator accounts (P12-05)
  // -------------------------------------------------------------------------

  /**
   * The accounts this operator may see.
   *
   * Narrowed by `canGrant`: an operator who may not grant to a scope has no
   * business reading the accounts in it either. A `customer_admin` therefore
   * sees their own customer's operators and not another customer's, and not
   * the super administrators above them.
   *
   * The narrowing is the *authorisation* here, because `admin_users` is not
   * tenant-scoped — a super admin belongs to no customer, so there is no RLS
   * policy that could express this.
   */
  async listAccounts(actor: StaffScope): Promise<readonly StaffAccountSummary[]> {
    const accounts = await this.deps.repository.listAccounts();
    return accounts.filter((account) =>
      account.grants.some((grant) => canGrant(actor, scopeOf(grant)).ok),
    );
  }

  /**
   * Invite somebody, returning the single-use token.
   *
   * The token is returned to the caller rather than emailed. That is a
   * deliberate stopping point, not an oversight: sending it needs a sender
   * address per customer and a template, and a half-built mail path that
   * silently drops an invitation is worse than handing the operator a link to
   * pass on themselves. The token is single-use and the account has no password
   * until it is redeemed.
   */
  async inviteAccount(
    input: {
      email: string;
      displayName: string;
      role: StaffRole;
      customerId: string | null;
      departmentId: string | null;
    },
    actor: StaffScope & { readonly id: string },
  ): Promise<{ kind: "invited"; token: string } | { kind: "refused"; reason: string }> {
    const target: StaffScope = {
      role: input.role,
      customerId: input.customerId,
      departmentId: input.departmentId,
    };

    // The whole authorisation, in one pure call: capability, then rank, then
    // self-escalation, then scope (P12-01b).
    const check = canGrant(actor, target);
    if (!check.ok) return { kind: "refused", reason: check.reason };

    const adminUserId = await this.deps.repository.createAccount({
      email: input.email,
      displayName: input.displayName,
    });
    await this.deps.repository.replaceGrants(adminUserId, [
      {
        role: input.role,
        customerId: input.customerId,
        departmentId: input.departmentId,
      },
    ]);

    const token = generateToken();
    await this.deps.repository.issueCredentialToken({
      adminUserId,
      kind: "invite",
      tokenHash: hashToken(token),
      issuedBy: actor.id,
    });

    await this.deps.audit.recordSystem({
      actor: { identity: "staff", id: actor.id },
      action: "staff.invited",
      subject: adminUserId,
      // The role and scope, never the address — it is personal data and the
      // account id is enough to find the row.
      detail: { role: input.role, scoped: input.customerId !== null },
    });

    return { kind: "invited", token };
  }

  /**
   * Change what an account may reach.
   *
   * Checked twice: the actor must be able to grant the *new* scope, and must
   * already have been able to grant the *old* one. Only checking the new scope
   * would let a customer administrator narrow a super administrator into their
   * own customer and then manage them.
   */
  async setScope(
    adminUserId: string,
    target: StaffScope,
    actor: StaffScope & { readonly id: string },
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    const accounts = await this.deps.repository.listAccounts();
    const account = accounts.find((candidate) => candidate.id === adminUserId);
    if (account === undefined) return { ok: false, reason: "not_found" };

    const isSelf = account.id === actor.id;
    for (const existing of account.grants) {
      const check = canGrant(actor, scopeOf(existing), { targetIsSelf: isSelf });
      if (!check.ok) return { ok: false, reason: check.reason };
    }

    const check = canGrant(actor, target, { targetIsSelf: isSelf });
    if (!check.ok) return { ok: false, reason: check.reason };

    await this.deps.repository.replaceGrants(adminUserId, [
      {
        role: target.role,
        customerId: target.customerId,
        departmentId: target.departmentId,
      },
    ]);
    await this.deps.audit.recordSystem({
      actor: { identity: "staff", id: actor.id },
      action: "staff.scope_changed",
      subject: adminUserId,
      detail: { role: target.role },
    });
    return { ok: true };
  }

  /**
   * Disable an account, or re-enable it.
   *
   * Disabling revokes every session in the same statement — "disabled but still
   * signed in somewhere" is the state a two-step version leaves behind when the
   * second step fails.
   */
  async setAccountDisabled(
    adminUserId: string,
    disabled: boolean,
    actor: StaffScope & { readonly id: string },
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    if (adminUserId === actor.id) {
      // Locking yourself out of the console is not a thing to allow by
      // accident, and there is no legitimate reason to do it deliberately.
      return { ok: false, reason: "cannot_disable_self" };
    }

    const accounts = await this.deps.repository.listAccounts();
    const account = accounts.find((candidate) => candidate.id === adminUserId);
    if (account === undefined) return { ok: false, reason: "not_found" };

    for (const existing of account.grants) {
      const check = canGrant(actor, scopeOf(existing));
      if (!check.ok) return { ok: false, reason: check.reason };
    }

    await this.deps.repository.setDisabled(
      adminUserId,
      disabled ? this.deps.now() : null,
    );
    await this.deps.audit.recordSystem({
      actor: { identity: "staff", id: actor.id },
      action: disabled ? "staff.disabled" : "staff.enabled",
      subject: adminUserId,
    });
    return { ok: true };
  }

  /** Sign an account out of every browser it is signed in on. */
  async signOutEverywhere(
    adminUserId: string,
    actor: StaffScope & { readonly id: string },
  ): Promise<void> {
    await this.deps.repository.revokeAllSessions(adminUserId, this.deps.now());
    await this.deps.audit.recordSystem({
      actor: { identity: "staff", id: actor.id },
      action: "staff.sessions_revoked",
      subject: adminUserId,
    });
  }

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

  /**
   * The second-factor policy governing an account with these grants.
   *
   * One read of the whole table rather than a lookup per grant — see the port.
   */
  private async policyFor(grants: readonly StaffGrant[]): Promise<SecondFactorPolicy> {
    const { platform, perCustomer } = await this.deps.repository.secondFactorPolicies();
    return applicableSecondFactorPolicy(grants, platform, perCustomer);
  }

  /** What the console shows on its security screen (P22-02). */
  async readSecondFactorPolicies(): Promise<{
    platform: SecondFactorPolicy;
    perCustomer: ReadonlyMap<string, SecondFactorPolicy>;
  }> {
    return this.deps.repository.secondFactorPolicies();
  }

  /**
   * Change the policy for one scope (P22-02).
   *
   * `customerId: null` is the platform's own — the scope a super administrator
   * belongs to — and only a super administrator may set it. Anyone else would
   * be deciding, from inside a customer, how strictly the platform's
   * unrestricted accounts are protected.
   *
   * Audited unconditionally, and `weakened` is carried in the entry rather than
   * left to be reconstructed: "somebody relaxed a security policy" is the fact
   * an auditor scans for, and making them diff two rows to find it is how it
   * gets missed.
   */
  async setSecondFactorPolicy(input: {
    actor: StaffProfile;
    customerId: string | null;
    policy: SecondFactorPolicy;
  }): Promise<{ readonly ok: boolean; readonly reason?: string }> {
    if (input.customerId === null && input.actor.role !== "super_admin") {
      return {
        ok: false,
        reason: "only a super administrator may set the platform policy",
      };
    }

    if (input.customerId !== null) {
      if (!canManage(input.actor.role, "staff_user")) {
        return { ok: false, reason: "your role does not manage staff accounts" };
      }
      const reaches =
        input.actor.role === "super_admin" ||
        input.actor.grants.some((grant) => grant.customerId === input.customerId);
      if (!reaches) {
        return { ok: false, reason: "you hold no grant reaching that customer" };
      }
    }

    const before = await this.deps.repository.secondFactorPolicies();
    const previous =
      input.customerId === null
        ? before.platform
        : (before.perCustomer.get(input.customerId) ?? DEFAULT_CUSTOMER_SECOND_FACTOR);

    await this.deps.repository.setSecondFactorPolicy({
      customerId: input.customerId,
      policy: input.policy,
      updatedBy: input.actor.id,
      at: this.deps.now(),
    });

    await this.deps.audit.recordSystem({
      actor: { identity: "staff", id: input.actor.id },
      action: "staff.second_factor_policy_changed",
      ...(input.customerId === null ? {} : { subject: input.customerId }),
      detail: {
        scope: input.customerId === null ? "platform" : "customer",
        from: previous,
        to: input.policy,
        weakened: strictness(input.policy) < strictness(previous),
      },
    });

    return { ok: true };
  }

  /**
   * An operator takes their own second factor off (P22-02).
   *
   * Refused under a `required` policy — otherwise the policy is advisory rather
   * than a policy.
   */
  async removeOwnSecondFactor(input: {
    accountId: string;
    grants: readonly StaffGrant[];
  }): Promise<{ readonly ok: boolean; readonly reason?: string }> {
    const policy = await this.policyFor(input.grants);
    if (!canRemoveOwnSecondFactor(policy)) {
      return { ok: false, reason: "the second factor is mandatory for your account" };
    }

    await this.deps.repository.clearSecondFactor(input.accountId);
    await this.deps.audit.recordSystem({
      actor: { identity: "staff", id: input.accountId },
      action: "staff.second_factor_removed",
      detail: { policy, by: "self" },
    });
    return { ok: true };
  }

  /**
   * An administrator clears somebody else's second factor (P22-02).
   *
   * The lost-device path, which the platform had none of: an enrolled operator
   * whose phone was gone was locked out permanently, with no reset anywhere in
   * the product. For a super administrator — the one role that was *forced* to
   * enrol — that meant a lost device could end the platform's only unrestricted
   * account.
   *
   * It does **not** sign the target in and does not relax their policy. Under
   * `required` their next sign-in goes to enrolment, so access is restored
   * without the bar moving. Every session they hold is revoked: an account
   * whose second factor just became recoverable should not carry a session
   * minted under the old one.
   */
  async resetSecondFactorOf(input: {
    actor: StaffProfile;
    targetId: string;
  }): Promise<{ readonly ok: boolean; readonly reason?: string }> {
    const target = await this.deps.repository.findById(input.targetId);
    if (target === undefined) return { ok: false, reason: "not_found" };

    const targetGrants = await this.deps.repository.grantsFor(target.id);
    const targetRole = broadestRole(targetGrants);
    // No grants means nothing to restore access *to*, and it is also how a
    // caller would probe for the existence of an account they may not manage —
    // so it answers the same way an unknown id does.
    if (targetRole === undefined) return { ok: false, reason: "not_found" };

    const verdict = canResetSecondFactorOf(
      {
        accountId: input.actor.id,
        role: input.actor.role,
        customerId: input.actor.grants[0]?.customerId ?? null,
        departmentId: input.actor.grants[0]?.departmentId ?? null,
      },
      {
        accountId: target.id,
        role: targetRole,
        customerId: targetGrants[0]?.customerId ?? null,
        departmentId: targetGrants[0]?.departmentId ?? null,
      },
    );
    if (!verdict.ok) return { ok: false, reason: verdict.reason };

    const now = this.deps.now();
    await this.deps.repository.clearSecondFactor(target.id);
    await this.deps.repository.revokeAllSessions(target.id, now);

    await this.deps.audit.recordSystem({
      actor: { identity: "staff", id: input.actor.id },
      action: "staff.second_factor_reset",
      subject: target.id,
      detail: { targetRole },
    });

    return { ok: true };
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
    // Whether *this* operator has a second factor, so the console can offer to
    // remove it without a second round trip and without guessing (P22-02). A
    // boolean, not the secret or the enrolment date: neither is the console's
    // business, and one of them is a credential.
    secondFactorEnrolled: account.totpEnrolledAt !== null,
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

/** A grant as the pure rules see it. */
function scopeOf(grant: StaffGrant): StaffScope {
  return {
    role: grant.role,
    customerId: grant.customerId,
    departmentId: grant.departmentId,
  };
}

/**
 * How strict a policy is, for reporting *which direction* a change went.
 *
 * The ordering that decides which policy applies lives in `@ds/domain`; this is
 * only used to label an audit entry `weakened: true`. Duplicating three numbers
 * is cheaper than exporting an implementation detail of the pure rule and then
 * having two places that must agree on what it means.
 */
function strictness(policy: SecondFactorPolicy): number {
  switch (policy) {
    case "disabled":
      return 0;
    case "optional":
      return 1;
    case "required":
      return 2;
  }
}
