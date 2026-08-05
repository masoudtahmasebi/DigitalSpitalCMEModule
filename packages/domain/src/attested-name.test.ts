/**
 * The one composer that turns layout page 13's three fields into the one string
 * the certificate prints and the Punktemeldung reports.
 *
 * The cases that matter are the whitespace ones. They are invisible on screen
 * and they are exactly what makes an Ärztekammer unable to match a report to a
 * certificate.
 */

import { describe, expect, it } from "vitest";
import { composeAttestedName, NAME_PART_MAX_LENGTH } from "./attested-name.js";

describe("composeAttestedName", () => {
  it("puts the title first, as the Bescheid's template orders it", () => {
    const result = composeAttestedName({
      title: "Dr. med.",
      givenName: "Anna",
      familyName: "Musterfrau",
    });

    expect(result).toEqual({
      ok: true,
      name: "Dr. med. Anna Musterfrau",
      parts: { title: "Dr. med.", givenName: "Anna", familyName: "Musterfrau" },
    });
  });

  it("composes without a title, because the layout's select has no empty choice", () => {
    // Taken literally the layout requires a title, which would make the form
    // impossible for a physician who has none. Both names are required; the
    // title is not.
    const result = composeAttestedName({ givenName: "Anna", familyName: "Musterfrau" });

    expect(result).toEqual({
      ok: true,
      name: "Anna Musterfrau",
      parts: { givenName: "Anna", familyName: "Musterfrau" },
    });
  });

  it("treats a null or blank title as absent rather than as a leading space", () => {
    for (const title of [null, undefined, "", "   ", "\n"]) {
      const result = composeAttestedName({
        title,
        givenName: "Anna",
        familyName: "Musterfrau",
      });
      expect(result).toMatchObject({ ok: true, name: "Anna Musterfrau" });
    }
  });

  it("collapses the whitespace a paste brings with it", () => {
    // Non-breaking spaces, doubled spaces and a trailing newline all survive a
    // copy out of a PDF, and all of them break a string comparison at the
    // Kammer while looking correct on screen.
    const result = composeAttestedName({
      title: " Prof. Dr. ",
      givenName: "Anna  Maria",
      familyName: "von\tMusterfrau\n",
    });

    expect(result).toMatchObject({
      ok: true,
      name: "Prof. Dr. Anna Maria von Musterfrau",
      parts: {
        title: "Prof. Dr.",
        givenName: "Anna Maria",
        familyName: "von Musterfrau",
      },
    });
  });

  it("reports every problem at once, not the first", () => {
    // The form shows three fields together; reporting one problem per
    // submission makes somebody submit three times to learn three things.
    const result = composeAttestedName({ givenName: "  ", familyName: "" });

    expect(result).toEqual({
      ok: false,
      problems: ["given_name_missing", "family_name_missing"],
    });
  });

  it("refuses a name that is not a name", () => {
    const long = "x".repeat(NAME_PART_MAX_LENGTH + 1);

    expect(
      composeAttestedName({ givenName: long, familyName: "Musterfrau" }),
    ).toMatchObject({ ok: false, problems: ["given_name_too_long"] });
    expect(composeAttestedName({ givenName: "Anna", familyName: long })).toMatchObject({
      ok: false,
      problems: ["family_name_too_long"],
    });
    expect(
      composeAttestedName({ title: long, givenName: "Anna", familyName: "Musterfrau" }),
    ).toMatchObject({ ok: false, problems: ["title_too_long"] });
  });

  it("accepts a part exactly at the bound", () => {
    const exact = "x".repeat(NAME_PART_MAX_LENGTH);
    expect(composeAttestedName({ givenName: exact, familyName: exact })).toMatchObject({
      ok: true,
    });
  });

  it("keeps the characters German names are actually made of", () => {
    const result = composeAttestedName({
      title: "Dr. med. dent.",
      givenName: "Jörg-Peter",
      familyName: "Müller-Lüdenscheidt",
    });

    expect(result).toMatchObject({
      ok: true,
      name: "Dr. med. dent. Jörg-Peter Müller-Lüdenscheidt",
    });
  });
});
