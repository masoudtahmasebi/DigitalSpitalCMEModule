/**
 * The course-detail chrome (layout §4.2).
 *
 * The test that matters is the ring's: it must be drawn from the **module**
 * counts, the same two numbers as the sentence beside it. An earlier version
 * fed the arc `progress.percent` — which is content-weighted and legitimately
 * different — while labelling it with the module counts, so the ring quietly
 * told a learner something the caption contradicted. Nothing about that is
 * visible in a diff, and nothing about it is visible on screen either unless
 * you happen to have a course where the two numbers diverge.
 *
 * The fixtures therefore always diverge: 2 of 5 modules, 63 % content.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { CourseDetail, EnrolmentState } from "@ds/sdk";
import { ProgressCard, StickyMetaBar } from "./CourseHeader.js";

afterEach(cleanup);

const RING_RADIUS = 34;
const CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function state(overrides: Partial<EnrolmentState> = {}): EnrolmentState {
  return {
    enrolmentId: "e1",
    courseSlug: "adhs",
    requiredWatchPercent: 80,
    passThresholdPercent: 70,
    achievedWatchPercent: 41,
    quizPassed: false,
    evaluationSubmitted: false,
    efnPresent: false,
    courseComplete: false,
    complete: false,
    outstanding: [],
    outstandingForCourse: [],
    completedAt: null,
    courseCompletedAt: null,
    progress: {
      status: "in_progress",
      completedCount: 4,
      totalCount: 12,
      // Deliberately not 40 %: the ring must not be reading this.
      percent: 63,
    },
    moduleCompletion: { completed: 2, total: 5 },
    modules: [],
    resumeContentId: "v3",
    ...overrides,
  } as EnrolmentState;
}

function course(): CourseDetail {
  return {
    id: "course",
    slug: "adhs",
    title: "ADHS Akademie adult",
    description: null,
    heroImageUrl: null,
    deliveryType: "on_demand",
    thema: [],
    altersgruppe: [],
    cmePoints: 4,
    cmeCategory: "D",
    moduleCount: 5,
    totalDurationSec: 9000,
    enrolment: null,
    learningObjectives: [],
    targetAudience: null,
    vnr: null,
    accreditationBody: null,
    organizer: null,
    eventLocation: null,
    validFrom: null,
    validTo: null,
    requiredWatchPercent: 80,
    passThresholdPercent: 70,
    modules: [],
    experts: [],
  } as unknown as CourseDetail;
}

/**
 * The arc's length, in the same units as the circumference.
 *
 * No dashed circle at all counts as zero: the ring omits the arc entirely at
 * zero progress rather than drawing a zero-length dash, because
 * `strokeLinecap="round"` renders that as a dot — one unit of progress the
 * learner has not made.
 */
function arcLength(container: HTMLElement): number {
  const circles = container.querySelectorAll("circle[stroke-dasharray]");
  if (circles.length === 0) return 0;
  const dash = circles[0]?.getAttribute("stroke-dasharray") ?? "";
  return Number.parseFloat(dash.split(" ")[0] ?? "0");
}

