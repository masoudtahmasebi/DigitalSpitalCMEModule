/**
 * The Zertifizierung tab (#60).
 *
 * Two things are worth a test and neither is the prose:
 *
 * - **no form.** The tab used to carry the EFN field and the completion button.
 *   An assertion that no textbox exists is what stops a later change quietly
 *   putting one back, because "the layout has no form here" is not something
 *   anybody re-derives while adding a field.
 * - **the thresholds are the course's.** This tab states the accreditation
 *   conditions. A hardcoded 80 % over a course configured at 70 would be the
 *   platform telling a physician the wrong rule about their own CME points.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { CourseDetail } from "@ds/sdk";
import { CertificationTab } from "./CertificationTab.js";

afterEach(cleanup);

function courseWith(overrides: Partial<CourseDetail>): CourseDetail {
  return {
    slug: "adhs-akademie-adult",
    title: "ADHS Akademie adult",
    cmePoints: 4,
    cmeCategory: "D",
    accreditationBody: "Ärztekammer Westfalen-Lippe",
    vnr: "2760552025919300018",
    validFrom: "2026-01-01T00:00:00.000Z",
    validTo: "2026-12-31T00:00:00.000Z",
    requiredWatchPercent: 80,
    passThresholdPercent: 70,
    modules: [],
    experts: [],
    ...overrides,
  } as unknown as CourseDetail;
}

describe("an accredited course", () => {
  it("states the course's own thresholds, not the layout's numbers", () => {
    render(<CertificationTab course={courseWith({})} certificate={null} />);

    expect(screen.getByText(/Mindestens 80 % aller Videomodule/)).toBeTruthy();
    expect(screen.getByText(/Mindestens 70 % der Fragen/)).toBeTruthy();
  });

  it("follows a course that is configured differently", () => {
    // The assertion above would pass just as happily against two constants.
    render(
      <CertificationTab
        course={courseWith({ requiredWatchPercent: 100, passThresholdPercent: 60 })}
        certificate={null}
      />,
    );

    expect(screen.getByText(/Mindestens 100 % aller Videomodule/)).toBeTruthy();
    expect(screen.getByText(/Mindestens 60 % der Fragen/)).toBeTruthy();
  });

  it("names the Ärztekammer, the validity and the Fortbildungsnummer", () => {
    render(<CertificationTab course={courseWith({})} certificate={null} />);

    expect(screen.getByText(/Ärztekammer Westfalen-Lippe/)).toBeTruthy();
    /*
     * The **VNR**, under the layout's label (S31, answered 27.08.2026).
     *
     * The number is asserted rather than the label, and it is the same string
     * the Punktemeldung reports. Until this change the line was fed by a
     * separate `fortbildungsnummer` column an operator could set to anything,
     * so the screen and the Meldung could disagree and nothing would say so.
     */
    expect(screen.getByText("Fortbildungsnummer: 2760552025919300018")).toBeTruthy();
    expect(screen.getByText(/Gültigkeit:/)).toBeTruthy();
  });

  it("omits the Fortbildungsnummer when the course has no VNR", () => {
    render(<CertificationTab course={courseWith({ vnr: null })} certificate={null} />);

    expect(screen.queryByText(/Fortbildungsnummer:/)).toBeNull();
  });

  it("omits the validity line rather than printing half of it", () => {
    render(
      <CertificationTab course={courseWith({ validTo: null })} certificate={null} />,
    );

    expect(screen.queryByText(/Gültigkeit:/)).toBeNull();
  });
});

describe("a course without accreditation", () => {
  it("says so, instead of drawing a panel with every value blank", () => {
    // `ds-ohne-punkte`, and the seeded default customer. A supported case.
    render(
      <CertificationTab
        course={courseWith({
          cmePoints: null,
          accreditationBody: null,
          vnr: null,
          validFrom: null,
          validTo: null,
        })}
        certificate={null}
      />,
    );

    expect(screen.getByText(/vergibt keine CME-Punkte/)).toBeTruthy();
    // The section headings, not the prose: the sentence above mentions the
    // Punktemeldung in order to say there will not be one.
    expect(
      screen.queryByRole("heading", {
        name: "Voraussetzungen für den Zertifikatserwerb",
      }),
    ).toBeNull();
    expect(screen.queryByRole("heading", { name: "Punktemeldung" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Akkreditierung" })).toBeNull();
  });
});

describe("the tab as a whole", () => {
  it("asks for nothing", () => {
    // #60: the EFN field, the name field and `Fortbildung abschließen` all
    // lived here. The layout has no form on page 04, and the reason is not
    // aesthetic — an EFN collected before the course is finished is an
    // identifier held before the event that justifies collecting it.
    const { container } = render(
      <CertificationTab course={courseWith({})} certificate={null} />,
    );

    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(container.querySelector("input")).toBeNull();
  });
});
