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

  /**
   * Make a federated learner a participant of the customer whose project they
   * arrived through (P94-03).
   *
   * ## The rule, in the client's words
   *
   * > _"when the info for a user comes to our system from a wordpress system,
   * > if there is no detail for that user based on their email, a new
   * > participant would be created for them, if there is a participant already
   * > in the system, they can go on."_
   *
   * ## Why the credential and not the email is the key
   *
   * The person is already resolved by `syncFromToken`, from the credential the
   * customer's own Keycloak signed. Within one realm the subject *is* the
   * identity, so matching on email would decide nothing that is not already
   * decided — and across realms it would decide something dangerous:
   * `user.repository.ts` records why, and it is not a style preference. A
   * provider that does not verify email addresses could assert its way into a
   * physician's CME history and EFN, and the platform cannot tell which
   * providers verify. Linking two credentials to one person is P21-05:
   * deliberate, audited, and not something this path does by accident.
   *
   * So both halves of the client's sentence hold, by subject: a physician the
   * platform has not seen becomes a participant, and one it has seen goes on.
   * The half deliberately not built is joining a WordPress arrival to an
   * existing *portal* account with the same address — recorded in P94.md,
   * because it is a merge and merges are consented to, not inferred.
   *
   * ## Why this is not a blanket "any valid token is a participant"
   *
   * Only for a `keycloak` project, and only for the customer that project is
   * bound to. That binding is the platform's own row, written by an operator;
   * the token proves the customer's IdP vouches for this person, which is the
   * whole trust model of the embedded plane (ADR-0003). A `local` project's
   * participants are created by the portal's own invite flow and this never
   * touches them.
   *
   * Idempotent, so it is safe on the hot path of every request — the interesting
   * case is the first, and every later one writes nothing.
   */
  async provisionLearnerFor(userId: string, customerId: string): Promise<void> {
    await this.repository.grantLearnerMembership(userId, customerId);
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