describe("ProgressCard", () => {
  it("draws the arc from the module counts, not from the content percentage", () => {
    const { container } = render(<ProgressCard state={state()} onResume={undefined} />);
    // 2 of 5 modules is 40 % of the ring. 63 % would be the content figure.
    expect(arcLength(container)).toBeCloseTo(0.4 * CIRCUMFERENCE, 1);
  });

  it("puts the same two numbers in the ring and in the sentence", () => {
    const { container } = render(<ProgressCard state={state()} onResume={undefined} />);

    // The layout stacks the count over the words, so "2 von 5" is split across
    // two elements. Read the ring's own subtree rather than the whole card, so
    // this cannot be satisfied by the sentence underneath it.
    const ring = container.querySelector('[role="img"]');
    expect(ring?.textContent).toBe("2von 5");

    expect(
      screen.getByRole("img", { name: "Sie haben 2 von 5 Modulen abgeschlossen." }),
    ).toBeTruthy();
  });

  it("draws an empty ring for a course with no modules rather than dividing by zero", () => {
    const { container } = render(
      <ProgressCard
        state={state({ moduleCompletion: { completed: 0, total: 0 } })}
        onResume={undefined}
      />,
    );
    expect(arcLength(container)).toBe(0);
  });

  it("shows the watch requirement the course actually configured", () => {
    render(<ProgressCard state={state()} onResume={undefined} />);
    expect(
      screen.getByText("41 % der Videoinhalte angesehen (erforderlich: 80 %)."),
    ).toBeTruthy();
  });

  it("says nothing about completion while the course is still running", () => {
    render(<ProgressCard state={state()} onResume={undefined} />);
    expect(screen.queryByText("Fortbildung abgeschlossen")).toBeNull();
  });

  /*
   * P51-01. The banner follows `courseComplete`, and these three cases are the
   * whole rule: a physician who has watched the videos and passed the quiz is
   * told they have finished, whether or not the paperwork is in.
   *
   * The middle case is the one that was broken. It would have been green on the
   * old component only by accident — it never sets `completedAt` — which is why
   * it asserts the follow-up sentence too: the acknowledgement without the
   * "and now what" is the half that CLAUDE.md §9.4 says is not done.
   */
  it("says the course is finished as soon as the videos and quiz are done", () => {
    render(<ProgressCard state={state({ courseComplete: true })} onResume={undefined} />);

    expect(screen.getByText("Fortbildung abgeschlossen")).toBeTruthy();
    expect(screen.getByText(/Zertifizierung/)).toBeTruthy();
  });

  it("drops the follow-up line once the point has been claimed", () => {
    render(
      <ProgressCard
        state={state({ courseComplete: true, completedAt: "2026-09-10T08:00:00Z" })}
        onResume={undefined}
      />,
    );

    expect(screen.getByText("Fortbildung abgeschlossen")).toBeTruthy();
    expect(screen.queryByText(/Zertifizierung/)).toBeNull();
  });

  it("never announces completion on the strength of a certification date alone", () => {
    // Defensive: `completedAt` set without `courseComplete` is a state the
    // server cannot produce — certification implies course completion, and the
    // domain has a property test for exactly that. If it ever does produce it,
    // the banner must follow the condition, not the timestamp.
    render(
      <ProgressCard
        state={state({ courseComplete: false, completedAt: "2026-09-10T08:00:00Z" })}
        onResume={undefined}
      />,
    );

    expect(screen.queryByText("Fortbildung abgeschlossen")).toBeNull();
  });

  it("offers 'starten' before anything is done and 'fortsetzen' after", () => {
    const onResume = vi.fn();
    render(
      <ProgressCard
        state={state({
          progress: {
            status: "not_started",
            completedCount: 0,
            totalCount: 12,
            percent: 0,
          },
        })}
        onResume={onResume}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Fortbildung starten" }));
    expect(onResume).toHaveBeenCalledOnce();

    cleanup();
    render(<ProgressCard state={state()} onResume={onResume} />);
    expect(screen.getByRole("button", { name: "Fortbildung fortsetzen" })).toBeTruthy();
  });
});

describe("StickyMetaBar", () => {
  it("carries every figure of the layout's meta bar", () => {
    // The layout splits what used to be one "4 CME Punkte | 5 Module | 2
    // Stunden 30 Minuten" string into three fields with their own icons, so
    // each is asserted separately. All three still have to be there — the
    // points are why the learner is on the page at all.
    render(
      <StickyMetaBar
        course={course()}
        state={state()}
        onBack={undefined}
        onResume={undefined}
      />,
    );
    expect(screen.getByText("4")).toBeTruthy();
    expect(screen.getByText("CME Punkte")).toBeTruthy();
    expect(screen.getByText("5 Module")).toBeTruthy();
    expect(screen.getByText("2 Stunden 30 Minuten")).toBeTruthy();
  });

  it("keeps the resume action beside the course's worth, in the meta bar", () => {
    // This bar used to be `position: sticky`, so the resume button survived
    // scrolling past several screens of Beschreibung. The layout does not have
    // it stick — it sits under the hero and scrolls away — and the sticky
    // version had a defect of its own: content was legible through it until it
    // was made fully opaque.
    //
    // Following the layout, because the layout is the source of truth here.
    // What the sticky bar was protecting is protected another way: the teal
    // progress card beside all four tabs carries the same resume action, and it
    // is much further down the page.
    const { container } = render(
      <StickyMetaBar
        course={course()}
        state={state()}
        onBack={undefined}
        onResume={vi.fn()}
      />,
    );
    expect(container.querySelector(".sticky")).toBeNull();
    expect(screen.getByRole("button", { name: "Fortbildung fortsetzen" })).toBeTruthy();
  });

  it("offers the catalogue link only to a learner who came from the catalogue", () => {
    // An embed pinned to one course has no catalogue to go back to, and a link
    // to one would take the learner off the page the host built.
    render(
      <StickyMetaBar
        course={course()}
        state={state()}
        onBack={undefined}
        onResume={undefined}
      />,
    );
    expect(screen.queryByRole("button", { name: "Zurück zur Übersicht" })).toBeNull();

    cleanup();
    const onBack = vi.fn();
    render(
      <StickyMetaBar
        course={course()}
        state={state()}
        onBack={onBack}
        onResume={undefined}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Zurück zur Übersicht" }));
    expect(onBack).toHaveBeenCalledOnce();
  });
});
