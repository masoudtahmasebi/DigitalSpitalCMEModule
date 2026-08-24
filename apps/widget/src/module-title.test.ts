import { describe, expect, it } from "vitest";
import { moduleHeading, moduleTopic } from "./module-title.js";

describe("moduleHeading", () => {
  it("adds the number when the title has none", () => {
    expect(moduleHeading(1, "Grundlagen")).toBe("Modul 1 – Grundlagen");
  });

  it("does not repeat a number the author already typed", () => {
    // The defect this file exists for: "Modul 1 – Modul 1 – Grundlagen".
    expect(moduleHeading(1, "Modul 1 – Grundlagen")).toBe("Modul 1 – Grundlagen");
  });

  it("tolerates the spacing and casing an author might use", () => {
    expect(moduleHeading(3, "MODUL 3: Pharmakotherapie")).toBe(
      "MODUL 3: Pharmakotherapie",
    );
    expect(moduleHeading(3, "Modul3 – Pharmakotherapie")).toBe(
      "Modul3 – Pharmakotherapie",
    );
  });

  it("still numbers a title that merely starts with the word Modul", () => {
    // "Modulare Therapie" is not module 4 announcing itself.
    expect(moduleHeading(4, "Modulare Therapie")).toBe("Modul 4 – Modulare Therapie");
  });

  it("restates a disagreeing number rather than printing both (P106-04)", () => {
    /*
     * This case had a test, and the test asserted the defect:
     *
     *   expect(moduleHeading(2, "Modul 1 – Grundlagen"))
     *     .toBe("Modul 2 – Modul 1 – Grundlagen");
     *
     * It was written from the code — "another module's number is not this
     * one's" is true, and the conclusion drawn from it was to prefix anyway.
     * On the client's install, where the modules had been reordered without
     * their titles being retyped, every row in the sidebar read like that. No
     * gate could go red, because the expected value was the wrong one.
     *
     * The position wins: it is what orders the list, gates it and counts it.
     */
    expect(moduleHeading(2, "Modul 1 – Grundlagen")).toBe("Modul 2 – Grundlagen");
    expect(moduleHeading(4, "Modul 5 – Komorbiditäten")).toBe("Modul 4 – Komorbiditäten");
  });

  it("keeps a title that is only a disagreeing number, rather than emptying it", () => {
    // Nothing to restate, so the number stands and the disagreement is visible
    // — which is better than "Modul 4 – " with nothing after the dash.
    expect(moduleHeading(4, "Modul 5")).toBe("Modul 4 – Modul 5");
  });
});

describe("moduleTopic", () => {
  /*
   * No ordinal argument any more (P106-04). It took one, used it only to insist
   * the number matched, and its caller — the Mediathek, whose own heading has
   * already said "Materialien zu Modul 1" — wants the number gone whatever it
   * says. A parameter that exists to reject the case the caller cares about is
   * worse than none.
   */
  it("strips a number the surrounding heading has already given", () => {
    expect(moduleTopic("Modul 1 – Grundlagen")).toBe("Grundlagen");
  });

  it("handles each separator an author might type", () => {
    expect(moduleTopic("Modul 2: Diagnostik")).toBe("Diagnostik");
    expect(moduleTopic("Modul 2 - Diagnostik")).toBe("Diagnostik");
    expect(moduleTopic("Modul 2 · Diagnostik")).toBe("Diagnostik");
    expect(moduleTopic("Modul 2 Diagnostik")).toBe("Diagnostik");
  });

  it("leaves an unnumbered title alone", () => {
    expect(moduleTopic("Grundlagen")).toBe("Grundlagen");
  });

  it("strips a number that disagrees with its position too", () => {
    // The Mediathek heading above it is authoritative about which module this
    // is; leaving a second, contradicting number inside the parentheses was the
    // same defect one screen over.
    expect(moduleTopic("Modul 5 – Komorbiditäten")).toBe("Komorbiditäten");
  });

  it("keeps the whole title when stripping would empty it", () => {
    // A module called exactly "Modul 3" has no topic to fall back to, and an
    // empty heading reads as a rendering fault.
    expect(moduleTopic("Modul 3")).toBe("Modul 3");
  });
});
