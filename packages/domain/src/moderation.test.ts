/**
 * Moderation rules (P12-05).
 *
 * The cases below are the ones with a compliance answer behind them: which
 * submission stages still allow a name to be corrected, when an erasure has to
 * wait, and how much of an EFN is ever shown.
 */

import { describe, expect, it } from "vitest";
import {
  certificateAction,
  efnRefresh,
  efnCorrection,
  maskEfn,
  nameCorrection,
  subjectErasure,
  submissionStage,
  type SubmissionStage,
} from "./moderation.js";

describe("nameCorrection", () => {
  const correcting = (stage: SubmissionStage, proposed = "Dr. Anna Schmidt") =>
    nameCorrection({ proposed, stage });

  it("allows a correction before anything is queued", () => {
    expect(correcting("none")).toEqual({ ok: true });
  });

  it("allows a correction while a submission is still queued", () => {
    // The worker reads the name at send time, so correcting now makes the
    // Meldung more accurate rather than contradicting one. Refusing here would
    // make the moment somebody notices a typo the one moment they cannot fix
    // it.
    expect(correcting("pending")).toEqual({ ok: true });
  });

  it("allows a correction after a submission was abandoned", () => {
    // Nothing was reported, so there is nothing for the record to disagree
    // with.
    expect(correcting("abandoned")).toEqual({ ok: true });
  });

  it("refuses a correction once the Punktemeldung was accepted", () => {
    // The name is on the Ärztekammer's record now. Editing ours would make the
    // certificate and the Meldung say different things, silently, until an
    // audit found it.
    expect(correcting("submitted")).toEqual({
      ok: false,
      reason: "already_submitted",
    });
  });

  it("refuses a blank name at every stage", () => {
    for (const stage of ["none", "pending", "abandoned"] as const) {
      expect(correcting(stage, "   ")).toEqual({ ok: false, reason: "blank" });
    }
  });

  it("reports blankness before submission state, because it is the fixable one", () => {
    expect(correcting("submitted", "")).toEqual({ ok: false, reason: "blank" });
  });
});

describe("subjectErasure", () => {
  it("allows erasure when nothing is owed", () => {
    expect(subjectErasure({ pendingSubmissions: 0 })).toEqual({ ok: true });
  });

  it("waits while a Punktemeldung is queued", () => {
    // Not a denial of the right — an ordering constraint. Erasing mid-flight
    // would either report a pseudonymised name or drop a report the physician
    // is entitled to.
    expect(subjectErasure({ pendingSubmissions: 1 })).toEqual({
      ok: false,
      reason: "submission_pending",
    });
  });
});

describe("maskEfn", () => {
  it("shows only the last four digits of a full EFN", () => {
    expect(maskEfn("801234567890123")).toBe("•••••••••••0123");
  });

  it("keeps the length recognisable, so a mismatch is visible", () => {
    expect(maskEfn("801234567890123")).toHaveLength(15);
  });

  it("passes null through, because absent is not the same as hidden", () => {
    expect(maskEfn(null)).toBeNull();
    expect(maskEfn(undefined)).toBeNull();
  });

  it("masks a short or malformed value entirely", () => {
    // Either corrupt or not an EFN. Showing four digits of it would disclose
    // half of something that should not be there in the first place.
    expect(maskEfn("1234567")).toBe("•••••••");
    expect(maskEfn("12")).toBe("••••");
  });

  it("never returns any input digit beyond the last four", () => {
    const efn = "801234567890123";
    const masked = maskEfn(efn) ?? "";
    expect(masked.slice(0, -4)).not.toMatch(/\d/);
  });

  it("ignores surrounding whitespace rather than masking it", () => {
    expect(maskEfn("  801234567890123  ")).toBe("•••••••••••0123");
  });
});

