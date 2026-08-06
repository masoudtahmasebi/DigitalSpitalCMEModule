/**
 * User identity use case (P1-02). Application layer — ADR-0006.
 */

import type { VerifiedIdentity } from "../../auth/token-verifier.js";
import type { RoleGrant } from "@ds/domain";
import type {
  CredentialProvider,
  UserRepositoryPort,
  UserRow,
} from "./user.repository.js";

export class UserService {
  constructor(private readonly repository: UserRepositoryPort) {}

  /**
   * Resolve the local person for a validated identity, provisioning on first
   * sight and refreshing profile fields on every later request (ADR-0003: no
   * separate profile maintenance — the token is the source, refreshed live).
   *
   * The repository resolves concurrent first requests for the same credential
   * to exactly one person, never two — and, since P21-01, never to a person
   * with no credential either. See `provision_learner` in migration 0025.
   *
   * `provider` is carried rather than assumed: `(realm, sub)` alone is not a
   * key across identity providers, and a `local` participant whose subject
   * happened to collide with a Keycloak `sub` would otherwise resolve to
   * somebody else's CME record.
   */
  async syncFromToken(
    provider: CredentialProvider,
    realm: string,
    identity: VerifiedIdentity,
  ): Promise<UserRow> {
    return this.repository.provisionOrUpdate({
      provider,
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
