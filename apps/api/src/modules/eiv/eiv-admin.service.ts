/**
 * Operator-facing EIV operations (P31-02). Application layer. **Human review
 * gate — `CLAUDE.md` §2.**
 *
 * Three things an operator can do about a Punktemeldung, and one they can ask:
 *
 * | Operation      | Why it exists                                                     |
 * | -------------- | ----------------------------------------------------------------- |
 * | `describeEvent`| The accredited period decides whether *any* completion can be reported, and it is knowable before the first one |
 * | `reconcile`    | Our log records what we sent; only the authority knows what it holds |
 * | `requeue`      | The worker gives up permanently on a `business` failure, and an operator can fix the cause |
 * | `withdraw`     | The 7-day correction window existed with nothing able to correct anything |
 *
 * ## What this file deliberately does not decide
 *
 * Whether the correction window is still open is `eivDeadlines`, not a date
 * comparison written here. Whether a failure is permanent is the client's
 * classification. This file gathers state, asks, and records — the same shape
 * as the worker, for the same reason: a second opinion about a deadline that
 * cannot be reopened is worse than no opinion.
 *
 * ## Requeue does not submit
 *
 * It resets the row and lets the ordinary worker take it. Submitting inline
 * would put the retry budget, the deadline arithmetic and the failure
 * classification on a second code path, and the whole design of P7 is that
 * there is exactly one.
 */

import { efnCorrection, efnRefresh, eivDeadlines, submissionStage } from "@ds/domain";
import {
  EivError,
  EIV_PASSWORD_KEY,
  eivEndpointTier,
  type EivEndpointTier,
} from "@ds/eiv-client";
import type {
  AccreditedEvent,
  AuthorityQuery,
  ReportedParticipation,
} from "@ds/plugin-api";
import type { AuditServicePort } from "../../audit/audit.service.js";
import { AppError } from "../../shared/problem-details.js";
import type { EivSubmitterPort } from "./eiv.service.js";
import type {
  EivAdminRepositoryPort,
  EivSubmissionStatus,
  SubmissionPage,
} from "./eiv-admin.repository.js";

export interface EivOperatorContext {
  readonly customerId: string;
  readonly staffUserId: string;
}

/** One physician's row, ours against theirs. */
export interface ReconciliationRow {
  readonly efnMasked: string;
  readonly here: boolean;
  readonly there: boolean;
  readonly participatedOn: string | null;
  readonly attendance: boolean | null;
  readonly assessment: boolean | null;
}

export interface Reconciliation {
  readonly rows: readonly ReconciliationRow[];
  readonly onlyHere: number;
  readonly onlyThere: number;
}

/**
 * One step of the connection check, and what it found (P103-01).
 *
 * `kind` is the client's own classification — `auth`, `rate_limited`, `server`,
 * `business`, `format`, `network` — and it is what decides whether an operator
 * should retype a password, wait, or call EIV. `detail` is the authority's own
 * words. Neither ever carries a credential: the password travels in a header
 * and `EivError` records a redacted request.
 */
export interface EivCheckStep {
  readonly step: "authenticate" | "event" | "reported";
  readonly ok: boolean;
  readonly kind?: string;
  readonly detail?: string;
}

/**
 * What the screen renders. Deliberately contains no password field of any
 * kind — not even a masked one, because a masked secret in a response is still
 * a secret in a response.
 */
export interface EivConnectionReport {
  readonly endpoint: string;
  /**
   * Which register that address is, decided here rather than read off the
   * hostname by the person looking at it (P107-01).
   *
   * The screen showed the URL and nothing else, and the client's report was
   * *"i updated this, still shows with test in verwaltung"* — reading
   * `backend-test.eiv-fobi.de` against `backend.eiv-fobi.de` and having no way
   * to know that the one-word difference is the difference between EIV's
   * sandbox and the Ärztekammer's live register. A URL is not an answer to
   * "which system am I about to file statutory reports into" unless you already
   * know EIV's naming convention (§9.4).
   *
   * The same `eivEndpointTier` the deploy guard and the worker use — one
   * definition, so the screen cannot develop a second opinion about which
   * endpoint is dangerous.
   */
  readonly tier: EivEndpointTier;
  /**
   * Is the worker armed? (P107-01)
   *
   * `EIV_WORKER_ENABLED`, which decides whether a completed enrolment actually
   * files a Punktemeldung. It is on this report because it is the other half of
   * the only question that matters here — a live endpoint with the worker off
   * is a credential test, and a live endpoint with the worker on is a statutory
   * filing against a real physician's EFN — and until now it was visible
   * **nowhere in the product**: an operator could read it only by opening
   * `config.env` on the host over SSH.
   *
   * §9.2's mirror. A control that can only fail must not be offered; a
   * consequence the system *will* produce must not be hidden.
   */
  readonly submissionsEnabled: boolean;
  readonly vnr: string;
  readonly usedStoredPassword: boolean;
  readonly steps: readonly EivCheckStep[];
  readonly event?: AccreditedEvent;
  readonly reportedCount?: number;
}

