/**
 * Evaluation, EFN and course completion (P6, P1-06, P7). Application layer.
 *
 * This is the last gate before a CME point is claimed on a physician's behalf,
 * so two rules govern everything below:
 *
 * 1. **Re-check, never trust.** `complete()` does not read a "ready" flag the
 *    client sent, and does not trust the state it handed the client a moment
 *    ago. It re-derives every condition from stored rows through
 *    `isCourseComplete`, and refuses if any is outstanding.
 * 2. **The EFN and free-text answers never leave.** Neither is returned by any
 *    method here, and neither is put in an error message, a log line or an
 *    audit `detail` (ADR-0004, CLAUDE.md §4 invariant 7).
 *
 * `eivDeadlines` computes the statutory windows. `Veranstaltungsende` for an
 * on-demand course is taken as the learner's completion time — the reading
 * that makes operational sense, and the one flagged in docs/show-stoppers.md
 * as still needing confirmation from the Ärztekammer. It is passed as an
 * argument here rather than assumed inside the domain, so changing the answer
 * is a one-line change at this call site.
 */

import {
  composeAttestedName,
  efnRefresh,
  eivDeadlines,
  isValidEfn,
  submissionStage,
  deliveryAddress,
} from "@ds/domain";
import { AppError } from "../../shared/problem-details.js";
import type { Db } from "../../db/tenant-db.js";
import {
  LearningRepository,
  type AttestedCompletion,
} from "../learning/learning.repository.js";
import { LearningService, type LearnerContext } from "../learning/learning.service.js";
import type { EnrolmentState } from "../learning/learning.dto.js";
import { CertificateService } from "../certificate/certificate.service.js";
import type { CertificateArchivePort } from "../certificate/certificate.archive.js";
import {
  CompletionRepository,
  type CompletionRepositoryPort,
} from "./completion.repository.js";
import type {
  CompletionInput,
  Evaluation,
  EvaluationSubmission,
} from "./completion.dto.js";

/**
 * What the completion needs from the certificate module: issue this one, now.
 *
 * A port rather than the class, so `completion.service.test.ts` stays a test of
 * the completion rules and does not have to stand up a PDF renderer.
 */
export interface CertificateIssuerPort {
  issueForEnrolment(enrolmentId: string, customerId: string, now: Date): Promise<unknown>;
}

const EVALUATION_KINDS = ["scale", "single", "multi", "text"] as const;
type EvaluationKind = (typeof EVALUATION_KINDS)[number];

export class CompletionService {
  constructor(
    private readonly repository: CompletionRepositoryPort,
    private readonly learning: LearningService,
    /**
     * Optional so the service's own tests can leave it out — every case in
     * them is about the completion rules, and none is about a PDF. `fromDb`
     * always supplies one, so nothing in production runs without it.
     */
    private readonly certificates?: CertificateIssuerPort,
  ) {}

  static fromDb(db: Db, archive?: CertificateArchivePort): CompletionService {
    return new CompletionService(
      new CompletionRepository(db),
      new LearningService(new LearningRepository(db)),
      CertificateService.fromDb(db, archive),
    );
  }

  async getEvaluation(slug: string, learner: LearnerContext): Promise<Evaluation> {
    const { course, enrolment } = await this.learning.requireEnrolled(slug, learner);

    const [questions, submitted] = await Promise.all([
      this.repository.findEvaluationQuestions(course.id),
      this.repository.hasEvaluationResponse(enrolment.id),
    ]);

    return {
      courseSlug: slug,
      submitted,
      questions: questions.map((question) => ({
        id: question.id,
        ordinal: question.ordinal,
        kind: normaliseKind(question.kind),
        prompt: question.prompt,
        required: question.required,
        options: readOptions(question.options),
      })),
    };
  }

