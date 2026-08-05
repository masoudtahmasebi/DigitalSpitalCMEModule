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
import type { StaffRole } from "@ds/domain";

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

  findCredentialToken(tokenHash: Buffer): Promise<CredentialTokenRow | undefined>;
  acceptCredentialToken(id: string, at: Date): Promise<void>;
  setPassword(adminUserId: string, passwordHash: string): Promise<void>;
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
}