/** The two diagnostic fields, present only on a failure. */
function describe(kind: string, detail: string): { kind: string; detail: string } {
  return { kind, detail };
}

/** Statuses meaning "we believe the Ärztekammer has this". */
const ACCEPTED_STATUSES = new Set(["submitted"]);

/**
 * Whether this installation will send anything to an Ärztekammer (P121-01).
 *
 * `willFile` is the answer; the other two are its inputs, kept because an
 * operator debugging a silent queue wants to know *which* half is off.
 */
export interface EivReportingPosture {
  readonly submissionsEnabled: boolean;
  readonly tier: EivEndpointTier;
  readonly willFile: boolean;
}

export class EivAdminService {
  constructor(
    private readonly repository: EivAdminRepositoryPort,
    private readonly submitter: EivSubmitterPort,
    private readonly audit: AuditServicePort,
    private readonly options: {
      readonly baseUrl: string;
      readonly submissionsEnabled: boolean;
    },
  ) {}

  async describeEvent(slug: string): Promise<AccreditedEvent> {
    const course = await this.requireAccredited(slug);

    if (this.submitter.describeEvent === undefined) {
      throw new AppError(
        "conflict",
        "reporter cannot describe an event",
        "Diese Schnittstelle kann keine Veranstaltungsdaten liefern.",
      );
    }

    return this.callAuthority(() =>
      // Non-null: `describeEvent` was just checked, and narrowing does not
      // survive the closure.
      this.submitter.describeEvent!({
        vnr: course.vnr,
        endpoint: this.options.baseUrl,
        credentials: { [EIV_PASSWORD_KEY]: course.vnrPassword },
      }),
    );
  }