describe("certificateAction", () => {
  it("allows every action on an issued certificate", () => {
    for (const action of ["regenerate", "resend", "revoke"] as const) {
      expect(certificateAction({ action, status: "issued" })).toEqual({ ok: true });
    }
  });

  it("allows regenerating a pending certificate, which is how a stuck render is retried", () => {
    expect(certificateAction({ action: "regenerate", status: "pending" })).toEqual({
      ok: true,
    });
  });

  it("refuses resending or revoking something never rendered", () => {
    expect(certificateAction({ action: "resend", status: "pending" })).toEqual({
      ok: false,
      reason: "not_issued",
    });
    expect(certificateAction({ action: "revoke", status: "pending" })).toEqual({
      ok: false,
      reason: "not_issued",
    });
  });

  it("refuses everything on a revoked certificate", () => {
    // Reissuing a withdrawn document under the same id would put two
    // contradictory PDFs in circulation.
    for (const action of ["regenerate", "resend", "revoke"] as const) {
      expect(certificateAction({ action, status: "revoked" })).toEqual({
        ok: false,
        reason: "revoked",
      });
    }
  });

  it("allows resending a bounced certificate, which is the whole point of bounced", () => {
    // The document exists and is valid; only the email failed.
    expect(certificateAction({ action: "resend", status: "bounced" })).toEqual({
      ok: true,
    });
  });

  it("allows regenerating a delivered certificate", () => {
    // Delivery is not finality: a wrong name on a document already emailed is
    // exactly when a corrected one is needed.
    expect(certificateAction({ action: "regenerate", status: "delivered" })).toEqual({
      ok: true,
    });
  });
});

/**
 * P118. The requeue path used to send the EFN frozen at completion while the
 * certificate read the profile live, so an EFN correction produced two
 * documents naming different physicians and reported success for both.
 */
describe("efnRefresh", () => {
  const OLD = "123456789012345";
  const NEW = "987654321098765";

  const refreshing = (stage: SubmissionStage, onProfile: string | null = NEW) =>
    efnRefresh({ onSubmission: OLD, onProfile, stage });

  it("adopts the corrected EFN while nothing has been reported", () => {
    for (const stage of ["none", "pending", "abandoned"] as const) {
      expect(refreshing(stage)).toEqual({ kind: "refresh", efn: NEW });
    }
  });

  /*
   * The half that is S30. Correcting a *name* changes how one physician is
   * described; correcting an EFN changes which physician was credited, and the
   * points already on the first one's record cannot be taken back from here.
   */
  it("refuses once the old EFN reached the Ärztekammer", () => {
    expect(refreshing("submitted")).toEqual({
      kind: "refused",
      reason: "already_submitted",
    });
    expect(refreshing("withdrawn")).toEqual({
      kind: "refused",
      reason: "already_submitted",
    });
  });

  it("does not refuse a submitted row whose EFN is unchanged", () => {
    // A requeue after an accepted filing is a legitimate correction of
    // something else. Refusing it because of an EFN that did not move would be
    // §9.2 in reverse — a refusal with no defect behind it.
    expect(efnRefresh({ onSubmission: OLD, onProfile: OLD, stage: "submitted" })).toEqual(
      { kind: "unchanged" },
    );
  });

  it("ignores surrounding whitespace on both sides", () => {
    expect(
      efnRefresh({ onSubmission: ` ${OLD} `, onProfile: `\n${OLD}`, stage: "pending" }),
    ).toEqual({ kind: "unchanged" });
  });

  /*
   * GDPR erasure deletes `efn_profiles` and leaves a submission that is still
   * owed. There is nothing newer to adopt, and treating absence as a change
   * would file a blank EFN against a real Veranstaltung.
   */
  it("keeps the submission's own EFN when there is no profile", () => {
    for (const absent of [null, undefined, "", "   "]) {
      expect(
        efnRefresh({ onSubmission: OLD, onProfile: absent, stage: "pending" }),
      ).toEqual({ kind: "unchanged" });
    }
  });
});

/**
 * The SQL twin is `STAGE_SQL` in `moderation.repository.ts`. Enumerated rather
 * than sampled: a value added to `eiv_status` and not to both falls through to
 * `pending` here and would be a wrong compliance answer, not a type error.
 */
