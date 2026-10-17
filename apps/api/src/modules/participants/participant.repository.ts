/**
 * Participant records, as an administrator sees them (P21-04). Infrastructure — ADR-0006.
 *
 * ## Two connections, and why
 *
 * Most of this runs on the request's tenant connection, so RLS scopes it: a
 * customer admin listing participants sees their own customer's memberships and
 * nothing else, enforced by PostgreSQL rather than by the `WHERE` clause that
 * is also there (ADR-0002).
 *
 * `users`, `user_identities` and `learner_credentials` are **not** tenant-scoped
 * — a person is not a tenant's property, and the credential is resolved before
 * any tenant context exists (migration 0025, 0030). Reaching them therefore
 * needs the pool. The safety that replaces RLS on those three is that every one
 * of the queries below joins through `user_customers`, which *is* scoped, so a
 * person with no membership in the caller's customer is unreachable however the
 * id was obtained.
 *
 * That join is the tenant boundary for this module. It is not decoration, and
 * `participants.integration.test.ts` attempts to cross it directly.
 */

import { sql } from "drizzle-orm";
import type { Pool } from "pg";
import type { Db } from "../../db/tenant-db.js";

export interface ParticipantSummary {
  readonly userId: string;
  readonly email: string | null;
  readonly firstName: string | null;
  readonly lastName: string | null;
  /** `undefined` when this person has no local credential — a federated one. */
  readonly credential?:
    | {
        readonly mustChange: boolean;
        readonly disabled: boolean;
        readonly lockedUntil: string | null;
      }
    | undefined;
  readonly enrolmentCount: number;
  readonly completedCount: number;
  readonly createdAt: string;
}

export class ParticipantRepository {
  constructor(
    private readonly db: Db,
    private readonly pool: Pool,
  ) {}

  /**
   * Everybody who learns with this customer, with enough state to act on.
   *
   * The counts are subqueries rather than a `GROUP BY` over a three-way join:
   * a participant with no enrolments must still appear — they are exactly the
   * person an administrator has just created and is looking for — and an inner
   * join would drop them silently.
   */
  async list(search: string | undefined): Promise<readonly ParticipantSummary[]> {
    const filter =
      search === undefined || search === ""
        ? sql``
        : sql`AND (lower(u.email) LIKE ${`%${search.toLowerCase()}%`}
                OR lower(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, ''))
                     LIKE ${`%${search.toLowerCase()}%`})`;

    const result = await this.db.execute<{
      user_id: string;
      email: string | null;
      first_name: string | null;
      last_name: string | null;
      must_change: boolean | null;
      disabled_at: Date | null;
      locked_until: Date | null;
      enrolment_count: number;
      completed_count: number;
      created_at: Date;
    }>(sql`
      SELECT u.id AS user_id, u.email, u.first_name, u.last_name,
             c.must_change, m.disabled_at, c.locked_until,
             (SELECT count(*) FROM enrolments e WHERE e.user_id = u.id)::int
               AS enrolment_count,
             (SELECT count(*) FROM enrolments e
               WHERE e.user_id = u.id AND e.completed_at IS NOT NULL)::int
               AS completed_count,
             u.created_at
        FROM user_customers m
        JOIN users u ON u.id = m.user_id
        -- One credential per person, in the order every other reader uses.
        -- A plain join listed a person merged before migration 0057 once per
        -- local credential (P247-01).
        LEFT JOIN LATERAL (
          SELECT c.must_change, c.locked_until
            FROM user_identities i
            JOIN learner_credentials c ON c.user_identity_id = i.id
           WHERE i.user_id = u.id AND i.provider = 'local'
           ORDER BY c.last_used_at DESC NULLS LAST, i.created_at DESC, i.id
           LIMIT 1
        ) c ON true
       WHERE true ${filter}
       ORDER BY u.last_name NULLS LAST, u.first_name NULLS LAST, u.created_at
       LIMIT 500`);

    return result.rows.map((row) => ({
      userId: row.user_id,
      email: row.email,
      firstName: row.first_name,
      lastName: row.last_name,
      ...(row.must_change === null
        ? {}
        : {
            credential: {
              mustChange: row.must_change,
              disabled: row.disabled_at !== null,
              lockedUntil: row.locked_until === null ? null : iso(row.locked_until),
            },
          }),
      enrolmentCount: row.enrolment_count,
      completedCount: row.completed_count,
      createdAt: iso(row.created_at),
    }));
  }