  /**
   * Does this VNR and password actually reach EIV? (P103-01)
   *
   * ## Why a screen for this, when the worker already talks to EIV
   *
   * The worker talks to EIV *after* a physician has completed a course, and by
   * then the deadline clock has started: eight days to report, seven more to
   * correct, then the window closes permanently. A wrong password discovered
   * there is discovered with a statutory deadline running and a learner already
   * holding a Teilnahmebescheinigung. An operator needs to know it works
   * **before** anybody enrols, and until now the only way to find out was to
   * let a real completion try (§9.9: a setting nobody has exercised is a
   * setting nobody knows the state of).
   *
   * ## What it cannot do, structurally
   *
   * There is **no path from here to `push_teilnahme`**. This method reaches the
   * two read-only capabilities and nothing else — a `Reporter` exposes `submit`
   * as a separate method and this one never names it. That is deliberate and is
   * the difference between "we chose not to push" and "pushing is unreachable":
   * a button on a settings screen that could file a Punktemeldung against a
   * real physician's EFN is a button somebody eventually clicks to see what
   * happens, and a Punktemeldung cannot be taken back — a retraction is another
   * entry on the record, not an erasure.
   *
   * ## The password
   *
   * `supplied` lets an operator prove a credential *before* saving it, which is
   * the order somebody actually works in — otherwise the only way to test a new
   * password is to overwrite the working one. When it is absent the stored one
   * is used. Either way it goes to EIV in a header, never into the response,
   * never into the audit `detail`, and never into a log (CLAUDE.md §5).
   */
  async checkConnection(
    slug: string,
    supplied: string | undefined,
    actor: EivOperatorContext,
  ): Promise<EivConnectionReport> {
    const course = await this.requireAccreditedVnr(slug, supplied);

    const query = {
      vnr: course.vnr,
      endpoint: this.options.baseUrl,
      credentials: { [EIV_PASSWORD_KEY]: course.vnrPassword },
    };

    const steps: EivCheckStep[] = [];
    let event: AccreditedEvent | undefined;
    let reportedCount: number | undefined;

    /*
     * `describeEvent` authenticates and then reads the event, so one call
     * covers two of the four endpoints. The failure is split back apart by
     * `EivError.kind`: `auth` is a 401/403 from the token exchange and means
     * the credentials are wrong; anything else means they were accepted and
     * something later went wrong. Those two send an operator to completely
     * different places, and a single "EIV did not answer" would send them to
     * the wrong one half the time (§9.4).
     */
    try {
      event = await this.describeVia(query);
      steps.push({ step: "authenticate", ok: true });
      steps.push({ step: "event", ok: true });
    } catch (error) {
      const kind = error instanceof EivError ? error.kind : "unknown";
      const detail = error instanceof EivError ? error.message : "unexpected failure";
      steps.push({
        step: "authenticate",
        ok: kind !== "auth",
        ...describe(kind, detail),
      });
      steps.push({ step: "event", ok: false, ...describe(kind, detail) });
    }

    /*
     * Attempted even when the event read failed, because the two can fail
     * independently and an operator wants the whole picture from one click
     * rather than a screen that stops at the first problem and hides the
     * second.
     */
    try {
      const rows = await this.listVia(query);
      reportedCount = rows.length;
      steps.push({ step: "reported", ok: true });
    } catch (error) {
      const kind = error instanceof EivError ? error.kind : "unknown";
      const detail = error instanceof EivError ? error.message : "unexpected failure";
      steps.push({ step: "reported", ok: false, ...describe(kind, detail) });
    }

    /*
     * Audited, because it sends a customer's credential to a third party. The
     * `detail` names the endpoint and the outcome and nothing else — never the
     * password, and never the VNR's own password field (§4 invariant 7).
     */
    await this.audit.recordForCustomer(actor.customerId, {
      actor: { identity: "staff", id: actor.staffUserId },
      action: "eiv.connection_checked",
      subject: slug,
      detail: {
        endpoint: this.options.baseUrl,
        ok: steps.every((entry) => entry.ok),
        // *Whether* one was typed, never the value — and useful, because a
        // check that passed with a supplied password and fails with the stored
        // one means somebody proved a credential and did not save it.
        suppliedPassword: supplied !== undefined,
      },
    });

    return {
      ...this.reportContext(),
      vnr: course.vnr,
      usedStoredPassword: supplied === undefined,
      steps,
      ...(event === undefined ? {} : { event }),
      ...(reportedCount === undefined ? {} : { reportedCount }),
    };
  }

  /**
   * The three fields that describe *the installation* rather than the check.
   *
   * One method rather than three properties spelled at each call site, so a
   * future report cannot carry the address without the tier beside it — which
   * is the whole defect this was written for. `EivConnectionReport` requires
   * all three, so omitting the spread does not compile.
   */
  private reportContext(): {
    endpoint: string;
    tier: EivEndpointTier;
    submissionsEnabled: boolean;
  } {
    return {
      endpoint: this.options.baseUrl,
      tier: eivEndpointTier(this.options.baseUrl),
      submissionsEnabled: this.options.submissionsEnabled,
    };
  }

  /**
   * The Punktemeldung queue (P110-01).
   *
   * A read, and deliberately a read of **our own records** rather than of the
   * authority — `reconcile` already asks EIV what they hold, and conflating the
   * two would produce a screen that cannot be opened when EIV is down. An
   * operator whose submissions are stuck needs the screen most at exactly the
   * moment the authority is unreachable.
   *
   * Not audited: it contacts nobody, discloses no EFN, and an audit entry per
   * page view would bury the entries that matter (`eiv.connection_checked`,
   * every submission attempt) under navigation noise.
   */
  async listSubmissions(query: {
    readonly status?: EivSubmissionStatus;
    readonly page: number;
    readonly perPage: number;
    readonly now: Date;
  }): Promise<SubmissionPage & { readonly reporting: EivReportingPosture }> {
    /*
     * The posture rides with the queue (P121-01).
     *
     * Both inputs have been in the API's configuration since the worker
     * existed, and reached a screen only inside an EIV-Abgleich result — a
     * check somebody has to know to run, on a course that already has a VNR.
     * So the one question this screen exists to answer, *will these actually be
     * filed?*, was the one thing it could not say.
     *
     * `willFile` is computed here rather than left to the client to assemble
     * from the other two. A screen that ANDs them itself is a second opinion
     * about what the worker does, and the two would eventually disagree —
     * §4 invariant 6, in the place where disagreeing means somebody believes
     * nothing is being reported while it is.
     */
    const page = await this.repository.listSubmissions(query);
    return { ...page, reporting: this.reportingPosture() };
  }

