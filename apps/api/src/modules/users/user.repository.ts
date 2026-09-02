/**
 * User and role data access (P1-02, P1-04, P21-01). Infrastructure layer — ADR-0006.
 *
 * Runs OUTSIDE the tenant transaction, on the raw pool: user identity is not
 * customer-scoped (one physician may hold enrolments across customers, ADR-0002
 * exception), and role resolution is what the tenant context is built FROM, so
 * it cannot itself depend on that context already existing.
 *
 * ## Why provisioning goes through a database function
 *
 * Until P21-01 a person *was* their Keycloak credential — `users` was keyed
 * `(keycloak_realm, keycloak_sub)` — and provisioning was one
 * `INSERT … ON CONFLICT DO UPDATE`. That is what made it race-free on the hot
 * path of every authenticated request: the database resolved concurrent first
 * sights of the same subject, not this code.
 *
 * Splitting the credential into `user_identities` costs that property. "Insert
 * a person, then insert their credential" has a window in which two requests
 * both create a person and one loses the credential insert, leaving a person
 * row nobody can ever sign in as. Recovering it here would mean a dedicated
 * client, a SAVEPOINT and a retry loop on every request; `provision_learner`
 * (migration 0025) does it in one round trip, with the PL/pgSQL sub-block
 * acting as the savepoint.
 */

import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { schema, userIdentities, users, userRoles } from "../../db/schema.js";
import { runInTenant } from "../../db/tenant-db.js";

export interface UserRow {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
}

export interface RoleGrant {
  role: "super_admin" | "customer_admin" | "department_admin" | "learner";
  customerId: string | null;
  departmentId: string | null;
}

/**
 * How a person proves who they are. `keycloak` for a federated learner,
 * `local` for a participant with a password on the standalone portal (P21-02).
 * The strings match `user_identities.provider`'s CHECK constraint.
 */
export type CredentialProvider = "keycloak" | "local";

export interface UserProfileInput {
  readonly provider: CredentialProvider;
  readonly realm: string;
  readonly sub: string;
  readonly email?: string;
  readonly firstName?: string;
  readonly lastName?: string;
}

export interface UserRepositoryPort {
  findByCredential(
    provider: CredentialProvider,
    realm: string,
    sub: string,
  ): Promise<UserRow | undefined>;
  provisionOrUpdate(input: UserProfileInput): Promise<UserRow>;
  rolesFor(userId: string): Promise<readonly RoleGrant[]>;
  grantLearnerMembership(userId: string, customerId: string): Promise<void>;
}

export class UserRepository implements UserRepositoryPort {
  private readonly db: ReturnType<typeof drizzle<typeof schema>>;

  constructor(private readonly pool: Pool) {
    this.db = drizzle(pool, { schema });
  }

  async findByCredential(
    provider: CredentialProvider,
    realm: string,
    sub: string,
  ): Promise<UserRow | undefined> {
    const [row] = await this.db
      .select({
        id: users.id,
        email: users.email,
        firstName: users.firstName,
        lastName: users.lastName,
      })
      .from(users)
      .innerJoin(userIdentities, eq(userIdentities.userId, users.id))
      .where(
        sql`${userIdentities.provider} = ${provider}
            AND ${userIdentities.realm} = ${realm}
            AND ${userIdentities.subject} = ${sub}`,
      )
      .limit(1);
    return row;
  }

  /**
   * Resolve the person behind a credential, creating both on first sight and
   * refreshing profile fields on every later request.
   *
   * **An absent claim never erases a stored value.** Whether a token carries
   * `given_name` depends on the client's scopes, so a token minted without the
   * profile scope would otherwise null out a name we already knew — and that
   * name is what prints on the Teilnahmebescheinigung. The function's
   * `coalesce` keeps the last value the provider actually told us. Clearing a
   * name is not something an absent claim can express; it needs an explicit
   * empty string, which passes through unchanged.
   *
   * **A credential the platform has not seen creates a new person, always.** It
   * is never matched onto an existing one by email: a provider that does not
   * verify email addresses could then assert its way into a physician's CME
   * history and EFN, and the platform cannot tell which providers verify.
   * Linking two credentials is P21-05 — deliberate, audited, and not something
   * this path can do by accident.
   */
  async provisionOrUpdate(input: UserProfileInput): Promise<UserRow> {
    const { rows } = await this.db.execute<{
      id: string;
      email: string | null;
      first_name: string | null;
      last_name: string | null;
    }>(
      sql`SELECT id, email, first_name, last_name FROM provision_learner(
            ${input.provider}, ${input.realm}, ${input.sub},
            ${input.email ?? null}, ${input.firstName ?? null}, ${input.lastName ?? null}
          )`,
    );

    const row = rows[0];
    if (row === undefined) {
      throw new Error("provisionOrUpdate: provision_learner returned no row");
    }
    return {
      id: row.id,
      email: row.email,
      firstName: row.first_name,
      lastName: row.last_name,
    };
  }

  async rolesFor(userId: string): Promise<readonly RoleGrant[]> {
    return this.db
      .select({
        role: userRoles.role,
        customerId: userRoles.customerId,
        departmentId: userRoles.departmentId,
      })
      .from(userRoles)
      .where(eq(userRoles.userId, userId));
  }

  /**
   * Make a federated learner a participant of the customer they arrived at
   * (P94-03).
   *
   * ## Why this had to exist at all
   *
   * P1-02 provisioned the *person* from the token and stopped there. Nothing
   * anywhere wrote the membership or the grant, so every physician arriving
   * from MEDICE's WordPress met a 403 naming a user id they had never seen — a
   * rule half built, which is CLAUDE.md §9.3 with the missing half in the
   * layer above rather than below.
   *
   * ## Why the two statements are the two they are
   *
   * They are `ParticipantRepository.createMembership`'s, deliberately the same
   * shape: a portal participant and a WordPress participant must end up as the
   * same kind of row, or the console lists one of them and not the other.
   *
   * `NOT EXISTS` rather than `ON CONFLICT` on `user_roles`, because its unique
   * key includes `department_id`, which is NULL here, and in PostgreSQL two
   * NULLs are distinct — the constraint never fires and `DO NOTHING` would
   * insert a duplicate on every request.
   *
   * ## Why `runInTenant`, on a repository whose header says it does not
   *
   * That header is about `users`, `user_identities` and `user_roles`, none of
   * which are tenant-scoped — role resolution is what the tenant context is
   * built *from*, so it cannot presuppose one. `user_customers` **is** scoped
   * and under FORCE ROW LEVEL SECURITY, and an insert on the bare pool matches
   * no policy and writes nothing while reporting success (§9.6). The context is
   * the customer the project binding named, which is known before any of this
   * and is not the learner's own claim.
   */
  async grantLearnerMembership(userId: string, customerId: string): Promise<void> {
    await runInTenant(this.pool, { customerId, role: "system" }, async (db) => {
      await db.execute(sql`
        INSERT INTO user_customers (user_id, customer_id) VALUES (${userId}, ${customerId})
        ON CONFLICT (user_id, customer_id) DO NOTHING`);
      await db.execute(sql`
        INSERT INTO user_roles (user_id, role, customer_id)
        SELECT ${userId}, 'learner', ${customerId}
         WHERE NOT EXISTS (
           SELECT 1 FROM user_roles
            WHERE user_id = ${userId} AND role = 'learner'
              AND customer_id = ${customerId} AND department_id IS NULL)`);
    });
  }
}