  /**
   * Is this person a member of the customer the request is scoped to?
   *
   * Every mutation below calls this first. `user_customers` is RLS-scoped, so
   * the answer is the database's rather than this code's: a participant id from
   * another customer returns `false` even though the row plainly exists, and no
   * `WHERE customer_id = …` had to be written correctly for that to hold.
   */
  async isMember(userId: string): Promise<boolean> {
    const result = await this.db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM user_customers WHERE user_id = ${userId}`,
    );
    return (result.rows[0]?.n ?? 0) > 0;
  }

  /**
   * Does this person sign in with a local password at all?
   *
   * A yes/no and not an id since P247-01: nothing administrative writes to the
   * credential any more. The reset sends a link and the block is on the
   * membership.
   */
  async hasLocalCredential(userId: string): Promise<boolean> {
    const { rows } = await this.pool.query<{ n: number }>(
      `SELECT count(*)::int AS n
         FROM user_identities i
         JOIN learner_credentials c ON c.user_identity_id = i.id
        WHERE i.user_id = $1 AND i.provider = 'local'`,
      [userId],
    );
    return (rows[0]?.n ?? 0) > 0;
  }

  /** Does any person already hold a local credential for this address? */
  async localCredentialExists(email: string, realm: string): Promise<boolean> {
    const { rows } = await this.pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM user_identities
        WHERE provider = 'local' AND realm = $1 AND lower(subject) = lower($2)`,
      [realm, email],
    );
    return rows[0]?.n !== "0";
  }

  /**
   * Create the person, the credential and the password, atomically.
   *
   * One transaction on purpose. A person without a credential is somebody
   * nobody can sign in as and no screen shows; a credential without a password
   * row is a sign-in that fails on a join. Both are states an administrator
   * would have to be talked out of by hand.
   *
   * The membership and the role are written by the caller inside the *tenant*
   * transaction, because `user_customers` is RLS-scoped and this connection has
   * no tenant context. That split is the one wrinkle of the two-plane schema,
   * and `createMembership` below is the other half.
   */
  async createPerson(input: {
    email: string;
    firstName: string;
    lastName: string;
    realm: string;
    passwordHash: string;
  }): Promise<{ userId: string }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const {
        rows: [user],
      } = await client.query<{ id: string }>(
        `INSERT INTO users (email, first_name, last_name) VALUES ($1,$2,$3) RETURNING id`,
        [input.email, input.firstName, input.lastName],
      );
      const userId = user!.id;

      const {
        rows: [identity],
      } = await client.query<{ id: string }>(
        `INSERT INTO user_identities (user_id, provider, realm, subject)
         VALUES ($1,'local',$2,$3) RETURNING id`,
        [userId, input.realm, input.email],
      );

      await client.query(
        // `must_change` true, and not configurable. A password an administrator
        // chose or read off a screen is a password an administrator knows.
        `INSERT INTO learner_credentials (user_identity_id, password_hash, must_change)
         VALUES ($1,$2,true)`,
        [identity!.id, input.passwordHash],
      );

      await client.query("COMMIT");
      return { userId };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * The membership and the grant, inside the caller's tenant transaction.
   *
   * `NOT EXISTS` rather than `ON CONFLICT` on `user_roles`: its unique key
   * includes `department_id`, which is NULL here, and in PostgreSQL two NULLs
   * are distinct — so the constraint never fires and `DO NOTHING` would insert
   * a duplicate every time.
   */
  async createMembership(userId: string, customerId: string): Promise<void> {
    await this.db.execute(sql`
      INSERT INTO user_customers (user_id, customer_id) VALUES (${userId}, ${customerId})
      ON CONFLICT (user_id, customer_id) DO NOTHING`);
    await this.db.execute(sql`
      INSERT INTO user_roles (user_id, role, customer_id)
      SELECT ${userId}, 'learner', ${customerId}
       WHERE NOT EXISTS (
         SELECT 1 FROM user_roles
          WHERE user_id = ${userId} AND role = 'learner'
            AND customer_id = ${customerId} AND department_id IS NULL)`);
  }

  /**
   * Block, or unblock, this person **at the request's customer** (P247-01).
   *
   * On the tenant connection, so RLS confines the write to the caller's own
   * membership row: a block at A cannot reach the person's membership of B
   * however the id was obtained. It used to be `learner_credentials.disabled_at`
   * — one column for every customer — so A could lock a physician out of B.
   *
   * Returns whether a membership was written; `false` means the person is not
   * a member here, which the service has already ruled out.
   */
  async setDisabled(
    userId: string,
    disabled: boolean,
    byStaffId: string | null,
  ): Promise<boolean> {
    const result = await this.db.execute(sql`
      UPDATE user_customers
         SET disabled_at = CASE WHEN ${disabled} THEN now() ELSE NULL END,
             disabled_by = CASE WHEN ${disabled} THEN ${byStaffId}::uuid ELSE NULL END
       WHERE user_id = ${userId}`);
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * End this person's sessions **at this customer's projects** (P247-01).
   *
   * A session is minted for one project (`learner_sessions.project_id`), and
   * `projects` is RLS-scoped, so the sub-select sees only the caller's
   * customer's projects. Ending every session the person holds anywhere would
   * sign them out at a customer that blocked nothing.
   */
  async revokeSessionsAtThisCustomer(userId: string): Promise<void> {
    await this.db.execute(sql`
      UPDATE learner_sessions SET revoked_at = now()
       WHERE user_id = ${userId} AND revoked_at IS NULL
         AND project_id IN (SELECT id FROM projects)`);
  }

  // -------------------------------------------------------------------------
  // Credential merge (P21-05)
  // -------------------------------------------------------------------------
  //
  // Both go through SECURITY DEFINER functions owned by `ds_merge`, and
  // migration 0033 explains at length why they have to. In short: every table a
  // merge reads and every table it moves is tenant-scoped under FORCE ROW LEVEL
  // SECURITY, and the whole point of the operation is a physician who exists in
  // two places — frequently two customers. Written as ordinary `ds_app` SQL it
  // read no EFN, found no enrolments, matched zero rows and reported success.
  //
  // The *policy* is deliberately not in SQL. These report and move; the verdict
  // is `planCredentialMerge` in `@ds/domain`.

  /**
   * What `planCredentialMerge` needs to know about one person.
   *
   * The EFN comes back as a **digest**, never as digits: the domain only asks
   * whether two numbers differ, and carrying the number out of the database
   * would put it in this process's heap and in any exception that quotes a
   * parameter, for no gain (ADR-0004).
   */
  async mergeSideOf(userId: string): Promise<
    | {
        readonly personId: string;
        readonly email: string | null;
        readonly efnFingerprint: string | null;
        readonly enrolledCourseSlugs: readonly string[];
      }
    | undefined
  > {
    const { rows } = await this.pool.query<{
      person_id: string;
      email: string | null;
      efn_digest: string | null;
      course_slugs: string[] | null;
    }>(`SELECT * FROM participant_merge_side($1)`, [userId]);

    const row = rows[0];
    if (row === undefined) return undefined;
    return {
      personId: row.person_id,
      email: row.email,
      efnFingerprint: row.efn_digest,
      enrolledCourseSlugs: row.course_slugs ?? [],
    };
  }

  /**
   * Move everything belonging to `sourceId` onto `targetId`, and record it.
   *
   * One call, one transaction — including the `admin_audit_log` row.
   * `AuditService` writes on its own connection deliberately, so an entry
   * saying "this actor asserted this identity" survives the failure of what
   * followed. The opposite is right here: an audit row for a merge that rolled
   * back would send somebody looking for records that never moved.
   */
  async merge(input: {
    sourceId: string;
    targetId: string;
    actorId: string | null;
    actorEmail: string | null;
    detail: Record<string, unknown>;
  }): Promise<void> {
    await this.pool.query(`SELECT merge_participants($1, $2, $3, $4, $5::jsonb)`, [
      input.sourceId,
      input.targetId,
      input.actorId,
      input.actorEmail,
      JSON.stringify(input.detail),
    ]);
  }
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
