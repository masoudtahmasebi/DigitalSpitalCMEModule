/**
 * Administering participants (P21-04). Application layer — ADR-0006.
 *
 * ## The rule this file exists to hold
 *
 * **No administrator holds a physician's password** (P247-01). The one
 * exception is the account an administrator creates, whose generated password
 * is returned once by the create call, stored only as an Argon2id hash, and
 * flagged `must_change`.
 *
 * A reset does **not** mint a password: it mails the person the P40 reset
 * link. It used to return a temporary password, and a person who learns with
 * two customers holds one credential — so the administrator of one customer
 * received a password that signed in at the other.
 *
 * A block is per customer, on the membership (`user_customers.disabled_at`),
 * for the same reason.
 */

import { randomBytes } from "node:crypto";
import {
  planCredentialMerge,
  type MergePlan,
  type MergeRefusal,
  type MergeSide,
} from "@ds/domain";
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

/** What the console shows about one side of a merge, before confirming. */
export interface MergeParty {
  readonly userId: string;
  readonly email: string | null;
  readonly hasEfn: boolean;
  readonly enrolledCourseSlugs: readonly string[];
}

function party(side: MergeSide & { email: string | null }): MergeParty {
  return {
    userId: side.personId,
    email: side.email,
    // Whether, never which. No endpoint returns an EFN (ADR-0004), and the
    // operator does not need the digits to decide — they need to know that two
    // exist and differ, which the refusal already tells them.
    hasEfn: side.efnFingerprint !== null,
    enrolledCourseSlugs: side.enrolledCourseSlugs,
  };
}

/**
 * The German a refusal is shown as.
 *
 * Each one names what is in the way and what the operator can do about it,
 * because "Zusammenführen nicht möglich" is a dead end rather than a message.
 */
function refusalCopy(refusal: MergeRefusal): string {
  switch (refusal.reason) {
    case "same_person":
      return "Quelle und Ziel sind dieselbe Person.";
    case "conflicting_efn":
      return (
        "Für beide Zugänge ist eine unterschiedliche EFN hinterlegt. " +
        "Eine Zusammenführung würde bereits gemeldete Punkte einer anderen " +
        "Fortbildungsnummer zuordnen. Bitte klären Sie, welche EFN gilt."
      );
    case "overlapping_courses":
      return (
        "Beide Zugänge sind für dieselbe Fortbildung eingeschrieben (" +
        refusal.courseSlugs.join(", ") +
        "). Eine Zusammenführung würde einen der beiden Lernfortschritte " +
        "verwerfen."
      );
  }
}

export interface CreatedParticipant {
  readonly userId: string;
  /** Shown once. Never retrievable again — see the file header. */
  readonly temporaryPassword: string;
}

/** The P40 link, sent for one named person (`ParticipantAuthService`). */
export interface ParticipantResetLinks {
  beginPasswordResetFor(input: {
    customerId: string;
    userId: string;
    resetUrl: (projectSlug: string, token: string) => string;
  }): Promise<void>;
}

export class ParticipantService {
  constructor(
    private readonly repository: ParticipantRepository,
    private readonly resets: ParticipantResetLinks,
    /**
     * Builds the link from configuration, never from the request (§9.5).
     * `undefined` when the portal's address is not configured: then nothing is
     * minted, because a link nobody can follow is a credential nobody can spend.
     */
    private readonly resetUrl:
      ((projectSlug: string, token: string) => string) | undefined,
  ) {}

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

  /**
   * Mail the person a link to choose a new password (P247-01).
   *
   * Nothing is returned, set or revoked here: the password is unchanged until
   * the physician spends the link, so there is nothing to end sessions for —
   * and an administrator who suspects a compromise blocks the account, which
   * does end them.
   */
  async resetPassword(userId: string, customerId: string): Promise<void> {
    await this.requireLocalCredential(userId);
    if (this.resetUrl === undefined) return;
    await this.resets.beginPasswordResetFor({
      customerId,
      userId,
      resetUrl: this.resetUrl,
    });
  }

  /** Block, or unblock, this person **at this customer only** (P247-01). */
  async setDisabled(
    userId: string,
    disabled: boolean,
    byStaffId: string | null,
  ): Promise<void> {
    await this.requireLocalCredential(userId);
    await this.repository.setDisabled(userId, disabled, byStaffId);
    // Only on the way *in*. Re-enabling an account must not also hand back the
    // sessions it had when it was disabled — those are exactly the ones the
    // disable was aimed at. Only this customer's sessions: the block is ours.
    if (disabled) await this.repository.revokeSessionsAtThisCustomer(userId);
  }

  /**
   * Say what a merge would do, without doing any of it (P21-05).
   *
   * Separate from `merge` and always called first, because this operation
   * cannot be undone in any way a physician would accept and the operator has
   * to be shown both sides before confirming. A single endpoint that merged and
   * reported afterwards would make "what would this do?" unanswerable.
   */
  async previewMerge(
    sourceId: string,
    targetId: string,
  ): Promise<{
    readonly source: MergeParty;
    readonly target: MergeParty;
    readonly plan: MergePlan;
  }> {
    const source = await this.requirePerson(sourceId);
    const target = await this.requirePerson(targetId);

    return {
      source: party(source),
      target: party(target),
      plan: planCredentialMerge(source, target),
    };
  }

  /**
   * Move every credential and every record from `sourceId` onto `targetId`.
   *
   * The plan is re-computed here rather than trusted from the preview the
   * operator saw. Between the two calls a physician can start a course, and the
   * confirmation the operator is holding would then be a verdict about a state
   * that no longer exists — which is exactly the case where a merge destroys
   * progress.
   */
  async merge(input: {
    sourceId: string;
    targetId: string;
    actorId: string | null;
    actorEmail: string | null;
  }): Promise<void> {
    const source = await this.requirePerson(input.sourceId);
    const target = await this.requirePerson(input.targetId);
    const plan = planCredentialMerge(source, target);

    if (!plan.allowed) {
      throw new AppError(
        "conflict",
        `merge refused: ${plan.refusal.reason}`,
        refusalCopy(plan.refusal),
      );
    }

    await this.repository.merge({
      sourceId: input.sourceId,
      targetId: input.targetId,
      actorId: input.actorId,
      actorEmail: input.actorEmail,
      // Ids and counts only. Never an EFN, never a name — an audit row is read
      // by more people than the record it describes (CLAUDE.md §4 invariant 7).
      detail: {
        sourceId: input.sourceId,
        targetId: input.targetId,
        movedEnrolments: source.enrolledCourseSlugs.length,
        movedEfn: source.efnFingerprint !== null,
      },
    });
  }

  private async requirePerson(
    userId: string,
  ): Promise<MergeSide & { email: string | null }> {
    const side = await this.repository.mergeSideOf(userId);
    if (side === undefined) {
      throw AppError.notFound(`no participant user=${userId}`);
    }
    return side;
  }

  /**
   * The tenant check and the has-a-password check, in the order that matters.
   *
   * Membership first: a participant of another customer must answer 404, the
   * same as one that does not exist, so that an administrator cannot probe for
   * ids belonging to a tenant they cannot see.
   */
  private async requireLocalCredential(userId: string): Promise<void> {
    if (!(await this.repository.isMember(userId))) {
      throw AppError.notFound(`no participant user=${userId} in this customer`);
    }

    if (!(await this.repository.hasLocalCredential(userId))) {
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
  }
}
