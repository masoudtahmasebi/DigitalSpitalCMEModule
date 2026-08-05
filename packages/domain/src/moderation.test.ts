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
  maskEfn,
  nameCorrection,
  subjectErasure,
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