  /**
   * Record the evaluation. Once only — it is a statement about the course, and
   * re-submitting would either duplicate or silently overwrite a response the
   * Veranstalter may already have acted on.
   */
  async submitEvaluation(
    slug: string,
    submission: EvaluationSubmission,
    learner: LearnerContext,
  ): Promise<EnrolmentState> {
    const { course, enrolment } = await this.learning.requireEnrolled(slug, learner);

    // P51-02. The evaluation is a statement about a course that is still
    // running; once the window closes there is nothing left to advance.
    this.learning.requireCourseStillOffered(course, slug);

    if (await this.repository.hasEvaluationResponse(enrolment.id)) {
      throw new AppError(
        "conflict",
        `enrolment=${enrolment.id} already has an evaluation response`,
        "Die Evaluation wurde bereits abgeschickt.",
      );
    }

    const questions = await this.repository.findEvaluationQuestions(course.id);
    const known = new Map(questions.map((question) => [question.id, question]));

    for (const answer of submission.answers) {
      if (!known.has(answer.evaluationId)) {
        throw new AppError(
          "validation",
          `answer references evaluation=${answer.evaluationId} outside course=${course.id}`,
          "Die Antworten gehören nicht zu dieser Evaluation.",
        );
      }
    }

    const answered = new Set(submission.answers.map((answer) => answer.evaluationId));
    const missing = questions.filter(
      (question) => question.required && !answered.has(question.id),
    );
    if (missing.length > 0) {
      // Ids only. The prompts are course content, but echoing answer content
      // back in an error is how personal data reaches a log.
      throw new AppError(
        "validation",
        `evaluation missing ${missing.length} required answer(s)`,
        "Bitte beantworten Sie alle Pflichtfragen.",
      );
    }

    await this.repository.saveEvaluationResponses({
      customerId: learner.customerId,
      enrolmentId: enrolment.id,
      answers: submission.answers,
    });

    return this.learning.getState(slug, learner);
  }

  /**
   * Store the learner's EFN.
   *
   * Validated by the domain's `isValidEfn`, not only by the DTO's regex: the
   * rule about what an EFN is belongs with the other accreditation rules, and
   * the schema check is defence in depth at the edge.
   */
  async setEfn(efn: string, learner: LearnerContext): Promise<void> {
    if (!isValidEfn(efn)) {
      // The value is deliberately absent from the message — an invalid EFN is
      // still personal data, and error strings end up in logs.
      throw new AppError(
        "validation",
        `rejected EFN for user=${learner.userId}: failed domain validation`,
        "Die EFN muss aus genau 15 Ziffern bestehen.",
      );
    }

    await this.repository.saveEfn(learner.userId, efn);
    await this.refreshOwnSubmissions(learner.userId, learner.customerId, efn);
  }

  /**
   * The address this learner's Teilnahmebescheinigung goes to (P183-03).
   *
   * Their own enrolment, their own address, and it does **not** touch
   * `users.email`: for a portal participant that column is also the sign-in
   * credential, and changing where a document is sent must not change how
   * somebody signs in. Migration 0052 carries the whole argument.
   *
   * Shares `deliveryAddress` with the operator's route, which is the point of
   * the rule living in `@ds/domain` — two validators would drift, and the
   * permissive direction drifts silently into a certificate nobody receives.
   */
  /** Both addresses, so a screen can show which one will actually be used. */
  async readDeliveryEmail(
    slug: string,
    learner: LearnerContext,
  ): Promise<{ readonly email: string | null; readonly accountEmail: string | null }> {
    const enrolment = await this.repository.findEnrolmentForDelivery(
      slug,
      learner.userId,
    );
    if (enrolment === undefined) {
      throw AppError.notFound(`no enrolment for user=${learner.userId} on slug=${slug}`);
    }
    return { email: enrolment.deliveryEmail, accountEmail: enrolment.accountEmail };
  }

  async setDeliveryEmail(
    slug: string,
    proposed: string,
    learner: LearnerContext,
  ): Promise<{ readonly email: string | null }> {
    const enrolment = await this.repository.findEnrolmentForDelivery(
      slug,
      learner.userId,
    );
    if (enrolment === undefined) {
      throw AppError.notFound(`no enrolment for user=${learner.userId} on slug=${slug}`);
    }

    const decision = deliveryAddress({ proposed, current: enrolment.deliveryEmail });
    if (!decision.ok) {
      if (decision.reason === "unchanged") return { email: enrolment.deliveryEmail };
      // The field, never the value: an address is personal data and the
      // rejected one is the case that carries somebody's name.
      throw new AppError(
        "validation",
        `rejected delivery address for user=${learner.userId}: ${decision.reason}`,
        decision.reason === "too_long"
          ? "Diese E-Mail-Adresse ist zu lang."
          : "Bitte geben Sie eine gültige E-Mail-Adresse ein.",
      );
    }

    await this.repository.saveDeliveryEmail(enrolment.id, decision.email);
    return { email: decision.email };
  }

