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

import { eivDeadlines } from "@ds/domain";
import { EivError, EIV_PASSWORD_KEY } from "@ds/eiv-client";
import type { AccreditedEvent, ReportedParticipation } from "@ds/plugin-api";
import type { AuditServicePort } from "../../audit/audit.service.js";
import { AppError } from "../../shared/problem-details.js";
import type { EivSubmitterPort } from "./eiv.service.js";
import type { EivAdminRepositoryPort } from "./eiv-admin.repository.js";

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

/** Statuses meaning "we believe the Ärztekammer has this". */
const ACCEPTED_STATUSES = new Set(["submitted"]);

export class EivAdminService {
  constructor(
    private readonly repository: EivAdminRepositoryPort,
    private readonly submitter: EivSubmitterPort,
    private readonly audit: AuditServicePort,
    private readonly options: { readonly baseUrl: string },
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

    await this.repository.requeue(row.submissionId, now);

    await this.audit.recordForCustomer(actor.customerId, {
      actor: { identity: "staff", id: actor.staffUserId },
      action: "eiv.requeued",
      subject: row.enrolmentId,
      // No EFN, no VNR password. The status it came from is the useful fact:
      // requeuing a `failed_permanent` row is a different act from nudging a
      // retryable one.
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
