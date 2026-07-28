/**
 * User and role data access (P1-02, P1-04). Infrastructure layer — ADR-0006.
 *
 * Runs OUTSIDE the tenant transaction, on the raw pool: user identity is not
 * customer-scoped (one physician may hold enrolments across customers, ADR-0002
 * exception), and role resolution is what the tenant context is built FROM, so
 * it cannot itself depend on that context already existing.
 */

import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import { schema, users, userRoles } from "../../db/schema.js";

export interface UserRow {
  id: string;
  keycloakRealm: string;
  keycloakSub: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
}

export interface RoleGrant {
  role: "super_admin" | "customer_admin" | "department_admin" | "learner";
  customerId: string | null;
  departmentId: string | null;
}

export interface UserProfileInput {
  readonly realm: string;
  readonly sub: string;
  readonly email?: string;
  readonly firstName?: string;
  readonly lastName?: string;
}

export interface UserRepositoryPort {
  findBySub(realm: string, sub: string): Promise<UserRow | undefined>;
  provisionOrUpdate(input: UserProfileInput): Promise<UserRow>;
  rolesFor(userId: string): Promise<readonly RoleGrant[]>;
}

export class UserRepository implements UserRepositoryPort {
  private readonly db: ReturnType<typeof drizzle<typeof schema>>;

  constructor(pool: Pool) {
    this.db = drizzle(pool, { schema });
  }

  async findBySub(realm: string, sub: string): Promise<UserRow | undefined> {
    const [row] = await this.db
      .select()
      .from(users)
      .where(and(eq(users.keycloakRealm, realm), eq(users.keycloakSub, sub)))
      .limit(1);
    return row;
  }

  /**
   * Insert on first sight, refresh profile fields on every later request.
   *
   * `ON CONFLICT` makes concurrent first-requests for the same `sub` resolve to
   * exactly one row (P1-02 acceptance criterion) without a separate SELECT-then-
   * INSERT race window.
   */
  async provisionOrUpdate(input: UserProfileInput): Promise<UserRow> {
    const [row] = await this.db
      .insert(users)
      .values({
        keycloakRealm: input.realm,
        keycloakSub: input.sub,
        email: input.email ?? null,
        firstName: input.firstName ?? null,
        lastName: input.lastName ?? null,
      })
      .onConflictDoUpdate({
        target: [users.keycloakRealm, users.keycloakSub],
        set: {
          email: input.email ?? null,
          firstName: input.firstName ?? null,
          lastName: input.lastName ?? null,
          updatedAt: new Date(),
        },
      })
      .returning();

    if (row === undefined) {
      throw new Error("provisionOrUpdate: insert returned no row");
    }
    return row;
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
}
