import { describe, expect, it } from "vitest";
import {
  buildCertificateData,
  creditSentence,
  missingCertificateFields,
  type CertificateInput,
} from "./certificate.js";

const medice: CertificateInput = {
  vnr: "2760552025919300018",
  courseTitle: "ADHS Akademie adult",
  completedAt: new Date("2026-08-15T14:35:00Z"),
  eventLocation: "online",
  organizer: "Medice Arzneimittel Pütter GmbH & Co. KG, Iserlohn",
  cmePoints: 4,
  cmeCategory: "D",
  accreditationBody: "Ärztekammer Westfalen-Lippe",
  participantName: "Dr. med. Anna Müller",
  scientificLeadName: "Prof. Dr. med. Wissenschaftliche Leitung",
};

describe("creditSentence", () => {
  it("matches the Bescheid wording verbatim for the MEDICE course", () => {
    // The ÄKWL asks this be reproduced exactly; a test pins it so no refactor
    // can quietly reword a legally mandated sentence.
    expect(creditSentence(4, "D", "Ärztekammer Westfalen-Lippe")).toBe(
      "Die Veranstaltung ist im Rahmen der Zertifizierung der ärztlichen " +
        "Fortbildung der Ärztekammer Westfalen-Lippe mit 4 Punkten (Kategorie D) " +
        "anrechenbar.",
    );
  });

  it("uses the singular 'Punkt' for exactly one point", () => {
    // German number agreement on a legal document: "mit 1 Punkt", not "1 Punkten".
    expect(creditSentence(1, "A", "Ärztekammer Nordrhein")).toContain("mit 1 Punkt (");
    expect(creditSentence(1, "A", "Ärztekammer Nordrhein")).not.toContain("1 Punkten");
  });

  it("uses the plural 'Punkten' for more than one point", () => {
    expect(creditSentence(3, "D", "ÄKWL")).toContain("mit 3 Punkten (");
  });

  it("substitutes the course's own points and category, never a hardcoded value", () => {
    const other = creditSentence(2, "B", "Ärztekammer Hamburg");
    expect(other).toContain("mit 2 Punkten (Kategorie B)");
    expect(other).not.toContain("Kategorie D");
    expect(other).toContain("Ärztekammer Hamburg");
  });
});

describe("buildCertificateData", () => {
  it("carries every input field through and precomputes the sentence", () => {
    const data = buildCertificateData(medice);

    expect(data.vnr).toBe(medice.vnr);
    expect(data.courseTitle).toBe("ADHS Akademie adult");
    expect(data.participantName).toBe("Dr. med. Anna Müller");
    expect(data.creditSentence).toContain("4 Punkten (Kategorie D)");
  });

  it("is pure — same input, same output, and reads no clock", () => {
    expect(buildCertificateData(medice)).toEqual(buildCertificateData(medice));
  });

  it("preserves the completion timestamp for both -datum and -uhrzeit", () => {
    // The Bescheid requires date AND time; the renderer gets both from here.
    expect(buildCertificateData(medice).completedAt.toISOString()).toBe(
      "2026-08-15T14:35:00.000Z",
    );
  });
});

describe("missingCertificateFields", () => {
  it("reports nothing missing for a complete MEDICE certificate", () => {
    expect(missingCertificateFields(medice)).toEqual([]);
  });

  it("names each absent mandatory field", () => {
    const empty = missingCertificateFields({
      ...medice,
      vnr: "",
      courseTitle: "   ",
      participantName: "",
    });

    expect(empty).toContain("vnr");
    expect(empty).toContain("courseTitle");
    expect(empty).toContain("participantName");
  });

  it("treats zero or non-integer CME points as missing", () => {
    expect(missingCertificateFields({ ...medice, cmePoints: 0 })).toContain("cmePoints");
    expect(missingCertificateFields({ ...medice, cmePoints: 4.5 })).toContain(
      "cmePoints",
    );
  });

  it("treats an invalid completion date as missing", () => {
    expect(
      missingCertificateFields({ ...medice, completedAt: new Date("not a date") }),
    ).toContain("completedAt");
  });

  it("does not block on a missing address — it is not in the Bescheid's minimum list", () => {
    // Anschrift is required by the Muster but its necessity for an online format
    // is unresolved, so its absence must not make the data 'incomplete' yet.
    const noAddress = missingCertificateFields(medice);
    expect(noAddress).not.toContain("participantAddress" as never);
    expect(noAddress).toEqual([]);
  });
});

describe("the Wissenschaftliche Leitung is mandatory", () => {
  it("reports a missing scientific lead", () => {
    // The Bescheid: "Die Teilnahmebescheinigungen sind mit dem Stempel der
    // Wissenschaftlichen Leitung zu versehen und von diesem zu unterzeichnen."
    // A certificate without one is not valid, so its absence is a missing
    // field rather than a cosmetic gap.
    expect(missingCertificateFields({ ...medice, scientificLeadName: "" })).toContain(
      "scientificLeadName",
    );
  });

  it("treats whitespace as absent", () => {
    expect(missingCertificateFields({ ...medice, scientificLeadName: "   " })).toContain(
      "scientificLeadName",
    );
  });
});
