/**
 * Data access for staff accounts (P12-03). Infrastructure layer — ADR-0006.
 *
 * Runs on the raw pool, outside the tenant transaction, for the same reason
 * `UserRepository` does: a staff member's grants are what `app.customer_id` is
 * *derived from*, so a policy keyed on it could not be satisfied at the moment
 * these rows have to be read. ADR-0002 §6 records the exception.
 *
 * The scoping is by identity instead, and structurally: **every lookup here is
 * by a value the caller proved they hold** — a session token hash, an
 * invitation token hash, an email plus a password. There is no method that
 * takes an account id from a request, which is what makes the absence of RLS
 * safe rather than merely explained.
 */

import type { Pool } from "pg";
import { DEFAULT_PLATFORM_SECOND_FACTOR } from "@ds/domain";
import type { SecondFactorPolicy, StaffRole } from "@ds/domain";

export interface StaffAccount {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly passwordHash: string | null;
  readonly totpSecretEnc: Buffer | null;
  readonly totpEnrolledAt: Date | null;
  readonly totpLastCounter: number | null;
  readonly failedAttempts: number;
  readonly lastFailureAt: Date | null;
  readonly disabledAt: Date | null;
}

/**
 * The platform's sender, as stored (P40-01).
 *
 * `passwordEnc` is the ciphertext and never leaves the repository layer as
 * anything else — the service decrypts it for one send and the controller
 * never sees either form. `hasPassword` is what the console is told.
 */
export interface PlatformSmtpRow {
  readonly host: string | null;
  readonly port: number | null;
  readonly username: string | null;
  readonly passwordEnc: Buffer | null;
  readonly secure: boolean;
  readonly fromAddress: string | null;
  readonly fromName: string | null;
  readonly updatedAt: Date;
}

export interface PlatformSmtpWrite {
  readonly host: string | null;
  readonly port: number | null;
  readonly username: string | null;
  /**
   * Absent means "keep what is stored" and `null` means "clear it".
   *
   * The same three-way distinction the project SMTP form makes, and for the
   * same reason: an operator editing the sender name must not silently wipe
   * the credential because the password box was empty.
   */
  readonly passwordEnc?: Buffer | null;
  readonly secure: boolean;
  readonly fromAddress: string | null;
  readonly fromName: string | null;
  readonly updatedBy: string;
}

export interface StaffGrant {
  readonly role: StaffRole;
  readonly customerId: string | null;
  readonly departmentId: string | null;
}

/** What an `admin_sessions` row is for (migration 0022). */
export type SessionPurpose = "session" | "totp_challenge";

export interface StaffSessionRow {
  readonly id: string;
  readonly adminUserId: string;
  readonly csrfTokenHash: Buffer;
  readonly createdAt: Date;
  readonly lastSeenAt: Date;
  readonly revokedAt: Date | null;
}

export interface CredentialTokenRow {
  readonly id: string;
  readonly adminUserId: string;
  readonly kind: "invite" | "reset";
  readonly createdAt: Date;
  readonly acceptedAt: Date | null;
  readonly revokedAt: Date | null;
}

export interface StaffAccountSummary {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly disabledAt: Date | null;
  readonly lastLoginAt: Date | null;
  readonly totpEnrolled: boolean;
  readonly grants: readonly StaffGrant[];
}

export interface StaffRepositoryPort {
  findByEmail(email: string): Promise<StaffAccount | undefined>;
  findById(id: string): Promise<StaffAccount | undefined>;
  grantsFor(adminUserId: string): Promise<readonly StaffGrant[]>;

  recordFailure(adminUserId: string, at: Date): Promise<void>;
  clearFailures(adminUserId: string, at: Date): Promise<void>;

  createSession(input: {
    adminUserId: string;
    tokenHash: Buffer;
    csrfTokenHash: Buffer;
    userAgent: string | null;
    ipHash: Buffer | null;
    /** `session` authenticates requests; `totp_challenge` never does. */
    purpose: SessionPurpose;
  }): Promise<StaffSessionRow>;
  /** Only ever returns `purpose = 'session'` rows — see migration 0022. */
  findSessionByToken(tokenHash: Buffer): Promise<StaffSessionRow | undefined>;
  /** Only ever returns `purpose = 'totp_challenge'` rows. */
  findChallengeByToken(tokenHash: Buffer): Promise<StaffSessionRow | undefined>;
  touchSession(sessionId: string, at: Date): Promise<void>;
  revokeSession(sessionId: string, at: Date): Promise<void>;
  revokeAllSessions(adminUserId: string, at: Date): Promise<void>;

