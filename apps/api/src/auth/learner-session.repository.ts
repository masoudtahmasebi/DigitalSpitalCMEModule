/**
 * Participant sessions (P25-02). Infrastructure — ADR-0006.
 *
 * Reads and writes on the **pool**, not on a request-scoped tenant connection,
 * and that is not an oversight. The auth guard runs *before* the tenant
 * interceptor: it is the thing that decides which customer the request belongs
 * to, so at the moment it needs this lookup there is no `app.customer_id` to
 * set and no RLS context to run inside. `learner_sessions` therefore carries no
 * RLS policy, exactly as `user_identities` does not (migration 0025), and the
 * tenant boundary is enforced by `project_id` on the row instead — checked by
 * `LocalIdentityProvider`, tested there.
 */

import { createHash } from "node:crypto";
import type { Pool } from "pg";
import type { LearnerSession, LearnerSessionLookup } from "./local-identity-provider.js";

interface Row {
  user_id: string;
  project_id: string;
  subject: string;
  realm: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  expires_at: Date;
  revoked_at: Date | null;
}

export class LearnerSessionRepository implements LearnerSessionLookup {
  constructor(private readonly pool: Pick<Pool, "query">) {}

  async findByTokenHash(hash: Buffer): Promise<LearnerSession | undefined> {
    // The join is what makes one query enough: the session names the person,
    // the person's local credential names the subject and realm the guard then
    // provisions against. Two round trips here would be two round trips on
    // every authenticated request.
    const { rows } = await this.pool.query<Row>(
      `SELECT s.user_id, s.project_id, s.expires_at, s.revoked_at,
              i.subject, i.realm,
              u.email, u.first_name, u.last_name
         FROM learner_sessions s
         JOIN users u          ON u.id = s.user_id
         JOIN user_identities i ON i.user_id = u.id AND i.provider = 'local'
        WHERE s.token_hash = $1
        LIMIT 1`,
      [hash],
    );

    const row = rows[0];
    if (row === undefined) return undefined;

    return {
      userId: row.user_id,
      projectId: row.project_id,
      subject: row.subject,
      realm: row.realm,
      ...(row.email === null ? {} : { email: row.email }),
      ...(row.first_name === null ? {} : { firstName: row.first_name }),
      ...(row.last_name === null ? {} : { lastName: row.last_name }),
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
    };
  }

  async touch(hash: Buffer, at: Date): Promise<void> {
    // Only forward, and only by more than a minute. Without the guard this is a
    // write on every single authenticated request — a row update per page view,
    // for a column nobody reads to the second.
    //
    // `$2::timestamptz` and not a bare `$2`, and the cast is load-bearing.
    // PostgreSQL types a bare parameter from its context, and the context here
    // is `$2 - interval '1 minute'`: `unknown - interval` resolves to
    // `interval`, so the comparison became `timestamptz < interval` and the
    // statement failed with
    //
    //   operator does not exist: timestamp with time zone < interval
    //
    // on **every authenticated request** from the day P25-02 shipped. Nothing
    // noticed, because `LocalIdentityProvider` deliberately swallows a failure
    // here — a `last_seen_at` write must never turn a valid session into a 401
    // — so the column simply never advanced. It surfaced only as a wall of
    // ERROR lines in the Postgres service log of a CI job that failed for an
    // unrelated reason.
    //
    // The lesson is the general one about best-effort writes: swallowing the
    // error is right, and it means the *only* thing that will ever tell you the
    // statement is wrong is a test that asserts the effect. There is one now.
    await this.pool.query(
      `UPDATE learner_sessions
          SET last_seen_at = $2::timestamptz
        WHERE token_hash = $1
          AND last_seen_at < $2::timestamptz - interval '1 minute'`,
      [hash, at],
    );
  }

  /** Issue a session. Returns the token, which is the only time it exists. */
  async create(input: {
    userId: string;
    projectId: string;
    token: string;
    expiresAt: Date;
    ipHash: Buffer | null;
    userAgent: string | null;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO learner_sessions
         (user_id, project_id, token_hash, expires_at, ip_hash, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        input.userId,
        input.projectId,
        createHash("sha256").update(input.token, "utf8").digest(),
        input.expiresAt,
        input.ipHash,
        input.userAgent,
      ],
    );
  }

  /** Revoke, idempotently. Signing out twice is not an error. */
  async revoke(token: string): Promise<void> {
    await this.pool.query(
      `UPDATE learner_sessions SET revoked_at = now()
        WHERE token_hash = $1 AND revoked_at IS NULL`,
      [createHash("sha256").update(token, "utf8").digest()],
    );
  }
}