  /** Whether this installation will send anything to an Ärztekammer. */
  private reportingPosture(): EivReportingPosture {
    const tier = eivEndpointTier(this.options.baseUrl);
    return {
      submissionsEnabled: this.options.submissionsEnabled,
      tier,
      // `unknown` files nothing, and is deliberately not treated as safe
      // elsewhere: an unparseable base URL lands there, and the worker refuses
      // it rather than guessing. Both halves must hold for anything to leave.
      willFile: this.options.submissionsEnabled && (tier === "live" || tier === "test"),
    };
  }

  /** `describeEvent`, or a refusal naming the capability rather than a crash. */
  private async describeVia(query: AuthorityQuery): Promise<AccreditedEvent> {
    if (this.submitter.describeEvent === undefined) {
      throw new EivError("unknown", "reporter cannot describe an event");
    }
    return this.submitter.describeEvent(query);
  }

  private async listVia(
    query: AuthorityQuery,
  ): Promise<readonly ReportedParticipation[]> {
    if (this.submitter.listReported === undefined) {
      throw new EivError("unknown", "reporter cannot list reported participations");
    }
    return this.submitter.listReported(query);
  }

  /**
   * The VNR, and whichever password this check is proving.
   *
   * Separate from `requireAccredited` because a supplied password makes the
   * stored one irrelevant — refusing "no password stored" while the operator is
   * typing one into the box is exactly the refusal §9.2 is about.
   */
  private async requireAccreditedVnr(
    slug: string,
    supplied: string | undefined,
  ): Promise<{ readonly vnr: string; readonly vnrPassword: string }> {
    if (supplied === undefined) return this.requireAccredited(slug);

    const course = await this.repository.accreditationForCourse(slug);
    if (course === undefined) throw new AppError("not_found", "no such course");
    if (course.vnr === null || course.vnr === "") {
      throw new AppError(
        "conflict",
        "course has no vnr",
        "Für diese Fortbildung ist keine VNR hinterlegt.",
      );
    }

    return { vnr: course.vnr, vnrPassword: supplied };
  }

  /**
   * Compare our record with the authority's.
   *
   * The two directions are not equally serious and the response counts them
   * separately:
   *
   * - **only here** — we recorded an accepted submission the authority does not
   *   hold. A physician believes they have points that were never credited.
   * - **only there** — the authority holds a participation we have no accepted
   *   record of. Usually a request that landed after we gave up retrying; the
   *   points exist, and our record is wrong.
   */
  async reconcile(slug: string): Promise<Reconciliation> {
    const course = await this.requireAccredited(slug);

    if (this.submitter.listReported === undefined) {
      throw new AppError(
        "conflict",
        "reporter cannot list reported participations",
        "Diese Schnittstelle kann keine gemeldeten Punkte auflisten.",
      );
    }

    const theirs = await this.callAuthority(() =>
      this.submitter.listReported!({
        vnr: course.vnr,
        endpoint: this.options.baseUrl,
        credentials: { [EIV_PASSWORD_KEY]: course.vnrPassword },
      }),
    );

    const ours = await this.repository.recordedForCourse(slug);
    return reconcile(ours, theirs);
  }

