/**
 * What an operator may do to a learner's record (P12-05).
 *
 * These are the operations where the admin console stops being a content tool
 * and starts touching a physician's CME record. Each of them is a decision with
 * a compliance answer, so each of them is here rather than in a service:
 *
 * | Operation | The question |
 * | --- | --- |
 * | Correcting a name | Has it already been reported to the Ärztekammer? |
 * | Erasing a subject | Is there a submission still owed? |
 * | Regenerating a certificate | Does this re-report anything? |
 * | Showing an EFN | How much of it may an operator see? |
 *
 * ## The one that matters most
 *
 * `nameCorrection`. A physician's name reaches the Ärztekammer inside a
 * Punktemeldung, and once it has, the name on our record and the name on
 * theirs are two different things. Editing ours afterwards makes them disagree
 * silently — the certificate would say one thing and the Meldung another, and
 * nobody would find out until an audit.
 *
 * Before submission, correcting a typo is exactly right and is what S4 asked
 * for. After it, the honest answer is a refusal and a correction sent to the
 * Ärztekammer by hand within their seven-day window.
 */

/** How far a Punktemeldung has got. */
export type SubmissionStage =
  /** Nothing queued. Nothing has been told to anyone. */
  | "none"
  /** Queued or retrying. Not yet accepted, and still cancellable. */
  | "pending"
  /** Accepted by EIV-FOBI. The name is now on somebody else's record. */
  | "submitted"
  /** Permanently failed. Nothing was reported, so nothing disagrees. */
  | "abandoned"
  /**
   * Reported, then withdrawn at the authority by an operator (P31-02).
   *
   * Distinct from `abandoned`, and the difference decides whether a name may
   * still be corrected: something *was* on the Ärztekammer's record. Treating
   * it as `none` would let a name be edited after the fact with no trace that
   * a different one had been reported.
   */
  | "withdrawn";

export type NameCorrectionVerdict =
  | { readonly ok: true }
  | {
      readonly ok: false;
      /** Reported already — the two records would disagree. */
      readonly reason: "already_submitted";
    }
  | { readonly ok: false; readonly reason: "blank" };

/**
 * Whether a learner's name on a CME record may still be corrected.
 *
 * `pending` is allowed on purpose. A queued submission has not been accepted by
 * anyone, and the worker reads the name at send time — so correcting it now
 * makes the Meldung *more* accurate rather than contradicting one. Refusing
 * here would mean the one moment somebody notices a typo, between completion
 * and the queue draining, is the one moment they cannot fix it.
 *
 * `abandoned` is allowed for the same reason from the other direction: nothing
 * was reported, so there is nothing for the record to disagree with.
 */
export function nameCorrection(input: {
  readonly proposed: string;
  readonly stage: SubmissionStage;
}): NameCorrectionVerdict {
  if (input.proposed.trim() === "") return { ok: false, reason: "blank" };
  /*
   * `withdrawn` refuses along with `submitted` (P31-02). The withdrawal zeroed
   * the points; it did not unsay the name. EIV keeps the record — "der Vorgang
   * bleibt nachvollziehbar" — so a name silently edited here would still
   * disagree with one the Kammer holds, which is the exact failure this rule
   * exists to prevent.
   */
  if (input.stage === "submitted" || input.stage === "withdrawn") {
    return { ok: false, reason: "already_submitted" };
  }
  return { ok: true };
}

export type ErasureVerdict =
  | { readonly ok: true }
  /**
   * A Punktemeldung is queued and has not been sent. Erasing now would either
   * report a pseudonymised name — which is a wrong record at the Ärztekammer —
   * or drop a report the physician is entitled to.
   */
  | { readonly ok: false; readonly reason: "submission_pending" };

/**
 * Whether a subject may be erased right now (GDPR Art. 17).
 *
 * Not *whether they have the right* — they do, and this never returns a
 * permanent refusal. It is about **ordering**: Art. 17(3)(b) permits retaining
 * data where processing is necessary for compliance with a legal obligation,
 * and an accepted Punktemeldung is exactly that. What this refuses is erasing
 * in the middle of one, which would leave the obligation half-discharged.
 *
 * `erase_subject` (migration 0009) enforces the same rule in the database and
 * raises if a submission is pending. This exists so the console can say why
 * before the operator clicks, and so the wording is a decision rather than a
 * database error string.
 */
export function subjectErasure(input: {
  readonly pendingSubmissions: number;
}): ErasureVerdict {
  return input.pendingSubmissions === 0
    ? { ok: true }
    : { ok: false, reason: "submission_pending" };
}

/**
 * How much of an EFN an operator may see.
 *
 * An EFN is the physician's lifelong identifier with their Ärztekammer, is the
 * key to their entire CME record, and is not needed by anybody here: an
 * operator confirming they are looking at the right person needs to recognise
 * it, not to read it. So the last four digits, which is enough to match against
 * a physician reading their own card and useless to anybody who does not
 * already have it.
 *
 * Fifteen digits (§ the EIV specification), so the mask is eleven dots. A short
 * or malformed value is masked entirely rather than partially: it is either
 * corrupt or not an EFN, and neither is something to display.
 */
export function maskEfn(efn: string | null | undefined): string | null {
  if (efn === undefined || efn === null) return null;

  const digits = efn.trim();
  if (digits.length < 8) return "•".repeat(Math.max(digits.length, 4));
  return "•".repeat(digits.length - 4) + digits.slice(-4);
}

export type CertificateAction = "regenerate" | "resend" | "revoke";

export type CertificateActionVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "revoked" }
  | { readonly ok: false; readonly reason: "not_issued" };

/**
 * Whether a certificate action is available in its current state.
 *
 * ## Regenerating never re-reports
 *
 * A certificate is a rendering of a completed enrolment. Regenerating it
 * re-renders from the same record — a corrected name, a fixed template — and
 * touches `eiv_submissions` not at all. That separation is structural rather
 * than a rule enforced here: the certificate pipeline and the submission
 * pipeline share no code path, so there is nothing for a regeneration to
 * trigger. This function's job is only to refuse actions on a certificate that
 * has been revoked, because reissuing a withdrawn document under the same id
 * would leave two contradictory PDFs in circulation.
 *
 * ## Revoking is not deleting
 *
 * A revoked certificate keeps its row and its enrolment. What was earned was
 * earned; revocation records that the *document* is withdrawn — a wrong name,
 * a wrong date — and the evidence behind the points stays exactly where it was.
 */
export type CertificateStatus =
  | "pending"
  | "issued"
  | "delivered"
  /** Delivery failed. The document exists and is valid; the email did not land. */
  | "bounced"
  | "revoked";

export function certificateAction(input: {
  readonly action: CertificateAction;
  readonly status: CertificateStatus;
}): CertificateActionVerdict {
  if (input.status === "revoked") return { ok: false, reason: "revoked" };

  // Nothing to resend or revoke until something was rendered. Regenerating a
  // pending certificate is fine and is in fact how a stuck render is retried.
  //
  // `bounced` is not in this set: the document exists and is valid, only the
  // email failed, and resending it is precisely the fix.
  if (input.action !== "regenerate" && input.status === "pending") {
    return { ok: false, reason: "not_issued" };
  }

  return { ok: true };
}
