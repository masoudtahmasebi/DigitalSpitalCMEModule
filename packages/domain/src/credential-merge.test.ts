/**
 * The credential-merge rule (P21-05).
 *
 * Exhaustive rather than illustrative: this decides whether a physician's
 * participation records may be moved onto another person, and it cannot be
 * undone. Every refusal gets a test, and so does the symmetry — an operator who
 * reverses the arguments must not get a different answer, because that would
 * make the refusal an obstacle to work around rather than a question to answer.
 */

import { describe, expect, it } from "vitest";
import { planCredentialMerge, type MergeSide } from "./credential-merge.js";

const side = (overrides: Partial<MergeSide> = {}): MergeSide => ({
  personId: "person-a",
  efnFingerprint: null,
  enrolledCourseSlugs: [],
  ...overrides,
});

describe("a merge that is safe", () => {
  it("is allowed when the two people share nothing", () => {
    const plan = planCredentialMerge(
      side({ personId: "a", enrolledCourseSlugs: ["adhs-akademie-adult"] }),
      side({ personId: "b", enrolledCourseSlugs: ["ds-cme-demo"] }),
    );

    expect(plan).toEqual({ allowed: true });
  });

  it("is allowed when only one side has an EFN", () => {
    // The common case, and the one this feature exists for: a physician who
    // learns with MEDICE under their Keycloak identity is given a DS portal
    // login, which has reported nothing yet.
    expect(
      planCredentialMerge(
        side({ personId: "a", efnFingerprint: null }),
        side({ personId: "b", efnFingerprint: "sha256:abc" }),
      ),
    ).toEqual({ allowed: true });
  });

  it("is allowed when both sides carry the same EFN", () => {
    // Same physician, two logins, one number. Nothing to choose between.
    expect(
      planCredentialMerge(
        side({ personId: "a", efnFingerprint: "sha256:abc" }),
        side({ personId: "b", efnFingerprint: "sha256:abc" }),
      ),
    ).toEqual({ allowed: true });
  });
});

describe("a merge that has to choose something", () => {
  it("refuses two different EFNs", () => {
    // Both sides are already reporting to an Ärztekammer under a different
    // number. Picking one silently re-attributes the other's points.
    expect(
      planCredentialMerge(
        side({ personId: "a", efnFingerprint: "sha256:abc" }),
        side({ personId: "b", efnFingerprint: "sha256:def" }),
      ),
    ).toEqual({ allowed: false, refusal: { reason: "conflicting_efn" } });
  });

  it("refuses an overlap, and names every course in the way", () => {
    // "Cannot merge" tells an operator nothing they can act on.
    const plan = planCredentialMerge(
      side({ personId: "a", enrolledCourseSlugs: ["b-kurs", "a-kurs", "nur-a"] }),
      side({ personId: "b", enrolledCourseSlugs: ["a-kurs", "b-kurs"] }),
    );

    expect(plan).toEqual({
      allowed: false,
      refusal: { reason: "overlapping_courses", courseSlugs: ["a-kurs", "b-kurs"] },
    });
  });

  it("names each overlapping course once, however often it is listed", () => {
    const plan = planCredentialMerge(
      side({ personId: "a", enrolledCourseSlugs: ["a-kurs", "a-kurs"] }),
      side({ personId: "b", enrolledCourseSlugs: ["a-kurs"] }),
    );

    expect(plan).toEqual({
      allowed: false,
      refusal: { reason: "overlapping_courses", courseSlugs: ["a-kurs"] },
    });
  });

  it("refuses a person merged into themselves", () => {
    expect(planCredentialMerge(side({ personId: "a" }), side({ personId: "a" }))).toEqual(
      { allowed: false, refusal: { reason: "same_person" } },
    );
  });

  it("puts the EFN conflict ahead of the course overlap", () => {
    // Both are true here, and the EFN is the one that cannot be resolved by
    // unenrolling anybody. Reporting the recoverable obstacle first would send
    // an operator to undo enrolments and then refuse them anyway.
    const plan = planCredentialMerge(
      side({ personId: "a", efnFingerprint: "sha256:abc", enrolledCourseSlugs: ["k"] }),
      side({ personId: "b", efnFingerprint: "sha256:def", enrolledCourseSlugs: ["k"] }),
    );

    expect(plan).toEqual({ allowed: false, refusal: { reason: "conflicting_efn" } });
  });
});

describe("the verdict is symmetric", () => {
  it("does not change when the operator reverses the two people", () => {
    // An operator who swaps the arguments to get past a refusal has resolved
    // nothing, and a rule that let them would be worse than no rule.
    const a = side({
      personId: "a",
      efnFingerprint: "sha256:abc",
      enrolledCourseSlugs: ["k1"],
    });
    const b = side({
      personId: "b",
      efnFingerprint: "sha256:def",
      enrolledCourseSlugs: ["k1"],
    });

    expect(planCredentialMerge(a, b)).toEqual(planCredentialMerge(b, a));
  });

  it("is symmetric on an overlap too, down to the named courses", () => {
    const a = side({ personId: "a", enrolledCourseSlugs: ["k2", "k1"] });
    const b = side({ personId: "b", enrolledCourseSlugs: ["k1", "k2", "k3"] });

    expect(planCredentialMerge(a, b)).toEqual(planCredentialMerge(b, a));
  });
});
