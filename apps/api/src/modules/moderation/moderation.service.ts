/**
 * Learner-record and certificate moderation (P12-05). Application layer.
 *
 * Orchestration only. Every decision — may this name still be corrected, may
 * this subject be erased yet, is this certificate action available — is a pure
 * function in `@ds/domain/moderation`, called with the state this file gathers.
 *
 * ## Every operation here is audited, with the operator named
 *
 * These are the operations that touch a physician's CME record rather than a
 * course's content. "Who changed this person's name, and when" has to be
 * answerable years later, so each write records the staff account id and
 * `identity: "staff"` (ADR-0012). The one exception is erasure, which writes
 * its own audit row inside `erase_subject` — deliberately, because that row has
 * to survive in a form that quotes no erased value.
 */

import { Logger } from "@nestjs/common";
import {
  certificateAction,
  nameCorrection,
  subjectErasure,
  type CertificateAction,
} from "@ds/domain";
import type { AuditServicePort } from "../../audit/audit.service.js";
import { AppError } from "../../shared/problem-details.js";
import type { ObjectErasureResult } from "../certificate/object-erasure.service.js";
import {
  SubmissionStillOpenError,
  type CertificateRow,
  type LearnerSummary,
  type ModerationRepositoryPort,
  type SubjectErasureRepository,
} from "./moderation.repository.js";

export interface ModeratorContext {
  readonly customerId: string;
  readonly staffUserId: string;
}

/** Just the sweep, so the moderation service does not depend on a presigner. */
export interface ObjectErasurePort {
  drain(): Promise<ObjectErasureResult>;
}

/**
 * Rendering a certificate, as this service needs it (P179-02).
 *
 * A port with the two methods `CertificateAttachments` already uses, for the
 * same reason it uses them: there is one place that assembles a certificate's
 * fields and renders them, and a second assembly is how a support person ends
 * up e-mailing a document that differs from the one on the physician's screen.
 */
export interface StaffCertificateRenderPort {
  enrolmentIdFor(certificateId: string): Promise<string | undefined>;
  issueForEnrolment(
    enrolmentId: string,
    customerId: string,
    now: Date,
  ): Promise<{ filename: string; bytes: Uint8Array } | undefined>;
}

export class ModerationService {
  constructor(
    private readonly repository: ModerationRepositoryPort,
    private readonly erasure: SubjectErasureRepository,
    private readonly audit: AuditServicePort,
    /**
     * Discharges the object deletions `erase_subject` queued (P60-01).
     *
     * Optional so the service's own tests need no bucket, and so a deployment
     * without object storage — where nothing was ever archived — carries no
     * dead machinery. When it is absent the rows simply stay outstanding,
     * which is the honest state and is queryable.
     */
    private readonly objectErasure?: ObjectErasurePort,
    /**
     * Renders the PDF a support operator downloads (P179-02). Optional so the
     * service's existing tests need no renderer; the download route refuses
     * with a 501-shaped conflict rather than pretending when it is absent,
     * which cannot happen in the wired application.
     */
    private readonly certificates?: StaffCertificateRenderPort,
  ) {}

  listLearners(courseSlug: string | undefined): Promise<readonly LearnerSummary[]> {
    return this.repository.listLearners(courseSlug);
  }

  listCertificates(courseSlug: string | undefined): Promise<readonly CertificateRow[]> {
    return this.repository.listCertificates(courseSlug);
  }

  /**
   * Correct the name a certificate will carry (S4).
   *
   * Refused once the Punktemeldung has been accepted: the name is on the
   * Ärztekammer's record by then, and editing ours would make the two disagree
   * with nothing to show it had happened. The correction path after that point
   * is a written one, inside the seven-day window the Bescheid allows.
   */
  async correctName(
    enrolmentId: string,
    proposed: string,
    actor: ModeratorContext,
  ): Promise<void> {
    const enrolment = await this.repository.findEnrolment(enrolmentId);
    if (enrolment === undefined) {
      throw AppError.notFound(`enrolment=${enrolmentId} not visible in this tenant`);
    }

    const verdict = nameCorrection({ proposed, stage: enrolment.stage });
    if (!verdict.ok) {
      throw verdict.reason === "blank"
        ? AppError.badRequest("der Name darf nicht leer sein")
        : new AppError(
            "conflict",
            `refused: enrolment=${enrolmentId} already submitted to EIV`,
            "Die Punktemeldung wurde bereits an die Ärztekammer übermittelt. Der Name kann hier nicht mehr geändert werden — eine Korrektur muss innerhalb der Korrekturfrist schriftlich bei der Ärztekammer erfolgen.",
          );
    }

    const changed = await this.repository.correctName(enrolmentId, proposed.trim());
    if (!changed) throw AppError.notFound(`enrolment=${enrolmentId} disappeared`);

    await this.audit.recordForCustomer(actor.customerId, {
      actor: { identity: "staff", id: actor.staffUserId },
      action: "learner.name_corrected",
      subject: enrolmentId,
      // No names, old or new. ADR-0004: the audit log records that a correction
      // happened and who made it, never the personal data it moved.
      detail: { stage: enrolment.stage },
    });
  }