  /**
   * Carry a corrected EFN onto the Punktemeldungen that have not gone yet
   * (P179-03).
   *
   * ## The gap this closes
   *
   * `efn_profiles.efn` and `eiv_submissions.efn` are two copies of one value.
   * P118 taught the *requeue* path to reconcile them and left the moment the
   * correction is actually made untouched — so a physician who fixed a typo at
   * 10:00 had the old number sent at 10:05 unless an operator happened to
   * requeue the row in between. The correction looked like it worked, and the
   * screen that would have shown otherwise does not exist.
   *
   * That is §9.10b exactly, on the one field that decides *which* physician is
   * credited, so it is fixed at the write rather than left to a later repair.
   *
   * ## Why the refusal is silent here, and where it is not
   *
   * `efnRefresh` refuses a submission the Kammer has already accepted (S30),
   * and this does not turn that into an error for the physician: their profile
   * *is* corrected, their certificate will carry the new number, and the
   * accepted Meldung is a matter between the operator and the Ärztekammer that
   * the person typing into a form can do nothing about. Making them fail here
   * would leave them unable to fix their own record because of a report they
   * cannot see.
   *
   * The divergence is not swallowed, though: it is exactly what the
   * participant list's `efnDivergesFromReport` reports to the operator, who is
   * the party that can act on it.
   */
  private async refreshOwnSubmissions(
    userId: string,
    customerId: string,
    efn: string,
  ): Promise<void> {
    const submissions = await this.repository.findOwnSubmissions(userId);

    for (const submission of submissions) {
      const verdict = efnRefresh({
        onSubmission: submission.efn,
        onProfile: efn,
        stage: submissionStage(submission.status),
      });
      if (verdict.kind !== "refresh") continue;

      /*
       * The write and its audit row in one call, inside the request's
       * transaction. If the correction rolls back so does the record of it,
       * which is the property that matters here — unlike a moderation action,
       * where the audit row deliberately outlives the rollback of what it
       * audits because *the attempt* is the accountable fact.
       *
       * That the identifier moved is what is recorded. What it moved to is the
       * physician's and never the log's (§9.5, ADR-0004).
       */
      await this.repository.updateSubmissionEfn(submission.id, verdict.efn, {
        customerId,
        userId,
        enrolmentId: submission.enrolmentId,
        fromStatus: submission.status,
      });
    }
  }

  /**
   * The learner's own EFN, or null (P54-02).
   *
   * ## Why this exists, having deliberately not existed
   *
   * The EFN was write-only for six phases and the reasoning was sound: it is a
   * physician's identifier at their Kammer, and an endpoint that returns one is
   * an endpoint that can leak one. What that reasoning left out is the person
   * who typed it. A physician who supplied an EFN months ago, on a different
   * device, has no way to see what the platform will report on their behalf —
   * and no way to notice a typo until the Kammer credits somebody else's
   * account, which is the failure ADR-0004 itself calls the worst available
   * because it looks like success.
   *
   * GDPR Art. 15 makes the answer available on request in any case. The choice
   * was never whether the subject may see it, only whether they see it in the
   * product or by writing to a mailbox.
   *
   * ## What keeps it from being the leak the old rule feared
   *
   * **The subject is not a parameter.** `learner.userId` comes off the
   * validated principal. There is no shape of this request that names another
   * person, so there is nothing to enumerate and nothing for a broken
   * authorisation check to widen — the only account reachable is the one
   * already signed in.
   *
   * ## `required`, and what it is not
   *
   * `{"efn": null}` alone cannot tell "we do not need one from you" from "we
   * need one and you have not given it" — and only the server knows which,
   * because it turns on whether any of this learner's enrolments awards CME
   * points (P57-01). A course without points reports nothing to EIV-FOBI, so
   * there is nothing an EFN would identify and demanding one would collect a
   * physician's identifier for no purpose (ADR-0004).
   *
   * It describes the **courses**, not the gap: `required` stays true after an
   * EFN is supplied, because the requirement did not go away. A client that
   * wants to prompt asks for `required && efn === null`, which is one
   * expression and cannot drift from the server's meaning of either half.
   *
   * The admin surface is unchanged: `participantRowSchema` still reports
   * `efnPresent: boolean` and nothing anywhere returns another person's EFN.
   * A customer admin holds a grant over a *tenant*; an EFN belongs to a
   * *physician*, who may hold enrolments at several customers (docs/gdpr.md
   * §9). Those are different scopes and only the narrower one is opened here.
   */
  async getEfn(
    learner: LearnerContext,
  ): Promise<{ efn: string | null; required: boolean }> {
    const [efn, required] = await Promise.all([
      this.repository.findEfn(learner.userId),
      this.repository.hasPointBearingEnrolment(learner.userId),
    ]);

    return { efn: efn ?? null, required };
  }

