import { describe, expect, it } from "vitest";
import { participantsToCsv } from "./participant-csv.js";
import type { ParticipantRow } from "./admin.dto.js";

function row(overrides: Partial<ParticipantRow> = {}): ParticipantRow {
  return {
    enrolmentId: "a1b2c3d4-0000-4000-8000-000000000001",
    participantName: "Anna Müller",
    email: "anna@example.org",
    efnPresent: true,
    watchedPercent: 100,
    quizPassed: true,
    evaluationSubmitted: true,
    progressPercent: 100,
    courseComplete: true,
    complete: true,
    completedAt: "2026-07-28T14:35:00.000Z",
    courseCompletedAt: "2026-07-28T14:30:00.000Z",
    eivState: "submitted",
    eivAttempts: 1,
    eivReportDueAt: "2026-08-05T21:59:59.000Z",
    certificateState: "issued",
    ...overrides,
  };
}

describe("the exported file opens correctly in Excel", () => {
  it("starts with a UTF-8 BOM", () => {
    // Without it Excel reads the file as the system codepage and "Müller"
    // arrives as "MÃ¼ller".
    const csv = participantsToCsv([row()]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it("declares the semicolon separator", () => {
    // Excel in a German locale splits on `;`. A comma-separated file opens as
    // one column per row.
    expect(participantsToCsv([])).toContain("sep=;");
  });

  it("uses CRLF line endings", () => {
    const csv = participantsToCsv([row()]);
    expect(csv).toContain("\r\n");
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("keeps German characters intact", () => {
    const csv = participantsToCsv([row({ participantName: "Jörg Weiß" })]);
    expect(csv).toContain("Jörg Weiß");
  });
});

describe("formula injection is neutralised", () => {
  // The attested name is learner input (ADR-0004 §6.5), so this is reachable,
  // not theoretical: whoever opens the export is the target.
  const dangerous = [
    "=cmd|'/c calc'!A1",
    "+1+1",
    "-1+1",
    "@SUM(A1)",
    "\tvalue",
    "\rvalue",
  ];

  it.each(dangerous)("prefixes %j so the spreadsheet cannot evaluate it", (value) => {
    const csv = participantsToCsv([row({ participantName: value })]);
    expect(csv).toContain(`"'${value.replaceAll('"', '""')}"`);
  });

  it("leaves an ordinary name unprefixed", () => {
    const csv = participantsToCsv([row({ participantName: "Anna Müller" })]);
    expect(csv).toContain('"Anna Müller"');
    expect(csv).not.toContain("\"'Anna");
  });

  it("escapes an embedded quote per RFC 4180", () => {
    const csv = participantsToCsv([row({ participantName: 'Anna "Andi" Müller' })]);
    expect(csv).toContain('"Anna ""Andi"" Müller"');
  });

  it("cannot be broken out of with a separator or a newline in a value", () => {
    const csv = participantsToCsv([row({ participantName: "A;B\nC" })]);
    // Still one field: the value is quoted, so neither character ends it.
    expect(csv).toContain('"A;B\nC"');
  });
});

describe("what the export does and does not contain", () => {
  it("never contains an EFN, only whether one is on file", () => {
    // An export is where personal data leaves every access control this
    // platform has. The EFN is reported to the Ärztekammer and read back by
    // nobody (ADR-0004).
    const csv = participantsToCsv([row()]);

    expect(csv).not.toContain("123456789012345");
    expect(csv).toContain("EFN hinterlegt");
    expect(csv).toContain('"ja"');
  });

  it("has one line per participant plus the header and the sep line", () => {
    const csv = participantsToCsv([row(), row(), row()]);
    // Trailing CRLF produces one empty trailing element.
    expect(csv.split("\r\n").filter((line) => line !== "")).toHaveLength(5);
  });

  /*
   * The header row and the data rows are two hand-written lists in one file,
   * and nothing but this test makes them agree. Adding a column to one and not
   * the other shifts every cell to its right — so "Zertifiziert" reads the
   * completion date, "Meldefrist" reads the certificate state, and the file is
   * still a perfectly well-formed CSV that opens without complaint.
   *
   * Found while adding the two P51-01 columns, which is exactly the edit that
   * causes it. Every other test here checks that some string is *somewhere* in
   * the output, and all of them stay green through a total misalignment.
   */
  it("gives every data row exactly as many cells as the header", () => {
    const csv = participantsToCsv([row(), row({ email: null, completedAt: null })]);
    const [, header, ...dataRows] = csv.split("\r\n").filter((line) => line !== "");

    const headerCells = header?.split(";").length;
    expect(headerCells).toBeGreaterThan(0);
    for (const line of dataRows) {
      expect(line.split(";")).toHaveLength(headerCells as number);
    }
  });

  it("renders dates in German local time, not UTC", () => {
    // These are read against the Ärztekammer's deadlines, which are German
    // dates. 21:59:59Z on the 5th is 23:59 on the 5th in Berlin — rendering it
    // in UTC would be right here but wrong at the winter boundary, so the zone
    // is named rather than assumed.
    const csv = participantsToCsv([row({ completedAt: "2026-07-28T22:30:00.000Z" })]);
    // 22:30 UTC in July is 00:30 on the 29th in Berlin.
    expect(csv).toContain("29.07.2026");
  });

  it("leaves an absent date empty rather than printing Invalid Date", () => {
    const csv = participantsToCsv([row({ completedAt: null, eivReportDueAt: null })]);
    expect(csv).not.toContain("Invalid");
  });

  it("calls out a submission needing attention in words, not a code", () => {
    // The admin reading this spreadsheet is the last line before a statutory
    // deadline passes. "needs_attention" means nothing to them.
    const csv = participantsToCsv([row({ eivState: "needs_attention" })]);
    expect(csv).toContain("PRÜFEN");
  });

  it("produces a header-only file for no participants", () => {
    const csv = participantsToCsv([]);
    expect(csv).toContain("Teilnehmende Person");
    expect(csv.split("\r\n").filter((line) => line !== "")).toHaveLength(2);
  });
});