  /**
   * Put an abandoned submission back in the queue.
   *
   * Refused once the correction window has closed, because no electronic
   * submission for that VNR is possible after it — offering a button that
   * cannot work would send an operator away believing the problem was handled.
   */
  async requeue(
    enrolmentId: string,
    actor: EivOperatorContext,
    now: Date,
  ): Promise<void> {
    const row = await this.repository.loadForAction(enrolmentId);
    if (row === undefined)
      throw new AppError("not_found", "no eiv submission for enrolment");

    const deadlines = eivDeadlines({
      eventEndAt: row.eventEndAt,
      now,
      ...(row.firstSubmittedAt === null
        ? {}
        : { firstSubmittedAt: row.firstSubmittedAt }),
    });

    if (!deadlines.canSubmit && !deadlines.canCorrect) {
      throw new AppError(
        "conflict",
        "reporting window closed",
        "Die Meldefrist für diese Teilnahme ist abgelaufen. Eine Nachmeldung ist nur noch schriftlich bei der Ärztekammer möglich.",
      );
    }

    /*
     * The EFN the row will actually send (P118).
     *
     * `efn_profiles` and `eiv_submissions.efn` are two copies of one value, and
     * before this the requeue took neither decision — it simply kept the older
     * one. So a physician correcting a typo got a re-issued certificate with the
     * new EFN and a Punktemeldung with the old, and both reported success. The
     * certificate repository's own comment names that as the thing that must not
     * happen; it was happening with the halves swapped.
     */
    const efn = efnRefresh({
      onSubmission: row.efn,
      onProfile: row.profileEfn,
      stage: submissionStage(row.status),
    });

    if (efn.kind === "refused") {
      /*
       * S30, and a refusal rather than a guess (§7). Correcting a *name*
       * changes how a physician is described; correcting an EFN changes which
       * physician was credited, and nothing here can take the points back from
       * the first one. Whether the answer is withdraw-then-refile or a
       * correction inside the 7-day window is the Kammer's to give.
       *
       * The message names neither EFN. An operator is not entitled to the
       * physician's identifier (ADR-0004) and an error string reaches a log
       * (§9.5) — it names the field and the next step, which is what they can
       * act on.
       */
      throw new AppError(
        "conflict",
        `refused: efn changed on an accepted submission enrolment=${row.enrolmentId}`,
        "Die EFN wurde geändert, nachdem diese Teilnahme bereits gemeldet wurde. " +
          "Eine erneute Meldung unter der neuen EFN würde die Punkte einer zweiten " +
          "Person gutschreiben. Bitte stornieren Sie zuerst die bestehende " +
          "Punktemeldung oder wenden Sie sich an die Ärztekammer.",
      );
    }

    await this.repository.requeue(
      row.submissionId,
      now,
      ...(efn.kind === "refresh" ? ([efn.efn] as const) : ([] as const)),
    );

    await this.audit.recordForCustomer(actor.customerId, {
      actor: { identity: "staff", id: actor.staffUserId },
      action: "eiv.requeued",
      subject: row.enrolmentId,
      // No EFN, no VNR password. The status it came from is the useful fact:
      // requeuing a `failed_permanent` row is a different act from nudging a
      // retryable one.
      //
      // `efnRefreshed` is a boolean for the same reason (§9.5): that the
      // identifier moved is the auditable fact, and what it moved to is the
      // physician's, not the log's.
      detail: { from: row.status, efnRefreshed: efn.kind === "refresh" },
    });
  }

