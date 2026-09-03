/**
 * The layout's one-odd-corner shape, asserted where it is drawn.
 *
 * ## Why a test about `border-radius` earns its place
 *
 * Normally it would not. This one exists because three separate reports —
 * DEP-27 on the meta bar and its CME badge, DEP-28 on the tab row, DEP-29 on
 * the sticky progress card — were the *same defect* seen from three screens:
 * every teal and orange block in the MEDICE layout has three corners at one
 * radius and a fourth at another, and the widget had been rounding all four
 * evenly since the components were written. Nothing was broken, so nothing went
 * red, so it survived nine phases and arrived as three tickets in one morning.
 *
 * So what is asserted here is not "the radius is 20 px" — it is the property
 * that made the three reports one report: **the odd corner is present, and the
 * two halves of the tab row do not look alike.** Each of these would have been
 * red on the code as it stood on 02.09.2026, which is the only reason to keep
 * them (CLAUDE.md §9.1).
 *
 * The numbers themselves come from pixel measurements of
 * `docs/design/screens/page-02.png` and
 * `docs/design/mobile/progress-sticky-module.png`; they are recorded in the
 * header of `primitives.tsx` and in `docs/design/README.md`, not here, because
 * a test is a bad place to keep a drawing.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { CourseMetaBar, ModulesIcon, ProgressPanel, TabbedPanel } from "./primitives.js";

afterEach(cleanup);

const TABS = [
  { id: "overview", label: "Übersicht" },
  { id: "library", label: "Mediathek" },
] as const;

describe("TabbedPanel — the tab row (DEP-28)", () => {
  function tabs() {
    render(
      <TabbedPanel
        tabs={TABS}
        active="overview"
        onSelect={() => undefined}
        label="Fortbildung"
      >
        <div>panel</div>
      </TabbedPanel>,
    );
    return {
      active: screen.getByRole("tab", { name: "Übersicht" }),
      inactive: screen.getByRole("tab", { name: "Mediathek" }),
    };
  }

  it("does not give the active and the inactive tab the same skin", () => {
    // The report was that all four tabs read as one filled teal row, with no
    // way to tell which one you are on. Whatever the two skins are, they have
    // to differ — and the difference has to be in the fill, not only in a
    // border, because a border is what a phone screenshot loses first.
    const { active, inactive } = tabs();

    expect(active.className).not.toBe(inactive.className);
    expect(inactive.className).toContain("bg-brand-600");
    expect(inactive.className).toContain("text-brand-contrast");
    expect(active.className).toContain("bg-white");
    expect(active.className).toContain("text-brand-700");
  });

  it("squares the top-right corner of both tabs, and rounds the rest", () => {
    // The layout's shape for a teal block. `rounded-t-xl` — the class both
    // tabs carried — is the opposite arrangement: rounded on top, square
    // underneath.
    const { active, inactive } = tabs();

    expect(inactive.className).toContain("rounded-full");
    expect(inactive.className).toContain("rounded-tr-none");
    expect(active.className).toContain("rounded-tl-[1.25rem]");

    for (const tab of [active, inactive]) {
      expect(tab.className).not.toContain("rounded-t-xl");
    }
  });

  it("outlines the active tab in the same colour as the panel it stands on", () => {
    // `border-gray-100` on a panel outlined in `border-brand-100` draws the
    // seam that the folder-tab shape exists to hide. Both call sites — the
    // course detail and the catalogue — carry `border-brand-100`; a change to
    // one of the three has to be a change to all three.
    const { active } = tabs();

    expect(active.className).toContain("border-brand-100");
    expect(active.className).not.toContain("border-gray-100");
    // Merged into the panel, so it has no bottom edge of its own.
    expect(active.className).toContain("border-b-0");
  });
});

describe("CourseMetaBar — the strip under the hero (DEP-27)", () => {
  function bar() {
    const { container } = render(
      <CourseMetaBar
        points="4"
        pointsLabel="CME Punkte"
        duration="2 Stunden 30 Minuten"
        modules="3 Module"
        action={null}
      />,
    );
    const strip = container.firstElementChild;
    if (strip === null) throw new Error("CourseMetaBar rendered nothing");
    return strip;
  }

  it("sweeps the bar's bottom-right corner", () => {
    // It was `rounded-xl` on all four, which reads as a plain rectangle
    // against a hero whose own bottom-right sweeps — the two stop being one
    // masthead, which is what the -mt-7 overlap is for.
    expect(bar().className).toContain("rounded-br-[1.75rem]");
  });

  it("draws the CME points badge as the layout's badge, not as a pill", () => {
    // A full pill and a square badge are both wrong, in opposite directions.
    // The drawing has 4 px on three corners and one long sweep on the
    // bottom-right — the same shape as the white bar it sits in.
    bar();
    const badge = screen.getByText("CME Punkte").parentElement;
    if (badge === null) throw new Error("the points badge has no wrapper");

    expect(badge.className).toContain("rounded-br-[1.125rem]");
    expect(badge.className.split(/\s+/u)).not.toContain("rounded-full");
    // The hairline between the number and the words is the badge's own, so the
    // outer radius has to clip it.
    expect(badge.className).toContain("overflow-hidden");
  });
});

describe("ModulesIcon (DEP-27b)", () => {
  it("draws stacked sheets with a play badge, not a grid of tiles", () => {
    // The glyph beside `N Module` is the only thing in the meta strip that
    // says the course is video. A 2 × 2 grid of filled squares says "several
    // things" and stops there — and it is a single filled path, which is what
    // this distinguishes: the drawing is a stroked outline *plus* a badge with
    // the play triangle punched out of it.
    const { container } = render(<ModulesIcon />);
    const svg = container.querySelector("svg");
    if (svg === null) throw new Error("ModulesIcon rendered no svg");

    const stroked = svg.querySelectorAll("path[stroke]");
    const punched = svg.querySelectorAll('path[fill-rule="evenodd"]');

    expect(stroked.length).toBeGreaterThan(0);
    expect(punched.length).toBe(1);
    // Decorative: the count beside it is the accessible text.
    expect(svg.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("ProgressPanel (DEP-29)", () => {
  it("keeps the teal family's square top-right corner", () => {
    // DEP-29 asks the sticky card to be "consistent with the Ihr Fortschritt
    // widget on the main course detail page". This is that widget; if it stops
    // carrying the shape, the sticky one is consistent with the wrong thing.
    const { container } = render(
      <ProgressPanel
        title="Ihr Fortschritt"
        completed={2}
        total={3}
        value="2 von 3"
        sentence="Sie haben 2 von 3 Modulen abgeschlossen."
        action={null}
      />,
    );
    const card = container.querySelector("aside");
    if (card === null) throw new Error("ProgressPanel rendered no aside");

    expect(card.className).toContain("rounded-tr-none");
    expect(card.className).toContain("rounded-[1.25rem]");
  });
});
