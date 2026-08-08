/**
 * The Übersicht tab's Inhalte list.
 *
 * One thing is worth pinning here, and it is the one that was wrong: the topic
 * line under each module. `modules.subtitle` is what the author writes and what
 * the layout draws — "ADHS-Definition · Epidemiologie · Neurobiologie · Mythen
 * vs. Fakten" — and it travelled the whole stack (column, repository, DTO,
 * contract, SDK) only to be dropped in this component, which joined the chapter
 * titles instead.
 *
 * It looked right on a course with many short chapters and wrong on the MEDICE
 * course, which has one long chapter per module. That is exactly the kind of
 * bug a screenshot on the wrong fixture hides, so it gets a test.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { CourseDetail, EnrolmentState } from "@ds/sdk";
import { OverviewTab } from "./OverviewTab.js";

// Without this every render stacks in one document, and an assertion that
// something is *absent* passes or fails depending on the test before it.
afterEach(cleanup);

function courseWith(modules: CourseDetail["modules"]): CourseDetail {
  return {
    slug: "adhs-akademie-adult",
    title: "ADHS Akademie adult",
    description: null,
    deliveryType: "on_demand",
    thema: [],
    altersgruppe: [],
    learningObjectives: [],
    targetAudience: null,
    heroImageUrl: null,
    cmePoints: 4,
    cmeCategory: "D",
    modules,
  } as unknown as CourseDetail;
}

/** Not enrolled. The Inhalte list draws the same either way. */
const STATE = {
  modules: [],
  watchedPercent: 0,
  quizPassed: false,
} as unknown as EnrolmentState;

const chapter = (title: string) => ({
  id: `ch-${title}`,
  ordinal: 0,
  title,
  contents: [],
});

describe("the topic line under a module", () => {
  it("renders the authored subtitle", () => {
    render(
      <OverviewTab
        course={courseWith([
          {
            id: "m1",
            ordinal: 0,
            title: "Modul 1 – Grundlagen",
            subtitle: "ADHS-Definition · Epidemiologie · Neurobiologie",
            chapters: [chapter("Kapitel 1 – Definition und Epidemiologie")],
          },
        ] as unknown as CourseDetail["modules"])}
        state={STATE}
      />,
    );

    expect(
      screen.getByText("ADHS-Definition · Epidemiologie · Neurobiologie"),
    ).toBeTruthy();
  });

  it("does not fall back to chapter titles when a subtitle exists", () => {
    // The regression. With one long chapter per module — which is the shape of
    // the MEDICE course — the fallback showed a single chapter title where the
    // design shows four topics.
    render(
      <OverviewTab
        course={courseWith([
          {
            id: "m1",
            ordinal: 0,
            title: "Modul 1 – Grundlagen",
            subtitle: "ADHS-Definition · Epidemiologie",
            chapters: [chapter("Kapitel 1 – Definition und Epidemiologie")],
          },
        ] as unknown as CourseDetail["modules"])}
        state={STATE}
      />,
    );

    expect(screen.queryByText("Kapitel 1 – Definition und Epidemiologie")).toBeNull();
  });

  it("falls back to chapter titles when no subtitle is authored", () => {
    // Some topic line beats a blank space, and it is the same shape.
    render(
      <OverviewTab
        course={courseWith([
          {
            id: "m1",
            ordinal: 0,
            title: "Modul 1 – Grundlagen",
            subtitle: null,
            chapters: [chapter("Grundlagen"), chapter("Epidemiologie")],
          },
        ] as unknown as CourseDetail["modules"])}
        state={STATE}
      />,
    );

    expect(screen.getByText("Grundlagen · Epidemiologie")).toBeTruthy();
  });

  it("treats a whitespace-only subtitle as absent", () => {
    render(
      <OverviewTab
        course={courseWith([
          {
            id: "m1",
            ordinal: 0,
            title: "Modul 1 – Grundlagen",
            subtitle: "   ",
            chapters: [chapter("Grundlagen")],
          },
        ] as unknown as CourseDetail["modules"])}
        state={STATE}
      />,
    );

    expect(screen.getByText("Grundlagen")).toBeTruthy();
  });
});

describe("the Inhalte row's right-hand column", () => {
  const timed = (durationSec: number) => ({
    id: "ch1",
    ordinal: 0,
    title: "Kapitel 1",
    contents: [{ id: "c1", ordinal: 0, kind: "video", durationSec }],
  });

  it("carries the duration and nothing after it", () => {
    // It read "25:24 Min. · 1 Kapitel". The layout draws the duration alone,
    // and on this course — one chapter per module — the count was the same
    // useless "1 Kapitel" on every row.
    render(
      <OverviewTab
        course={courseWith([
          {
            id: "m1",
            ordinal: 0,
            title: "Modul 1 – Grundlagen",
            subtitle: "ADHS-Definition",
            chapters: [timed(1524)],
          },
        ] as unknown as CourseDetail["modules"])}
        state={STATE}
      />,
    );

    expect(screen.getByText("25:24 Min.")).toBeTruthy();
    expect(screen.queryByText(/Kapitel$/)).toBeNull();
  });

  it("is empty rather than a bare unit when the module has no timed content", () => {
    render(
      <OverviewTab
        course={courseWith([
          {
            id: "m1",
            ordinal: 0,
            title: "Modul 1 – Grundlagen",
            subtitle: "ADHS-Definition",
            chapters: [chapter("Nur Material")],
          },
        ] as unknown as CourseDetail["modules"])}
        state={STATE}
      />,
    );

    expect(screen.queryByText(/Min\./)).toBeNull();
  });
});

describe("the rules between sections", () => {
  it("start at the second section, whichever one that is", () => {
    // `first:border-t-0` follows the DOM, and a course with no description
    // starts at Lernziele. A container-level rule would have drawn a hairline
    // above the first heading on exactly those courses.
    const { container } = render(
      <OverviewTab
        course={{
          ...courseWith([]),
          description: null,
          learningObjectives: ["Sichere Diagnosestellung"],
        }}
        state={STATE}
      />,
    );

    const sections = container.querySelectorAll("section");
    expect(sections.length).toBeGreaterThan(1);
    expect(sections[0]?.className).toContain("first:border-t-0");
  });
});
