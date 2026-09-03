import { describe, expect, it } from "vitest";
import {
  awardsCmePoints,
  describePublishBlockers,
  publishBlockers,
  type PublishCandidate,
} from "./publishing.js";
import { PLACEHOLDER_VNR } from "./eiv.js";

/** Everything a certificate and a Punktemeldung need, present. */
const complete: PublishCandidate = {
  status: "published",
  cmePoints: 4,
  vnr: "2761234202512345678",
  hasVnrPassword: true,
  cmeCategory: "D",
  accreditationBody: "Ärztekammer Westfalen-Lippe",
  organizer: "Medice Arzneimittel Pütter GmbH & Co. KG, Iserlohn",
  eventLocation: "online",
  scientificLeadName: "Prof. Dr. med. Muster",
  certificateIssuePlace: "Iserlohn",
  hasStampImage: true,
  hasSignatureImage: true,
};

describe("a complete, accredited course", () => {
  it("has nothing blocking it", () => {
    expect(publishBlockers(complete)).toEqual([]);
  });
});

describe("the trigger", () => {
  it("does not apply to a draft — that is what draft is for", () => {
    // Half-authored is the normal state of a course being written.
    const bare = {
      ...complete,
      status: "draft" as const,
      vnr: null,
      hasVnrPassword: false,
    };
    expect(publishBlockers(bare)).toEqual([]);
  });

  it("does not apply to a course awarding no points", () => {
    // `ds-ohne-punkte` is a real client requirement: no certificate, no
    // Meldung, so nothing to be incomplete for. Demanding a VNR of it would
    // refuse a course that is correct.
    const free = { ...complete, cmePoints: null, vnr: null, hasVnrPassword: false };
    expect(publishBlockers(free)).toEqual([]);
    expect(awardsCmePoints(free)).toBe(false);
  });

  it("does not apply at zero points either", () => {
    expect(publishBlockers({ ...complete, cmePoints: 0, vnr: null })).toEqual([]);
  });

  it("applies at one point", () => {
    expect(publishBlockers({ ...complete, cmePoints: 1, vnr: null })).toEqual(["vnr"]);
  });
});

describe("each field that would fail at the end", () => {
  it("names the missing VNR", () => {
    expect(publishBlockers({ ...complete, vnr: null })).toEqual(["vnr"]);
  });

  /*
   * P117-01. This course published, ran, and issued a Teilnahmebescheinigung
   * printing nineteen zeros where an Ärztekammer expects a Veranstaltungs-
   * nummer — because the seed's placeholder is neither null nor blank, and
   * `isBlank` was the only question anybody asked.
   */
  it("names the seed's placeholder, which is not blank and is not a VNR", () => {
    expect(publishBlockers({ ...complete, vnr: PLACEHOLDER_VNR })).toEqual(["vnr"]);
  });

  it("names it around whitespace too", () => {
    expect(publishBlockers({ ...complete, vnr: ` ${PLACEHOLDER_VNR} ` })).toEqual([
      "vnr",
    ]);
  });

  it("names the missing VNR password, which nothing else would notice", () => {
    // The one that produced `failed_permanent / missing_vnr_password` on the
    // QA database — a state visible only in a table nobody opens.
    expect(publishBlockers({ ...complete, hasVnrPassword: false })).toEqual([
      "vnrPassword",
    ]);
  });

  it("names each certificate field on its own", () => {
    const cases: Array<[Partial<PublishCandidate>, string]> = [
      [{ cmeCategory: null }, "cmeCategory"],
      [{ accreditationBody: null }, "accreditationBody"],
      [{ organizer: null }, "organizer"],
      [{ eventLocation: null }, "eventLocation"],
      [{ scientificLeadName: null }, "scientificLeadName"],
      [{ certificateIssuePlace: null }, "certificateIssuePlace"],
      [{ hasStampImage: false }, "stampImage"],
      [{ hasSignatureImage: false }, "signatureImage"],
    ];
    for (const [patch, expected] of cases) {
      expect(publishBlockers({ ...complete, ...patch })).toEqual([expected]);
    }
  });

  it("treats whitespace as absent", () => {
    // A field containing " " renders as an empty line on a legal document,
    // which is the failure the check exists to stop, not a value.
    expect(publishBlockers({ ...complete, organizer: "   " })).toEqual(["organizer"]);
  });

  it("reports every missing field, not the first", () => {
    // An author fixing them one refusal at a time is an author who gives up.
    const bare: PublishCandidate = {
      status: "published",
      cmePoints: 4,
      vnr: null,
      hasVnrPassword: false,
      cmeCategory: null,
      accreditationBody: null,
      organizer: null,
      eventLocation: null,
      scientificLeadName: null,
      certificateIssuePlace: null,
      hasStampImage: false,
      hasSignatureImage: false,
    };
    expect(publishBlockers(bare)).toHaveLength(10);
  });
});

describe("the sentence an author reads", () => {
  it("joins two with und", () => {
    expect(describePublishBlockers(["vnr", "vnrPassword"])).toBe("VNR und VNR-Passwort");
  });

  it("joins three with commas and a final und", () => {
    expect(describePublishBlockers(["vnr", "organizer", "stampImage"])).toBe(
      "VNR, Veranstalter und Stempel",
    );
  });

  it("is one name on its own, without punctuation", () => {
    expect(describePublishBlockers(["stampImage"])).toBe("Stempel");
  });

  it("has a label for every blocker the rule can produce", () => {
    // The property that stops a new blocker shipping as `undefined` in a
    // German sentence: every value the rule can return has a label.
    const bare: PublishCandidate = {
      status: "published",
      cmePoints: 4,
      vnr: null,
      hasVnrPassword: false,
      cmeCategory: null,
      accreditationBody: null,
      organizer: null,
      eventLocation: null,
      scientificLeadName: null,
      certificateIssuePlace: null,
      hasStampImage: false,
      hasSignatureImage: false,
    };
    const sentence = describePublishBlockers(publishBlockers(bare));
    expect(sentence).not.toContain("undefined");
    expect(sentence.split(/,| und /)).toHaveLength(10);
  });
});