  /** Stores an encrypted secret before it is confirmed. Does not enrol. */
  stageTotpSecret(adminUserId: string, secretEnc: Buffer): Promise<void>;
  /** Marks the staged secret confirmed, and records the counter it was confirmed with. */
  completeTotpEnrolment(adminUserId: string, at: Date, counter: number): Promise<void>;
  recordTotpCounter(adminUserId: string, counter: number): Promise<void>;

  listAccounts(): Promise<readonly StaffAccountSummary[]>;
  createAccount(input: { email: string; displayName: string }): Promise<string>;
  issueCredentialToken(input: {
    adminUserId: string;
    kind: "invite" | "reset";
    tokenHash: Buffer;
    /**
     * `null` for a self-service reset (P40-02).
     *
     * Which is what migration 0017's column comment already said —
     * *"Null for a self-service reset, which nobody issued"* — while the type
     * here required an id, so the only reachable caller was an invitation.
     */
    issuedBy: string | null;
  }): Promise<void>;

  // --- the platform's own sender (P40-01) ----------------------------------

  readPlatformSmtp(): Promise<PlatformSmtpRow>;
  writePlatformSmtp(input: PlatformSmtpWrite): Promise<void>;
  replaceGrants(
    adminUserId: string,
    grants: readonly {
      role: StaffRole;
      customerId: string | null;
      departmentId: string | null;
    }[],
  ): Promise<void>;
  setDisabled(adminUserId: string, at: Date | null): Promise<boolean>;

  findCredentialToken(tokenHash: Buffer): Promise<CredentialTokenRow | undefined>;
  acceptCredentialToken(id: string, at: Date): Promise<void>;
  setPassword(adminUserId: string, passwordHash: string): Promise<void>;

  // --- second-factor policy (P22-02) ---------------------------------------

  /**
   * Every policy row: the platform's, keyed `null`, and one per customer that
   * has set one.
   *
   * All of them in one query rather than one lookup per grant, because this
   * runs on the sign-in path and the table has one row per customer — a
   * handful, not a scale problem. Reading them together also means the
   * strictest-wins rule sees a consistent snapshot rather than a sequence of
   * reads a policy change could interleave with.
   */
  secondFactorPolicies(): Promise<{
    readonly platform: SecondFactorPolicy;
    readonly perCustomer: ReadonlyMap<string, SecondFactorPolicy>;
  }>;

  setSecondFactorPolicy(input: {
    customerId: string | null;
    policy: SecondFactorPolicy;
    updatedBy: string;
    at: Date;
  }): Promise<void>;

  /**
   * Forget an account's second factor entirely.
   *
   * The secret *and* the replay counter. Leaving the counter would carry a high
   * mark from a device that no longer exists onto whatever replaces it, and
   * `totp_enrolled_at` going NULL is what sends the next sign-in to enrolment
   * rather than to a code prompt — so this restores access without lowering the
   * bar under a `required` policy.
   */
  clearSecondFactor(adminUserId: string): Promise<void>;
}

interface AccountRow {
  id: string;
  email: string;
  display_name: string;
  password_hash: string | null;
  totp_secret_enc: Buffer | null;
  totp_enrolled_at: Date | null;
  totp_last_counter: string | null;
  failed_attempts: number;
  last_failure_at: Date | null;
  disabled_at: Date | null;
}

const ACCOUNT_COLUMNS = `
  id, email, display_name, password_hash, totp_secret_enc, totp_enrolled_at,
  totp_last_counter, failed_attempts, last_failure_at, disabled_at
`;

function toAccount(row: AccountRow): StaffAccount {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    passwordHash: row.password_hash,
    totpSecretEnc: row.totp_secret_enc,
    totpEnrolledAt: row.totp_enrolled_at,
    // bigint arrives as a string from node-postgres; a counter is well inside
    // Number's exact range (it is seconds/30 since 1970) so this is lossless.
    totpLastCounter:
      row.totp_last_counter === null ? null : Number(row.totp_last_counter),
    failedAttempts: row.failed_attempts,
    lastFailureAt: row.last_failure_at,
    disabledAt: row.disabled_at,
  };
}

export class StaffRepository implements StaffRepositoryPort {
  constructor(private readonly pool: Pool) {}