describe("submissionStage", () => {
  it("maps every member of the eiv_status enum", () => {
    expect(submissionStage(null)).toBe("none");
    expect(submissionStage(undefined)).toBe("none");
    expect(submissionStage("queued")).toBe("pending");
    expect(submissionStage("held")).toBe("pending");
    expect(submissionStage("failed_retryable")).toBe("pending");
    expect(submissionStage("failed_permanent")).toBe("abandoned");
    expect(submissionStage("window_closed")).toBe("abandoned");
    expect(submissionStage("submitted")).toBe("submitted");
    expect(submissionStage("withdrawn")).toBe("withdrawn");
  });

  it("agrees with nameCorrection about what is still correctable", () => {
    // The property both rules turn on, asserted once rather than assumed twice.
    for (const status of [
      "queued",
      "held",
      "failed_retryable",
      "failed_permanent",
      "window_closed",
    ]) {
      expect(
        nameCorrection({ proposed: "Dr. A", stage: submissionStage(status) }).ok,
      ).toBe(true);
    }
    for (const status of ["submitted", "withdrawn"]) {
      expect(
        nameCorrection({ proposed: "Dr. A", stage: submissionStage(status) }).ok,
      ).toBe(false);
    }
  });
});

describe("efnCorrection", () => {
  const CURRENT = "802760699000001";
  const PROPOSED = "802760699000002";

  it("accepts a correction while nothing has been reported", () => {
    for (const stage of ["none", "pending", "abandoned"] as const) {
      expect(
        efnCorrection({ proposed: PROPOSED, current: CURRENT, stage }),
        `stage=${stage}`,
      ).toEqual({ ok: true, efn: PROPOSED });
    }
  });

  it("refuses once the Punktemeldung has been accepted", () => {
    /*
     * The rule S30 leaves open and `efnRefresh` already applies: correcting a
     * name changes how one physician is described, correcting an EFN changes
     * *which* physician was credited. The points are on somebody's record and
     * re-filing under a new number credits a second person rather than moving
     * the first.
     */
    for (const stage of ["submitted", "withdrawn"] as const) {
      expect(
        efnCorrection({ proposed: PROPOSED, current: CURRENT, stage }),
        `stage=${stage}`,
      ).toEqual({ ok: false, reason: "already_submitted" });
    }
  });

  it("names a malformed value as malformed, at every stage", () => {
    // Before the stage check on purpose: an operator told "already reported"
    // about a value that is not an EFN would go and ask the Ärztekammer about
    // a typo they could have fixed by looking at the field.
    for (const stage of ["none", "pending", "submitted", "withdrawn"] as const) {
      expect(
        efnCorrection({ proposed: "12345", current: CURRENT, stage }),
        `stage=${stage}`,
      ).toEqual({ ok: false, reason: "malformed" });
    }
  });

  it("refuses fourteen and sixteen digits, and anything not a digit", () => {
    for (const bad of [
      "80276069900000",
      "8027606990000012",
      "80276069900000a",
      " 80276069900000",
      "",
    ]) {
      expect(
        efnCorrection({ proposed: bad, current: CURRENT, stage: "pending" }),
        bad,
      ).toEqual({ ok: false, reason: "malformed" });
    }
  });

  it("accepts a value padded with spaces, because a pasted EFN carries them", () => {
    expect(
      efnCorrection({ proposed: `  ${PROPOSED} `, current: CURRENT, stage: "pending" }),
    ).toEqual({ ok: true, efn: PROPOSED });
  });

  it("reports retyping the same number as unchanged, not as a correction", () => {
    // A false correction is worse than a refused one: it produces an audit row
    // saying the identifier moved, and an operator who believes the problem is
    // solved.
    expect(
      efnCorrection({ proposed: CURRENT, current: CURRENT, stage: "pending" }),
    ).toEqual({ ok: false, reason: "unchanged" });
    expect(
      efnCorrection({ proposed: ` ${CURRENT}`, current: `${CURRENT} `, stage: "none" }),
    ).toEqual({ ok: false, reason: "unchanged" });
  });

  it("prefers unchanged over already_submitted, so a no-op is never a scare", () => {
    expect(
      efnCorrection({ proposed: CURRENT, current: CURRENT, stage: "submitted" }),
    ).toEqual({ ok: false, reason: "unchanged" });
  });
});