  /**
   * Finalise the course and queue the Punktemeldung.
   *
   * Idempotent: a second call returns the same completed state and does not
   * re-queue, because the reporting deadline runs from the first completion.
   */
  async complete(
    slug: string,
    input: CompletionInput,
    learner: LearnerContext,
    now: Date,
  ): Promise<EnrolmentState> {
    const { course, enrolment } = await this.learning.requireEnrolled(slug, learner);

    if (enrolment.completedAt !== null) return this.learning.getState(slug, learner);

    /*
     * P51-02, and the one refusal in this change with a cost attached.
     *
     * After the idempotency check above, so an already-certified learner still
     * gets their state back rather than an error about a course they finished.
     * But a learner who completed the videos and the quiz *before* the window
     * closed and comes back for the paperwork *after* is refused here, and the
     * CME point they earned is not claimable through the product.
     *
     * That is what "keep the existing and do not let them go on" asks for, and
     * it is deliberate rather than overlooked — see docs/show-stoppers.md S17,
     * which is the question of whether the Kammer wants a grace period keyed to
     * the course completion instead. The two-line change is here if so.
     */
    this.learning.requireCourseStillOffered(course, slug);

    /*
     * The EFN arrives with the rest of the form (layout page 13) rather than
     * through a second request, and it is stored **before** the completeness
     * check rather than after.
     *
     * That ordering is the whole point: `efn` is one of the conditions
     * `isCourseComplete` tests, so a request that supplies it and is then
     * checked against a state computed a moment earlier would be refused for
     * missing the very thing it just supplied. Saving first is what lets one
     * screen and one button do what the layout says they do.
     */
    if (input.efn !== undefined) await this.setEfn(input.efn, learner);

    // The authority on whether this is allowed — recomputed from stored rows,
    // never taken from the client or from a cached view.
    const state = await this.learning.getState(slug, learner);

    if (!state.complete) {
      throw new AppError(
        "conflict",
        `enrolment=${enrolment.id} incomplete: ${state.outstanding.join(", ")}`,
        `Es fehlt noch: ${state.outstanding.map(describeCondition).join(", ")}.`,
      );
    }

    // The name the learner attests to, stamped with the completion it belongs
    // to. Absent means "use my profile name" — see completion.dto.ts.
    await this.learning.markCompleted(enrolment.id, now, attestedFrom(input));

    await this.queueSubmission(course.vnr, enrolment.id, learner, now);
    await this.issueCertificate(enrolment.id, learner, now);

    return { ...state, completedAt: now.toISOString() };
  }

  /**
   * Issue the certificate the moment it is earned (P59-01).
   *
   * ## Why the completion does this rather than the download
   *
   * The `certificates` row used to be created only when somebody first
   * *fetched* the PDF. Everything downstream keys on that row: the delivery
   * sweep claims `status = 'issued'`, so a physician who finished a course and
   * closed the tab was never emailed anything — the whole durable delivery
   * pipeline (P8-03) could only ever run for people who had already downloaded
   * the certificate themselves, which is precisely the population that did not
   * need the e-mail. QA completed a course and watched the queue stay empty.
   *
   * ## Why a failure here does not fail the completion
   *
   * The physician has met every condition; the point is earned and the
   * Punktemeldung is queued above. A course missing its stamp, or a name we
   * cannot compose, is an authoring gap — the same trade `queueSubmission`
   * makes one line up. `issueForEnrolment` answers `undefined` rather than
   * throwing for exactly those cases, and the download route still explains
   * them properly to somebody looking at a screen.
   */
  private async issueCertificate(
    enrolmentId: string,
    learner: LearnerContext,
    now: Date,
  ): Promise<void> {
    await this.certificates?.issueForEnrolment(enrolmentId, learner.customerId, now);
  }