  /**
   * Case-insensitive, matching the `lower(email)` unique index.
   *
   * Nobody remembers how they capitalised their own address, and two accounts
   * differing only in case would be an account-takeover vector rather than a
   * feature.
   */
  async findByEmail(email: string): Promise<StaffAccount | undefined> {
    const { rows } = await this.pool.query<AccountRow>(
      `SELECT ${ACCOUNT_COLUMNS} FROM admin_users WHERE lower(email) = lower($1)`,
      [email],
    );
    const row = rows[0];
    return row === undefined ? undefined : toAccount(row);
  }

  async findById(id: string): Promise<StaffAccount | undefined> {
    const { rows } = await this.pool.query<AccountRow>(
      `SELECT ${ACCOUNT_COLUMNS} FROM admin_users WHERE id = $1`,
      [id],
    );
    const row = rows[0];
    return row === undefined ? undefined : toAccount(row);
  }

  async grantsFor(adminUserId: string): Promise<readonly StaffGrant[]> {
    const { rows } = await this.pool.query<{
      role: StaffRole;
      customer_id: string | null;
      department_id: string | null;
    }>(
      `SELECT role, customer_id, department_id FROM admin_user_roles WHERE admin_user_id = $1`,
      [adminUserId],
    );
    return rows.map((row) => ({
      role: row.role,
      customerId: row.customer_id,
      departmentId: row.department_id,
    }));
  }

  async recordFailure(adminUserId: string, at: Date): Promise<void> {
    await this.pool.query(
      `UPDATE admin_users
          SET failed_attempts = failed_attempts + 1, last_failure_at = $2, updated_at = now()
        WHERE id = $1`,
      [adminUserId, at],
    );
  }

  async clearFailures(adminUserId: string, at: Date): Promise<void> {
    await this.pool.query(
      `UPDATE admin_users
          SET failed_attempts = 0, last_failure_at = NULL, last_login_at = $2, updated_at = now()
        WHERE id = $1`,
      [adminUserId, at],
    );
  }

  async createSession(input: {
    adminUserId: string;
    tokenHash: Buffer;
    csrfTokenHash: Buffer;
    userAgent: string | null;
    ipHash: Buffer | null;
    purpose: SessionPurpose;
  }): Promise<StaffSessionRow> {
    const { rows } = await this.pool.query<{
      id: string;
      admin_user_id: string;
      csrf_token_hash: Buffer;
      created_at: Date;
      last_seen_at: Date;
      revoked_at: Date | null;
    }>(
      `INSERT INTO admin_sessions (admin_user_id, token_hash, csrf_token_hash, user_agent, ip_hash, purpose)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, admin_user_id, csrf_token_hash, created_at, last_seen_at, revoked_at`,
      [
        input.adminUserId,
        input.tokenHash,
        input.csrfTokenHash,
        input.userAgent,
        input.ipHash,
        input.purpose,
      ],
    );
    const row = rows[0];
    if (row === undefined) throw new Error("session insert returned no row");
    return {
      id: row.id,
      adminUserId: row.admin_user_id,
      csrfTokenHash: row.csrf_token_hash,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
      revokedAt: row.revoked_at,
    };
  }

  /**
   * Resolve a session cookie.
   *
   * The `purpose` predicate is the whole point of migration 0022 and must not
   * be dropped: without it, the token handed to a caller who has *not yet*
   * passed the second factor authenticates them for every safe method.
   */
  findSessionByToken(tokenHash: Buffer): Promise<StaffSessionRow | undefined> {
    return this.findByToken(tokenHash, "session");
  }

  findChallengeByToken(tokenHash: Buffer): Promise<StaffSessionRow | undefined> {
    return this.findByToken(tokenHash, "totp_challenge");
  }

  private async findByToken(
    tokenHash: Buffer,
    purpose: SessionPurpose,
  ): Promise<StaffSessionRow | undefined> {
    const { rows } = await this.pool.query<{
      id: string;
      admin_user_id: string;
      csrf_token_hash: Buffer;
      created_at: Date;
      last_seen_at: Date;
      revoked_at: Date | null;
    }>(
      `SELECT id, admin_user_id, csrf_token_hash, created_at, last_seen_at, revoked_at
         FROM admin_sessions WHERE token_hash = $1 AND purpose = $2`,
      [tokenHash, purpose],
    );
    const row = rows[0];
    return row === undefined
      ? undefined
      : {
          id: row.id,
          adminUserId: row.admin_user_id,
          csrfTokenHash: row.csrf_token_hash,
          createdAt: row.created_at,
          lastSeenAt: row.last_seen_at,
          revokedAt: row.revoked_at,
        };
  }