  /**
   * Erase a subject (GDPR Art. 17).
   *
   * The pending-submission check is made here so the operator gets a sentence
   * explaining the wait rather than a database exception. `erase_subject`
   * enforces the same rule itself and would refuse anyway — this is the
   * courteous half of a guarantee that lives in the database.
   */
  async eraseSubject(
    enrolmentId: string,
    reason: string,
    actor: ModeratorContext,
  ): Promise<{ enrolments: number; responses: number; submissions: number }> {
    const enrolment = await this.repository.findEnrolment(enrolmentId);
    if (enrolment === undefined) {
      throw AppError.notFound(`enrolment=${enrolmentId} not visible in this tenant`);
    }

    const pending = await this.repository.pendingSubmissionsFor(enrolment.userId);
    const verdict = subjectErasure({ pendingSubmissions: pending });
    if (!verdict.ok) throw pendingSubmissionRefusal(pending);

    // The database's check is the authoritative one — it sees across tenants,
    // which the count above cannot. Catching its refusal here is what keeps a
    // submission open at *another* customer from becoming a 500.
    const result = await this.erasure
      .erase(enrolment.userId, reason)
      .catch((error: unknown) => {
        if (error instanceof SubmissionStillOpenError) throw pendingSubmissionRefusal();
        throw error;
      });

    // A second row, tenant-scoped, naming the operator. `erase_subject` writes
    // its own — deliberately customer-less and quoting nothing erased — but
    // that row cannot say who pressed the button in which console, and Art. 19
    // accountability wants both halves.
    await this.audit.recordForCustomer(actor.customerId, {
      actor: { identity: "staff", id: actor.staffUserId },
      action: "learner.erasure_requested",
      subject: enrolment.userId,
      detail: { enrolments: result.enrolments },
    });

    /*
     * The archived PDFs, which SQL cannot delete (P60-01).
     *
     * After the audit record rather than before: the erasure has happened and
     * is recorded whatever the bucket does. A failure here leaves the rows
     * outstanding in `object_erasures` and they are retried on the next
     * erasure and on boot — an obligation that survives, rather than an
     * exception that would tell the operator their completed erasure failed.
     */
    await this.objectErasure?.drain().catch((error: unknown) => {
      /*
       * Swallowed, and now **said** (P146-03).
       *
       * The swallow is right: the erasure has happened and is recorded, the
       * outstanding rows survive in `object_erasures`, and the sweep in
       * `delivery.scheduler.ts` retries them. Failing the request here would
       * tell an operator their completed erasure failed.
       *
       * The silence was not right. From P142 until P146-03 this caught a
       * `PoolReentryError` on **every** erasure — the service had been built on
       * the request pool, so `guardReentry` refused its query — and the inline
       * drain did nothing at all, invisibly, for four days. A `catch` with an
       * empty body is a decision to never find out (§9.1).
       *
       * The name only. An object key names a customer, a course and a
       * certificate, and this is the one log an erasure must not enrich.
       */
      new Logger("ObjectErasure").warn(
        `object erasure drain failed after a subject erasure: ` +
          `${error instanceof Error ? error.name : "unknown"}`,
      );
    });

    return result;
  }

  /**
   * Regenerate, resend or revoke a certificate.
   *
   * One method for three actions because the guard is the same and the
   * difference is one repository call. Splitting them would put the same
   * `certificateAction` check in three places, and the third copy is where it
   * would be forgotten.
   */
  async actOnCertificate(
    id: string,
    action: CertificateAction,
    actor: ModeratorContext,
  ): Promise<void> {
    const certificate = await this.repository.findCertificate(id);
    if (certificate === undefined) {
      throw AppError.notFound(`certificate=${id} not visible in this tenant`);
    }

    const verdict = certificateAction({ action, status: certificate.status });
    if (!verdict.ok) {
      throw new AppError(
        "conflict",
        `refused: certificate=${id} is ${certificate.status}`,
        verdict.reason === "revoked"
          ? "Diese Bescheinigung wurde widerrufen und kann nicht erneut ausgestellt oder versendet werden."
          : "Diese Bescheinigung wurde noch nicht ausgestellt.",
      );
    }

    const applied = await this.apply(id, action);
    if (!applied) throw AppError.notFound(`certificate=${id} disappeared`);

    await this.audit.recordForCustomer(actor.customerId, {
      actor: { identity: "staff", id: actor.staffUserId },
      action: `certificate.${action}`,
      subject: id,
      // Not the participant's name, which is exactly the field a regeneration
      // usually changes and exactly the field that must not be logged.
      detail: { previousStatus: certificate.status },
    });
  }