  /**
   * Queue the EIV submission, or record why it could not be queued.
   *
   * A course with no VNR is an authoring gap, not a learner problem: the
   * learner's completion stands and the missing VNR is an admin alert (P7-07).
   * Failing their completion because someone forgot to enter a number would be
   * the wrong trade.
   */
  private async queueSubmission(
    vnr: string | null,
    enrolmentId: string,
    learner: LearnerContext,
    now: Date,
  ): Promise<void> {
    if (vnr === null || vnr === "") return;
    if (await this.repository.hasEivSubmission(enrolmentId)) return;

    const efn = await this.repository.findEfn(learner.userId);
    // Unreachable via `complete` — `efnPresent` is one of the conditions — but
    // asserted rather than assumed, because a submission without an EFN cannot
    // be credited to anyone.
    if (efn === undefined) return;

    // `Veranstaltungsende` for an on-demand course: the learner's completion.
    // See the file header and docs/show-stoppers.md — this is the open
    // question, isolated to this one line.
    const deadlines = eivDeadlines({ eventEndAt: now, now });

    await this.repository.queueEivSubmission({
      customerId: learner.customerId,
      enrolmentId,
      vnr,
      efn,
      eventEndAt: now,
      reportDueAt: deadlines.reportDueAt,
    });
  }
}

function describeCondition(condition: string): string {
  switch (condition) {
    case "watch":
      return "die vollständige Videowiedergabe";
    case "quiz":
      return "die Lernerfolgskontrolle";
    case "evaluation":
      return "die Evaluation";
    case "efn":
      return "Ihre EFN";
    default:
      return condition;
  }
}

/** The column is free text; anything unrecognised renders as a text question. */
function normaliseKind(kind: string): EvaluationKind {
  return (EVALUATION_KINDS as readonly string[]).includes(kind)
    ? (kind as EvaluationKind)
    : "text";
}

function readOptions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

/**
 * Turn the layout's three name fields into what gets stored.
 *
 * The composition itself is `@ds/domain`'s — one composer, so the certificate
 * and the Punktemeldung cannot end up carrying names that differ by a space.
 * This function only decides what to do when the parts are absent, which is
 * nothing: `null` tells the repository to leave the stored name alone, and the
 * certificate falls back to the profile.
 *
 * The DTO has already refused a given name without a family name, so a partial
 * composition cannot reach here. It is checked again anyway — `composeAttestedName`
 * returning `ok: false` on input the schema accepted would mean the two
 * disagree, and silently writing a wrong name is not an acceptable way to find
 * that out.
 */
function attestedFrom(input: CompletionInput): AttestedCompletion {
  const none: AttestedCompletion = {
    name: null,
    title: null,
    givenName: null,
    familyName: null,
    address: input.attestedAddress ?? null,
    consentDocument: input.consentDocument ?? null,
  };

  if (input.attestedGivenName === undefined || input.attestedFamilyName === undefined) {
    return none;
  }

  const composed = composeAttestedName({
    title: input.attestedTitle,
    givenName: input.attestedGivenName,
    familyName: input.attestedFamilyName,
  });

  if (!composed.ok) {
    throw new AppError(
      "validation",
      `attested name rejected by the domain: ${composed.problems.join(", ")}`,
      "Bitte prüfen Sie Vorname und Nachname.",
    );
  }

  return {
    name: composed.name,
    title: composed.parts.title ?? null,
    givenName: composed.parts.givenName,
    familyName: composed.parts.familyName,
    address: input.attestedAddress ?? null,
    consentDocument: input.consentDocument ?? null,
  };
}