  /**
   * Store the encrypted secret without enrolling.
   *
   * Two steps rather than one because a secret written at the moment it is
   * shown would enrol an account whose owner never managed to scan the code,
   * and the only way out of that is an administrator with database access.
   * `totp_enrolled_at` stays null until a code proves the app has it.
   */
  async stageTotpSecret(adminUserId: string, secretEnc: Buffer): Promise<void> {
    await this.pool.query(
      `UPDATE admin_users
          SET totp_secret_enc = $2, totp_enrolled_at = NULL, updated_at = now()
        WHERE id = $1`,
      [adminUserId, secretEnc],
    );
  }

  async completeTotpEnrolment(
    adminUserId: string,
    at: Date,
    counter: number,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE admin_users
          SET totp_enrolled_at = $2, totp_last_counter = $3, updated_at = now()
        WHERE id = $1`,
      [adminUserId, at, counter],
    );
  }

  /**
   * `GREATEST` rather than a plain assignment: two requests racing with codes
   * from adjacent steps must not let the lower one move the marker backwards
   * and re-open the replay window it exists to close.
   */
  async recordTotpCounter(adminUserId: string, counter: number): Promise<void> {
    await this.pool.query(
      `UPDATE admin_users
          SET totp_last_counter = GREATEST(COALESCE(totp_last_counter, $2), $2)
        WHERE id = $1`,
      [adminUserId, counter],
    );
  }

  async touchSession(sessionId: string, at: Date): Promise<void> {
    await this.pool.query(`UPDATE admin_sessions SET last_seen_at = $2 WHERE id = $1`, [
      sessionId,
      at,
    ]);
  }

  async revokeSession(sessionId: string, at: Date): Promise<void> {
    await this.pool.query(
      `UPDATE admin_sessions SET revoked_at = $2 WHERE id = $1 AND revoked_at IS NULL`,
      [sessionId, at],
    );
  }

  async revokeAllSessions(adminUserId: string, at: Date): Promise<void> {
    await this.pool.query(
      `UPDATE admin_sessions SET revoked_at = $2 WHERE admin_user_id = $1 AND revoked_at IS NULL`,
      [adminUserId, at],
    );
  }

  /**
   * Every operator account, with its grants.
   *
   * `admin_users` is not tenant-scoped — a super admin belongs to no customer —
   * so this is not an RLS query and the *authorisation* is entirely the
   * application's: `StaffService.listAccounts` narrows the result to what the
   * caller may see before it is returned.
   */
  async listAccounts(): Promise<readonly StaffAccountSummary[]> {
    const { rows } = await this.pool.query<{
      id: string;
      email: string;
      display_name: string;
      disabled_at: Date | null;
      last_login_at: Date | null;
      totp_enrolled_at: Date | null;
    }>(
      `SELECT id, email, display_name, disabled_at, last_login_at, totp_enrolled_at
         FROM admin_users ORDER BY display_name`,
    );

    const grants = await this.pool.query<{
      admin_user_id: string;
      role: StaffRole;
      customer_id: string | null;
      department_id: string | null;
    }>("SELECT admin_user_id, role, customer_id, department_id FROM admin_user_roles");

    return rows.map((row) => ({
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      disabledAt: row.disabled_at,
      lastLoginAt: row.last_login_at,
      // A boolean, not the timestamp: when somebody enrolled their
      // authenticator is nobody's business but theirs.
      totpEnrolled: row.totp_enrolled_at !== null,
      grants: grants.rows
        .filter((grant) => grant.admin_user_id === row.id)
        .map((grant) => ({
          role: grant.role,
          customerId: grant.customer_id,
          departmentId: grant.department_id,
        })),
    }));
  }

  /**
   * Create an account with **no password**.
   *
   * `password_hash` stays null until an invitation is redeemed, which is what
   * makes an un-redeemed invitation harmless: there is no credential to guess,
   * and `login` refuses the account because `verifyPassword(null, …)` burns a
   * decoy and returns false.
   */
  async createAccount(input: { email: string; displayName: string }): Promise<string> {
    const { rows } = await this.pool.query<{ id: string }>(
      `INSERT INTO admin_users (email, display_name) VALUES ($1, $2) RETURNING id`,
      [input.email, input.displayName],
    );
    const id = rows[0]?.id;
    if (id === undefined) throw new Error("admin_users insert returned no row");
    return id;
  }

  async issueCredentialToken(input: {
    adminUserId: string;
    kind: "invite" | "reset";
    tokenHash: Buffer;
    issuedBy: string | null;
  }): Promise<void> {
    // Any outstanding token of the same kind is revoked first. Two live
    // invitations for one account means the older one — possibly forwarded,
    // possibly in a mailbox somebody else can read — still works.
    await this.pool.query(
      `UPDATE admin_credential_tokens SET revoked_at = now()
        WHERE admin_user_id = $1 AND kind = $2 AND accepted_at IS NULL AND revoked_at IS NULL`,
      [input.adminUserId, input.kind],
    );
    await this.pool.query(
      `INSERT INTO admin_credential_tokens (admin_user_id, kind, token_hash, issued_by)
       VALUES ($1, $2, $3, $4)`,
      [input.adminUserId, input.kind, input.tokenHash, input.issuedBy],
    );
  }

  /**
   * Replace an account's grants wholesale, in one transaction.
   *
   * Delete-then-insert rather than a diff: a diff has an ordering in which the
   * account briefly holds neither the old grant nor the new one, and a request
   * arriving in that window would be refused for reasons nobody could
   * reconstruct afterwards.
   */
  async replaceGrants(
    adminUserId: string,
    grants: readonly {
      role: StaffRole;
      customerId: string | null;
      departmentId: string | null;
    }[],
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM admin_user_roles WHERE admin_user_id = $1", [
        adminUserId,
      ]);
      for (const grant of grants) {
        await client.query(
          `INSERT INTO admin_user_roles (admin_user_id, role, customer_id, department_id)
           VALUES ($1, $2, $3, $4)`,
          [adminUserId, grant.role, grant.customerId, grant.departmentId],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Disable or re-enable an account, revoking its sessions in the same
   * statement when disabling.
   *
   * One statement, because "disabled but still signed in somewhere" is the
   * state a two-step version leaves behind if the second step fails.
   */
  async setDisabled(adminUserId: string, at: Date | null): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `WITH updated AS (
         UPDATE admin_users SET disabled_at = $2, updated_at = now()
          WHERE id = $1 RETURNING id
       )
       UPDATE admin_sessions SET revoked_at = COALESCE($2, revoked_at)
        WHERE admin_user_id = (SELECT id FROM updated) AND revoked_at IS NULL`,
      [adminUserId, at],
    );
    // The session update may legitimately touch zero rows (nobody signed in),
    // so success is decided by whether the account exists.
    const { rows } = await this.pool.query("SELECT 1 FROM admin_users WHERE id = $1", [
      adminUserId,
    ]);
    void rowCount;
    return rows.length > 0;
  }

  // --- the platform's own sender (P40-01) ----------------------------------

  async readPlatformSmtp(): Promise<PlatformSmtpRow> {
    const { rows } = await this.pool.query<{
      host: string | null;
      port: number | null;
      username: string | null;
      password_enc: Buffer | null;
      secure: boolean;
      from_address: string | null;
      from_name: string | null;
      updated_at: Date;
    }>(
      `SELECT host, port, username, password_enc, secure, from_address, from_name, updated_at
         FROM platform_smtp WHERE id = true`,
    );

    const row = rows[0];
    // The migration inserts the row, so this is the "somebody restored an old
    // dump" case rather than an expected one — answered with empty settings,
    // which `canSend` reads as "not configured" and nothing then tries to send.
    if (row === undefined) {
      return {
        host: null,
        port: null,
        username: null,
        passwordEnc: null,
        secure: false,
        fromAddress: null,
        fromName: null,
        updatedAt: new Date(0),
      };
    }

    return {
      host: row.host,
      port: row.port,
      username: row.username,
      passwordEnc: row.password_enc,
      secure: row.secure,
      fromAddress: row.from_address,
      fromName: row.from_name,
      updatedAt: row.updated_at,
    };
  }

  async writePlatformSmtp(input: PlatformSmtpWrite): Promise<void> {
    // `password_enc` is written only when the caller said something about it.
    // `COALESCE` would be wrong here: it cannot express "clear it", and an
    // operator removing a credential has to be able to.
    const setPassword = input.passwordEnc !== undefined;

    await this.pool.query(
      `INSERT INTO platform_smtp
         (id, host, port, username, password_enc, secure, from_address, from_name,
          updated_at, updated_by)
       VALUES (true, $1, $2, $3, $4, $5, $6, $7, now(), $8)
       ON CONFLICT (id) DO UPDATE SET
         host         = EXCLUDED.host,
         port         = EXCLUDED.port,
         username     = EXCLUDED.username,
         password_enc = CASE WHEN $9 THEN EXCLUDED.password_enc ELSE platform_smtp.password_enc END,
         secure       = EXCLUDED.secure,
         from_address = EXCLUDED.from_address,
         from_name    = EXCLUDED.from_name,
         updated_at   = now(),
         updated_by   = EXCLUDED.updated_by`,
      [
        input.host,
        input.port,
        input.username,
        setPassword ? (input.passwordEnc ?? null) : null,
        input.secure,
        input.fromAddress,
        input.fromName,
        input.updatedBy,
        setPassword,
      ],
    );
  }

  async findCredentialToken(tokenHash: Buffer): Promise<CredentialTokenRow | undefined> {
    const { rows } = await this.pool.query<{
      id: string;
      admin_user_id: string;
      kind: "invite" | "reset";
      created_at: Date;
      accepted_at: Date | null;
      revoked_at: Date | null;
    }>(
      `SELECT id, admin_user_id, kind, created_at, accepted_at, revoked_at
         FROM admin_credential_tokens WHERE token_hash = $1`,
      [tokenHash],
    );
    const row = rows[0];
    return row === undefined
      ? undefined
      : {
          id: row.id,
          adminUserId: row.admin_user_id,
          kind: row.kind,
          createdAt: row.created_at,
          acceptedAt: row.accepted_at,
          revokedAt: row.revoked_at,
        };
  }

  async acceptCredentialToken(id: string, at: Date): Promise<void> {
    await this.pool.query(
      `UPDATE admin_credential_tokens SET accepted_at = $2 WHERE id = $1 AND accepted_at IS NULL`,
      [id, at],
    );
  }

  async setPassword(adminUserId: string, passwordHash: string): Promise<void> {
    await this.pool.query(
      `UPDATE admin_users SET password_hash = $2, updated_at = now() WHERE id = $1`,
      [adminUserId, passwordHash],
    );
  }

  // --- second-factor policy (P22-02) ---------------------------------------

  async secondFactorPolicies(): Promise<{
    platform: SecondFactorPolicy;
    perCustomer: ReadonlyMap<string, SecondFactorPolicy>;
  }> {
    const { rows } = await this.pool.query<{
      customer_id: string | null;
      policy: SecondFactorPolicy;
    }>("SELECT customer_id, policy FROM admin_2fa_policy");

    const perCustomer = new Map<string, SecondFactorPolicy>();
    let platform: SecondFactorPolicy | undefined;

    for (const row of rows) {
      if (row.customer_id === null) platform = row.policy;
      else perCustomer.set(row.customer_id, row.policy);
    }

    // Migration 0027 seeds the platform row and a partial unique index keeps
    // there being exactly one, so an absent one means somebody deleted it.
    // Falling back to the strict default rather than throwing: a missing policy
    // row must not be a way to take the console down, and it must certainly not
    // be a way to make sign-in easier.
    return { platform: platform ?? DEFAULT_PLATFORM_SECOND_FACTOR, perCustomer };
  }

  async setSecondFactorPolicy(input: {
    customerId: string | null;
    policy: SecondFactorPolicy;
    updatedBy: string;
    at: Date;
  }): Promise<void> {
    // Two statements rather than one `ON CONFLICT`, because the platform row's
    // key is NULL and the two unique indexes that enforce "one per customer,
    // one for the platform" are partial — neither is an inferable conflict
    // target for the other's rows.
    if (input.customerId === null) {
      await this.pool.query(
        `UPDATE admin_2fa_policy
            SET policy = $1, updated_by = $2, updated_at = $3
          WHERE customer_id IS NULL`,
        [input.policy, input.updatedBy, input.at],
      );
      return;
    }

    await this.pool.query(
      `INSERT INTO admin_2fa_policy (customer_id, policy, updated_by, updated_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (customer_id) WHERE customer_id IS NOT NULL
       DO UPDATE SET policy = excluded.policy,
                     updated_by = excluded.updated_by,
                     updated_at = excluded.updated_at`,
      [input.customerId, input.policy, input.updatedBy, input.at],
    );
  }

  async clearSecondFactor(adminUserId: string): Promise<void> {
    await this.pool.query(
      `UPDATE admin_users
          SET totp_secret_enc = NULL,
              totp_enrolled_at = NULL,
              totp_last_counter = NULL,
              updated_at = now()
        WHERE id = $1`,
      [adminUserId],
    );
  }
}
