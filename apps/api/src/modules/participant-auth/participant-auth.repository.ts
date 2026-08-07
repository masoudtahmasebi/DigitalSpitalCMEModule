/**
 * Rows the participant sign-in reads and writes (P25-02). Infrastructure — ADR-0006.
 *
 * ## Two kinds of query, and why they are not the same
 *
 * Sign-in *establishes* the tenant, so at the moment it runs there is no
 * `app.customer_id` yet — which is why `learner_credentials` and
 * `user_identities` carry no RLS policy, exactly as
 * `learner-session.repository.ts` explains for `learner_sessions`. Those reads
 * and writes go on the bare pool.
 *
 * But `projects` and `user_customers` *are* RLS-scoped, and the first version
 * of this file queried both on the pool anyway. Both returned zero rows, so
 * every correct password was refused with the same message as a wrong one —
 * and because that message is deliberately indistinguishable, there was nothing
 * to diagnose from. Each is fixed in the way that table intends: the project
 * through `resolve_project_binding`, the membership inside `runInTenant`. See
 * the comments on each.
 *
 * ## What is deliberately not here
 *
 * Creating and revoking the session row. That is `LearnerSessionRepository`,
 * which the guard already reads through — and this file briefly carried a
 * second copy of the insert. Two implementations of "mint a session" is exactly
 * the shape of duplication that ends with one of them hashing the token and the
 * other storing it, so the write lives once, next to the read that has to
 * agree with it.
 */

import { sql } from "drizzle-orm";
import type { Pool } from "pg";
import { runInTenant } from "../../db/tenant-db.js";

export interface LocalParticipant {
  readonly userId: string;
  readonly identityId: string;
  readonly passwordHash: string;
  readonly mustChange: boolean;
  readonly failedAttempts: number;
  readonly lockedUntil: Date | null;
}

export interface SignInProject {
  readonly projectId: string;
  readonly customerId: string;
  readonly identityProvider: string;
}

export class ParticipantAuthRepository {
  constructor(private readonly pool: Pool) {}

  /**
   * The project named by `X-DS-Project`, resolved the way the guard resolves
   * it.
   *
   * Through `resolve_project_binding`, not a `SELECT` on `projects`. That is
   * not a stylistic preference: `projects` has `FORCE ROW LEVEL SECURITY`, and
   * this query runs before any tenant context exists — a direct read returns
   * **zero rows**, and the sign-in then refuses a correct password with the
   * same message as a wrong one, which is close to undiagnosable. The first
   * version of this file did exactly that, and only an integration test over
   * real HTTP found it.
   *
   * The function is `SECURITY DEFINER`, owned by `ds_binding_resolver`, and
   * exists precisely for this chicken-and-egg (migration 0002 / 0019).
   */
  async findProject(slug: string): Promise<SignInProject | undefined> {
    const { rows } = await this.pool.query<{
      project_id: string;
      customer_id: string;
      identity_provider: string;
    }>("SELECT project_id, customer_id, identity_provider FROM resolve_project_binding($1)", [
      slug,
    ]);
    const row = rows[0];
    return row === undefined
      ? undefined
      : {
          projectId: row.project_id,
          customerId: row.customer_id,
          identityProvider: row.identity_provider,
        };
  }

  /**
   * The participant, by e-mail, **within one customer**.
   *
   * The `user_customers` join is the part that matters: a person may learn with
   * several customers, and signing in through MEDICE's project must find their
   * MEDICE membership rather than any row that happens to share the address.
   * Without it, one customer's sign-in page would authenticate somebody who has
   * never had anything to do with them.
   */
  async findParticipant(
    email: string,
    customerId: string,
  ): Promise<LocalParticipant | undefined> {
    // Inside a tenant transaction, because `user_customers` is RLS-scoped
    // (migration 0025) and the join below is the whole point of the query.
    // On the bare pool it matches nothing and every correct password is
    // refused — the second half of the bug described on `findProject`.
    //
    // The customer id is not the caller's to choose: it comes from
    // `resolve_project_binding` for the slug in `X-DS-Project`, so entering
    // that tenant here is entering the one the request already named. Using
    // RLS rather than only the `WHERE` clause means the isolation is the
    // database's, as everywhere else (ADR-0002).
    const rows = await runInTenant(
      this.pool,
      { customerId, role: "system" },
      async (db) =>
        (
          await db.execute<{
            user_id: string;
            identity_id: string;
            password_hash: string;
            must_change: boolean;
            failed_attempts: number;
            locked_until: Date | null;
          }>(sql`
            SELECT u.id AS user_id, i.id AS identity_id,
                   c.password_hash, c.must_change, c.failed_attempts, c.locked_until
              FROM users u
              JOIN user_identities i     ON i.user_id = u.id AND i.provider = 'local'
              JOIN learner_credentials c ON c.user_identity_id = i.id
              JOIN user_customers m      ON m.user_id = u.id AND m.customer_id = ${customerId}
             WHERE lower(u.email) = ${email}
             LIMIT 1`)
        ).rows,
    );

    const row = rows[0];
    return row === undefined
      ? undefined
      : {
          userId: row.user_id,
          identityId: row.identity_id,
          passwordHash: row.password_hash,
          mustChange: row.must_change,
          failedAttempts: row.failed_attempts,
          lockedUntil: row.locked_until,
        };
  }

  /**
   * Record a failure and lock the account when there have been too many.
   *
   * In the database rather than in Redis on purpose: a lockout a container
   * restart clears is not a lockout, and the API is restarted by every deploy.
   */
  async recordFailure(identityId: string, threshold: number, lockFor: string): Promise<void> {
    await this.pool.query(
      `UPDATE learner_credentials
          SET failed_attempts = failed_attempts + 1,
              locked_until = CASE
                WHEN failed_attempts + 1 >= $2 THEN now() + $3::interval
                ELSE locked_until
              END,
              updated_at = now()
        WHERE user_identity_id = $1`,
      [identityId, threshold, lockFor],
    );
  }

  async recordSuccess(identityId: string): Promise<void> {
    await this.pool.query(
      `UPDATE learner_credentials
          SET failed_attempts = 0, locked_until = NULL, updated_at = now()
        WHERE user_identity_id = $1`,
      [identityId],
    );
  }

}