  /**
   * Correct the EFN a queued Punktemeldung will send (P179-03).
   *
   * ## What the client asked for, and what this is
   *
   *   > i need to be able to change efn if it is incorrect from the user side
   *   > or from panel side
   *
   * The user side is `PUT /profile/efn`, which writes the physician's profile
   * and now carries the correction onto their un-sent Meldungen by the same
   * rule this uses. This is the panel side, and it is deliberately **not** a
   * write to `efn_profiles`:
   *
   * - `efn_profiles` is the physician's identifier at their Ärztekammer, and
   *   its RLS `WITH CHECK` admits only `user_id = app.user_id`. The subject and
   *   nobody else may write it. That is a guarantee rather than an oversight —
   *   a platform on which a customer's administrator can assert a doctor's
   *   national identifier is one that can credit points to anybody — and
   *   changing it is a decision for the client and an amendment to ADR-0004,
   *   not something to absorb while fixing a support flow (§7, CLAUDE.md §3).
   * - `eiv_submissions.efn` is **our own outbound report**. A typo in it is
   *   this organisation's report being wrong, and correcting a report before
   *   it is filed is exactly the operator's job.
   *
   * So this stops a wrong number reaching the Kammer without letting anybody
   * rewrite whose number it is. The physician's profile still says what the
   * physician said; the certificate still reads the profile live.
   *
   * ## What it does not do
   *
   * It does not send. `requeue` is the control that says "try again", with the
   * deadline check that belongs to sending. Folding them together would mean a
   * `failed_permanent` row silently re-entering the queue because somebody
   * fixed a digit.
   */
  async correctEfn(
    enrolmentId: string,
    proposed: string,
    actor: EivOperatorContext,
  ): Promise<void> {
    const row = await this.repository.loadForAction(enrolmentId);
    if (row === undefined) {
      throw new AppError("not_found", "no eiv submission for enrolment");
    }

    const verdict = efnCorrection({
      proposed,
      current: row.efn,
      stage: submissionStage(row.status),
    });

    if (!verdict.ok) {
      /*
       * Three refusals, three sentences, and none of them names an EFN — not
       * the old one, not the proposed one. An operator is not entitled to the
       * physician's identifier (ADR-0004) and an error string reaches a log
       * (§9.5).
       */
      if (verdict.reason === "malformed") {
        throw new AppError(
          "validation",
          `rejected EFN for enrolment=${enrolmentId}: failed domain validation`,
          "Die EFN muss aus genau 15 Ziffern bestehen.",
        );
      }
      if (verdict.reason === "unchanged") {
        throw new AppError(
          "conflict",
          `refused: efn unchanged on enrolment=${enrolmentId}`,
          "Diese Punktemeldung trägt bereits genau diese EFN. Es wurde nichts geändert.",
        );
      }
      throw new AppError(
        "conflict",
        `refused: efn correction on an accepted submission enrolment=${enrolmentId}`,
        "Diese Teilnahme wurde bereits an die Ärztekammer gemeldet. Eine Meldung " +
          "unter einer anderen EFN würde die Punkte einer zweiten Person " +
          "gutschreiben. Bitte widerrufen Sie zuerst die bestehende Punktemeldung " +
          "oder wenden Sie sich an die Ärztekammer.",
      );
    }

    await this.repository.correctEfn(row.submissionId, verdict.efn);

    await this.audit.recordForCustomer(actor.customerId, {
      actor: { identity: "staff", id: actor.staffUserId },
      action: "eiv.efn_corrected",
      subject: row.enrolmentId,
      // The status it was corrected in, never either number (§9.5).
      detail: { from: row.status },
    });
  }

  /**
   * Withdraw a Punktemeldung at the authority.
   *
   * Inline rather than queued, and that is deliberate: a withdrawal is a
   * decision a named human took at a moment they are accountable for, and the
   * correction window may be hours from closing. Queuing it would put a
   * scheduler between the decision and the effect.
   */
  async withdraw(
    enrolmentId: string,
    reason: string,
    actor: EivOperatorContext,
    now: Date,
  ): Promise<void> {
    const row = await this.repository.loadForAction(enrolmentId);
    if (row === undefined)
      throw new AppError("not_found", "no eiv submission for enrolment");

    if (!ACCEPTED_STATUSES.has(row.status)) {
      throw new AppError(
        "conflict",
        "nothing submitted to withdraw",
        "Für diese Teilnahme wurde noch nichts gemeldet.",
      );
    }

    if (row.vnrPassword === null || row.vnrPassword === "") {
      throw new AppError(
        "conflict",
        "course has no vnr password",
        "Für diese Fortbildung ist kein VNR-Passwort hinterlegt.",
      );
    }

    const deadlines = eivDeadlines({
      eventEndAt: row.eventEndAt,
      now,
      ...(row.firstSubmittedAt === null
        ? {}
        : { firstSubmittedAt: row.firstSubmittedAt }),
    });

    if (!deadlines.canCorrect) {
      throw new AppError(
        "conflict",
        "correction window closed",
        "Die siebentägige Korrekturfrist ist abgelaufen. Der EIV nimmt keinen Widerruf mehr an.",
      );
    }

    if (this.submitter.withdraw === undefined) {
      throw new AppError(
        "conflict",
        "reporter cannot withdraw",
        "Diese Schnittstelle kann keine Meldung zurückziehen.",
      );
    }

    const outcome = await this.callAuthority(() =>
      this.submitter.withdraw!({
        efn: row.efn,
        vnr: row.vnr,
        completedAt: row.eventEndAt,
        endpoint: this.options.baseUrl,
        credentials: { [EIV_PASSWORD_KEY]: row.vnrPassword! },
      }),
    );

    if (!outcome.accepted) {
      throw new AppError(
        "upstream_unavailable",
        "eiv did not accept the withdrawal",
        "Der EIV hat den Widerruf nicht angenommen.",
      );
    }

    await this.repository.markWithdrawn(row.submissionId, now);

    await this.audit.recordForCustomer(actor.customerId, {
      actor: { identity: "staff", id: actor.staffUserId },
      action: "eiv.withdrawn",
      subject: row.enrolmentId,
      // The reason is about the process, never the person — the same rule the
      // erasure path follows.
      detail: { reason },
    });
  }

