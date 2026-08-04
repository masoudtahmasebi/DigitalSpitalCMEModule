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

  it("does not treat another module's number as this one's", () => {
    expect(moduleHeading(2, "Modul 1 – Grundlagen")).toBe(
      "Modul 2 – Modul 1 – Grundlagen",
    );
  });
});

describe("moduleTopic", () => {
  it("strips a number the surrounding heading has already given", () => {
    expect(moduleTopic(1, "Modul 1 – Grundlagen")).toBe("Grundlagen");
  });

  it("handles each separator an author might type", () => {
    expect(moduleTopic(2, "Modul 2: Diagnostik")).toBe("Diagnostik");
    expect(moduleTopic(2, "Modul 2 - Diagnostik")).toBe("Diagnostik");
    expect(moduleTopic(2, "Modul 2 · Diagnostik")).toBe("Diagnostik");
    expect(moduleTopic(2, "Modul 2 Diagnostik")).toBe("Diagnostik");
  });

  it("leaves an unnumbered title alone", () => {
    expect(moduleTopic(1, "Grundlagen")).toBe("Grundlagen");
  });

  it("keeps the whole title when stripping would empty it", () => {
    // A module called exactly "Modul 3" has no topic to fall back to, and an
    // empty heading reads as a rendering fault.
    expect(moduleTopic(3, "Modul 3")).toBe("Modul 3");
  });
});
