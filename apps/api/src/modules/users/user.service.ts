/**
 * User identity use case (P1-02). Application layer — ADR-0006.
 */

import type { VerifiedIdentity } from "../../auth/token-verifier.js";
import type { RoleGrant } from "@ds/domain";
import type { UserRepositoryPort, UserRow } from "./user.repository.js";

export class UserService {
  constructor(private readonly repository: UserRepositoryPort) {}

  /**
   * Resolve the local user for a validated identity, provisioning on first
   * sight and refreshing profile fields on every later request (ADR-0003: no
   * separate profile maintenance — the token is the source, refreshed live).
   *
   * `ON CONFLICT` in the repository makes this safe under concurrent first
   * requests for the same `sub`: exactly one user is created, never two.
   */
  async syncFromToken(realm: string, identity: VerifiedIdentity): Promise<UserRow> {
    return this.repository.provisionOrUpdate({
      realm,
      sub: identity.subject,
      ...(identity.email === undefined ? {} : { email: identity.email }),
      ...(identity.firstName === undefined ? {} : { firstName: identity.firstName }),
      ...(identity.lastName === undefined ? {} : { lastName: identity.lastName }),
    });
  }

  async rolesFor(userId: string): Promise<readonly RoleGrant[]> {
    const rows = await this.repository.rolesFor(userId);
    return rows.map((row) => ({
      role: row.role,
      customerId: row.customerId,
      departmentId: row.departmentId,
    }));
  }
}
