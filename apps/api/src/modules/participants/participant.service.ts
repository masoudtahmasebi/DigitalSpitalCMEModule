/**
 * Administering participants (P21-04). Application layer — ADR-0006.
 *
 * ## The rule this file exists to hold
 *
 * **A generated password is shown exactly once, and is never stored in a form
 * anybody can read.** It is returned by the call that created it and then only
 * its Argon2id hash survives. There is no "show password" screen, no way to
 * fetch it again, and no column it could be read out of — which is why every
 * method here that mints one says so in its return type rather than leaving the
 * caller to notice.
 *
 * The alternative — mailing an invitation link — is a credential-delivery
 * channel, and building one wants decisions about SMTP per customer that S8 has
 * not answered. Handing the administrator a password to pass on is the honest
 * interim, and `must_change` is what stops it being the physician's password
 * for ever.
 */

import { randomBytes } from "node:crypto";
import { hashPassword } from "../staff/credentials.js";
import { LOCAL_REALM } from "../../auth/local-identity-provider.js";
import { AppError } from "../../shared/problem-details.js";
import type {
  ParticipantRepository,
  ParticipantSummary,
} from "./participant.repository.js";

/**
 * 18 bytes of CSPRNG, base64url — about 144 bits.
 *
 * Long enough that it needs no complexity rules, short enough to read down a
 * telephone without mistakes, and generated rather than chosen because a
 * password an administrator invents for somebody else is the weakest one in the
 * system by a wide margin.
 */
function generatePassword(): string {
  return randomBytes(18).toString("base64url");
}

export interface CreatedParticipant {
  readonly userId: string;
  /** Shown once. Never retrievable again — see the file header. */
  readonly temporaryPassword: string;
}

export class ParticipantService {
  constructor(private readonly repository: ParticipantRepository) {}

  list(search: string | undefined): Promise<readonly ParticipantSummary[]> {
    return this.repository.list(search);
  }

  async create(input: {
    email: string;
    firstName: string;
    lastName: string;
    customerId: string;
  }): Promise<CreatedParticipant> {
    // Refused rather than silently attached. Two people sharing a local
    // credential is not something this can resolve on its own: it might be the
    // same physician learning with a second customer — which is P21-05's
    // deliberate merge — or a typo. Guessing either way is worse than a 409.
    if (await this.repository.localCredentialExists(input.email, LOCAL_REALM)) {
      throw new AppError(
        "conflict",
        `a local credential already exists for this address`,
        "Für diese E-Mail-Adresse existiert bereits ein Zugang. " +
          "Bitte prüfen Sie die Teilnehmendenliste.",
      );
    }

    const temporaryPassword = generatePassword();
    const { userId } = await this.repository.createPerson({
      email: input.email,
      firstName: input.firstName,
      lastName: input.lastName,
      realm: LOCAL_REALM,
      passwordHash: await hashPassword(temporaryPassword),
    });

    // The membership and the grant, in the tenant transaction. Without both,
    // sign-in succeeds and every route then answers 403 — the participant is
    // authenticated as somebody who belongs to no customer.
    await this.repository.createMembership(userId, input.customerId);

    return { userId, temporaryPassword };
  }

  /** A new temporary password, and every existing session ended. */
  async resetPassword(userId: string): Promise<{ temporaryPassword: string }> {
    const credentialId = await this.requireLocalCredential(userId);
    const temporaryPassword = generatePassword();

    await this.repository.setPassword(
      credentialId,
      await hashPassword(temporaryPassword),
      true,
    );
    // Order matters less than that both happen, but revoking after the write
    // means a session cannot be re-established with the old password in the
    // gap between the two.
    await this.repository.revokeSessions(userId);

    return { temporaryPassword };
  }

  async setDisabled(
    userId: string,
    disabled: boolean,
    byStaffId: string | null,
  ): Promise<void> {
    const credentialId = await this.requireLocalCredential(userId);
    await this.repository.setDisabled(credentialId, disabled, byStaffId);
    // Only on the way *in*. Re-enabling an account must not also hand back the
    // sessions it had when it was disabled — those are exactly the ones the
    // disable was aimed at.
    if (disabled) await this.repository.revokeSessions(userId);
  }

  /**
   * The tenant check and the has-a-password check, in the order that matters.
   *
   * Membership first: a participant of another customer must answer 404, the
   * same as one that does not exist, so that an administrator cannot probe for
   * ids belonging to a tenant they cannot see.
   */
  private async requireLocalCredential(userId: string): Promise<string> {
    if (!(await this.repository.isMember(userId))) {
      throw AppError.notFound(`no participant user=${userId} in this customer`);
    }

    const credentialId = await this.repository.credentialIdFor(userId);
    if (credentialId === undefined) {
      // A federated participant. Their password lives at the customer's
      // Keycloak, and pretending we could reset it would be a button that
      // silently does nothing.
      throw new AppError(
        "conflict",
        `user=${userId} has no local credential`,
        "Diese Person meldet sich über das Identitätssystem des Kunden an. " +
          "Das Passwort kann hier nicht geändert werden.",
      );
    }
    return credentialId;
  }
}
