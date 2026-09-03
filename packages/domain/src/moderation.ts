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

/**
 * The `eiv_status` enum collapsed onto the four distinctions that matter.
 *
 * The SQL twin is `STAGE_SQL` in `moderation.repository.ts`, which answers the
 * same question inside a query where a function cannot reach. Two
 * implementations of one rule is exactly what §4 invariant 6 warns about, so
 * they are named on each other and `submissionStage.test.ts` enumerates every
 * member of the enum — a value added to the enum and not to both is a test
 * failure rather than a wrong answer in production.
 */
export function submissionStage(status: string | null | undefined): SubmissionStage {
  if (status === null || status === undefined) return "none";
  if (status === "submitted") return "submitted";
  if (status === "withdrawn") return "withdrawn";
  if (status === "failed_permanent" || status === "window_closed") return "abandoned";
  return "pending";
}

export type EfnRefreshVerdict =
  /** The submission already carries the EFN the profile holds. Nothing to do. */
  | { readonly kind: "unchanged" }
  /** Safe to adopt: nothing was ever reported under the old one. */
  | { readonly kind: "refresh"; readonly efn: string }
  /**
   * The old EFN reached the Ärztekammer. Re-filing under a new one does not
   * move the points; it credits a second person (S30).
   */
  | { readonly kind: "refused"; readonly reason: "already_submitted" };

/**
 * Whether a queued Punktemeldung should adopt the EFN the physician now holds
 * (P118).
 *
 * ## The defect this exists for
 *
 * `efn_profiles` and `eiv_submissions.efn` are two copies of one value. The
 * certificate reads the profile **live** — deliberately, and its own comment
 * says why: *"a correction to it means the earlier value was wrong …
 * snapshotting would keep the typo on the paper while the Punktemeldung went to
 * the corrected number."* The requeue path did the opposite, so the flow that
 * looks like a repair produced a certificate with the new EFN and a Meldung
 * with the old one, and reported success for both.
 *
 * ## Why this is not simply "always take the newest"
 *
 * Because an EFN is not a field describing the subject — it **is** the subject.
 * Correcting a name changes how one physician is described; correcting an EFN
 * changes *which physician* was credited. Once a Meldung has been accepted, the
 * points sit on somebody's record and nothing here can take them back, so a
 * silent re-file under a different number credits a second person and leaves the
 * first crediting in place.
 *
 * That is the same argument `nameCorrection` makes, on the same stages, and it
 * lands on the same answer: everything up to and including `abandoned` is
 * correctable because nothing was reported; `submitted` and `withdrawn` are not.
 *
 * Whether the right sequence there is withdraw-then-refile, or a correction
 * inside the 7-day window, or a written notice to the Kammer, is **S30** and is
 * not ours to decide (§7). Until it is answered this refuses and the operator is
 * told what to do instead — which is the correct behaviour for an unanswered
 * rule, where filing a guess is not.
 *
 * ## The null profile is not an error
 *
 * `onProfile` is null after a GDPR erasure, which deletes `efn_profiles` while
 * leaving a submission that is still owed. The submission keeps the EFN it was
 * created with; there is nothing newer to adopt, and treating absence as a
 * change would file a blank.
 */
export function efnRefresh(input: {
  /** What the queued submission will send today. */
  readonly onSubmission: string;
  /** What the physician's profile holds now, or null if there is no profile. */
  readonly onProfile: string | null | undefined;
  readonly stage: SubmissionStage;
}): EfnRefreshVerdict {
  const proposed = (input.onProfile ?? "").trim();
  if (proposed === "") return { kind: "unchanged" };
  if (proposed === input.onSubmission.trim()) return { kind: "unchanged" };

  if (input.stage === "submitted" || input.stage === "withdrawn") {
    return { kind: "refused", reason: "already_submitted" };
  }

  return { kind: "refresh", efn: proposed };
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

export type EfnCorrectionVerdict =
  | { readonly ok: true; readonly efn: string }
  | { readonly ok: false; readonly reason: "already_submitted" }
  | { readonly ok: false; readonly reason: "malformed" }
  | { readonly ok: false; readonly reason: "unchanged" };

/**
 * Whether an operator may correct the EFN on a Punktemeldung (P179-03).
 *
 * ## What this corrects, and what it deliberately does not
 *
 * `eiv_submissions.efn` — **our own outbound report**, not the physician's
 * profile. The distinction is the whole design and it is not a technicality:
 *
 * - `efn_profiles` is the physician's identifier at their Ärztekammer. Its RLS
 *   `WITH CHECK` admits only `user_id = app.user_id`, so the subject and
 *   nobody else may write it, and that is a deliberate guarantee: a platform
 *   on which a pharmaceutical company's administrator can assert a doctor's
 *   national identifier is a platform that can credit points to anyone.
 * - `eiv_submissions.efn` is what *we* are about to tell the Kammer. A typo
 *   there is our outgoing report being wrong, and correcting a report before
 *   it is filed is squarely the operator's job.
 *
 * So this stops a wrong number reaching the Kammer without letting anybody
 * rewrite whose number it is. The physician's own correction — which does
 * update the profile — goes through `PUT /profile/efn` and reaches every
 * un-sent Meldung by the same rule, `efnRefresh`.
 *
 * ## The stages, which are `nameCorrection`'s and `efnRefresh`'s
 *
 * `submitted` and `withdrawn` refuse. The points are on somebody's record and
 * nothing here takes them back, so re-filing under a different number credits a
 * second person rather than moving the first (S30). Everything up to and
 * including `abandoned` is correctable because nothing was reported.
 *
 * `unchanged` is its own answer rather than a silent success: an operator who
 * retypes the number they were already sending has not fixed anything, and
 * telling them so is the difference between a correction and a false one.
 */
export function efnCorrection(input: {
  readonly proposed: string;
  readonly current: string;
  readonly stage: SubmissionStage;
}): EfnCorrectionVerdict {
  const proposed = input.proposed.trim();
  // The same fifteen digits `eiv_submissions_efn_check` enforces. Checked
  // before the stage so a malformed value is named as malformed rather than
  // refused for a reason that would still leave it malformed.
  if (!/^[0-9]{15}$/u.test(proposed)) return { ok: false, reason: "malformed" };
  if (proposed === input.current.trim()) return { ok: false, reason: "unchanged" };

  if (input.stage === "submitted" || input.stage === "withdrawn") {
    return { ok: false, reason: "already_submitted" };
  }

  return { ok: true, efn: proposed };
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