  /** A course that can be asked about at all. */
  private async requireAccredited(
    slug: string,
  ): Promise<{ readonly vnr: string; readonly vnrPassword: string }> {
    const course = await this.repository.accreditationForCourse(slug);
    if (course === undefined) throw new AppError("not_found", "no such course");

    if (course.vnr === null || course.vnr === "") {
      throw new AppError(
        "conflict",
        "course has no vnr",
        "Für diese Fortbildung ist keine VNR hinterlegt.",
      );
    }

    if (course.vnrPassword === null || course.vnrPassword === "") {
      throw new AppError(
        "conflict",
        "course has no vnr password",
        "Für diese Fortbildung ist kein VNR-Passwort hinterlegt.",
      );
    }

    return { vnr: course.vnr, vnrPassword: course.vnrPassword };
  }

  /**
   * Turn a failure of somebody else's interface into a 502.
   *
   * Not a 500: nothing here is broken, and the operator's next step is
   * different — check the VNR, wait, call EIV support. The message carries the
   * authority's own words and the failure kind, and `EivError` never puts a
   * credential in either (the password travels in a header, and the recorded
   * request body is redacted).
   */
  private async callAuthority<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof EivError) {
        throw new AppError(
          "upstream_unavailable",
          `eiv ${error.kind}: ${error.message}`,
          `Der EIV hat die Anfrage nicht beantwortet (${error.kind}).`,
        );
      }
      throw error;
    }
  }
}

/**
 * The comparison itself — pure, so the interesting cases are unit-testable
 * without a database or an authority.
 *
 * Matched on the EFN because that is what both sides key on. Ours is the full
 * value and theirs may be too; only the masked form leaves this function.
 */
export function reconcile(
  ours: readonly { readonly efn: string; readonly status: string }[],
  theirs: readonly ReportedParticipation[],
): Reconciliation {
  const accepted = new Set(
    ours.filter((row) => ACCEPTED_STATUSES.has(row.status)).map((row) => row.efn),
  );
  const byEfn = new Map<string, ReportedParticipation>();
  for (const row of theirs) {
    if (row.efn !== undefined) byEfn.set(row.efn, row);
  }

  const efns = new Set<string>([...accepted, ...byEfn.keys()]);

  const rows = [...efns].sort().map((efn) => {
    const there = byEfn.get(efn);
    return {
      efnMasked: mask(efn),
      here: accepted.has(efn),
      /*
       * A withdrawn participation is still *held* — EIV keeps the record with
       * the points zeroed. Counting it as absent would report a disagreement
       * every time somebody used the withdrawal we just built.
       */
      there: there !== undefined,
      participatedOn: there?.participatedOn ?? null,
      attendance: there?.attendance ?? null,
      assessment: there?.assessment ?? null,
    };
  });

  return {
    rows,
    onlyHere: rows.filter((row) => row.here && !row.there).length,
    onlyThere: rows.filter((row) => !row.here && row.there).length,
  };
}

/** Last four digits. Enough to reconcile a row, not enough to be a disclosure. */
function mask(efn: string): string {
  return efn.length <= 4 ? efn : `${"*".repeat(efn.length - 4)}${efn.slice(-4)}`;
}