  /**
   * The PDF, for an operator supporting the physician who did not get it
   * (P179-02).
   *
   * ## Refusals, and why each is a sentence rather than a silence
   *
   * `issueForEnrolment` answers `undefined` for every reason a certificate
   * cannot be produced, because its two existing callers have no screen — the
   * completion must stand either way, and the delivery sweep must not drop a
   * batch. This caller *is* a screen, so each case gets a sentence naming what
   * to do:
   *
   * - **revoked** — refused before rendering. Handing out a withdrawn document
   *   is the one outcome revocation exists to prevent.
   * - **not yet issued** — there is nothing to support with, and the reason is
   *   almost always that the physician has not finished.
   * - **`undefined`** — the course's certificate configuration is incomplete
   *   (a missing stamp, signature, VNR or name). The Zertifizierung tab
   *   already lists exactly which, so the message sends them there rather
   *   than repeating a list that would then have two homes.
   *
   * ## Audited as a disclosure, not as a change
   *
   * Nothing about the record moves — the token is minted only if there is
   * none, and `archiveOnce` keeps the first render. What happened is that a
   * named physician's participation record left the platform in an operator's
   * hands, and that is what the audit row says. No name, no filename: the id
   * of the certificate and who asked for it (ADR-0004).
   */
  async renderCertificateForStaff(
    id: string,
    actor: ModeratorContext,
    now: Date,
  ): Promise<{ filename: string; bytes: Uint8Array }> {
    const certificate = await this.repository.findCertificate(id);
    if (certificate === undefined) {
      throw AppError.notFound(`certificate=${id} not visible in this tenant`);
    }

    if (certificate.status === "revoked") {
      throw new AppError(
        "conflict",
        `refused: certificate=${id} is revoked`,
        "Diese Bescheinigung wurde widerrufen und kann nicht heruntergeladen werden.",
      );
    }
    if (certificate.status === "pending") {
      throw new AppError(
        "conflict",
        `refused: certificate=${id} is pending`,
        "Diese Bescheinigung wurde noch nicht ausgestellt. Sie entsteht, sobald die Person die Fortbildung abgeschlossen hat.",
      );
    }

    const renderer = this.certificates;
    if (renderer === undefined) {
      throw new AppError(
        "conflict",
        `certificate rendering is not configured on this deployment`,
        "Der Bescheinigungsdruck ist auf dieser Installation nicht eingerichtet.",
      );
    }

    const enrolmentId = await renderer.enrolmentIdFor(id);
    if (enrolmentId === undefined) {
      throw AppError.notFound(`certificate=${id} has no enrolment in this tenant`);
    }

    const file = await renderer.issueForEnrolment(enrolmentId, actor.customerId, now);
    if (file === undefined) {
      throw new AppError(
        "conflict",
        `certificate=${id} could not be rendered: incomplete certificate data`,
        "Diese Bescheinigung lässt sich derzeit nicht erzeugen. Auf dem Reiter „Zertifizierung“ dieser Fortbildung steht, welche Angaben dafür noch fehlen — meist Stempel, Unterschrift oder VNR.",
      );
    }

    await this.audit.recordForCustomer(actor.customerId, {
      actor: { identity: "staff", id: actor.staffUserId },
      action: "certificate.downloaded_by_staff",
      subject: id,
      detail: { status: certificate.status },
    });

    return file;
  }

  private apply(id: string, action: CertificateAction): Promise<boolean> {
    switch (action) {
      case "regenerate":
        return this.repository.markForRegeneration(id);
      case "resend":
        return this.repository.queueDelivery(id);
      case "revoke":
        return this.repository.revoke(id);
    }
  }
}

/**
 * One refusal, whichever check produced it.
 *
 * The tenant-scoped count and the database's own guard answer the same
 * question with different reach, and the operator should not be able to tell
 * which one fired — the instruction is identical either way.
 */
function pendingSubmissionRefusal(count?: number): AppError {
  return new AppError(
    "conflict",
    `refused: ${count ?? "one or more"} pending EIV submissions for this subject`,
    "Für diese Person ist noch eine Punktemeldung offen. Die Löschung ist möglich, sobald die Meldung abgeschlossen ist.",
  );
}
