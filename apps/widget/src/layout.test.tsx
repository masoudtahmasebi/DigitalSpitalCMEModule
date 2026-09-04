/**
 * That the three CME screens are actually on one column (P190-01).
 *
 * ## Why this test exists and what it is guarding
 *
 * `layout.ts` is a pure module exporting two strings, and a string nothing
 * applies is the shape CLAUDE.md §9.3 names: a rule written, not a rule
 * enforced. The defect it was written for was the reverse of that and worse —
 * the catalogue had its own `max-w-[1082px]`, the course detail had no column
 * at all and `CourseShell` had none either, so the same measurement was read
 * three ways and two of them ran the full width of the host page.
 *
 * A test of `layout.ts` itself would prove nothing (§9.7): `CONTENT` would
 * still be the right string with every call site deleted. So this names the
 * callers. It renders each of the three screens and asserts the column is on
 * each — which is the property that was actually broken, and the one that
 * breaks again the moment somebody adds a fourth screen and forgets.
 *
 * ## What it deliberately does not assert
 *
 * Pixels. jsdom has no layout, so 1398 px is not observable here; the browser
 * journey is where a width is measured. What is observable, and sufficient, is
 * that every screen reaches for the same constant rather than inventing one —
 * which is the failure that occurred.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import type { ApiClient, CourseDetail, EnrolmentState } from "@ds/sdk";
import type { Branding } from "@ds/domain";
import { CONTENT_WIDTH } from "./layout.js";
import { CourseList } from "./components/CourseList.js";
import { CourseShell } from "./components/CourseShell.js";
import { StickyMetaBar } from "./components/CourseHeader.js";

afterEach(cleanup);

/** The one class that makes an element the content column. */
const COLUMN = CONTENT_WIDTH.split(" ").find((entry) => entry.startsWith("max-w-"));

function columns(container: HTMLElement): Element[] {
  return [...container.querySelectorAll(`[class*="${COLUMN ?? "never"}"]`)];
}

function course(): CourseDetail {
  return {
    id: "course",
    slug: "adhs",
    title: "Basisseminar 2026",
    description: null,
    heroImageUrl: null,
    deliveryType: "on_demand",
    thema: [],
    altersgruppe: [],
    cmePoints: 4,
    cmeCategory: "D",
    moduleCount: 1,
    totalDurationSec: 900,
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

function state(): EnrolmentState {
  return {
    enrolmentId: "e1",
    courseSlug: "adhs",
    requiredWatchPercent: 80,
    passThresholdPercent: 70,
    achievedWatchPercent: 0,
    quizPassed: false,
    evaluationSubmitted: false,
    efnPresent: false,
    courseComplete: false,
    complete: false,
    outstanding: [],
    outstandingForCourse: [],
    completedAt: null,
    courseCompletedAt: null,
    progress: { status: "not_started", completedCount: 0, totalCount: 1, percent: 0 },
    moduleCompletion: { completed: 0, total: 1 },
    modules: [],
    resumeContentId: null,
  } as unknown as EnrolmentState;
}

const branding = {} as Branding;

function catalogueClient(): ApiClient {
  return {
    listCourses: vi.fn(async () => ({
      items: [],
      total: 0,
      page: 1,
      perPage: 10,
      facets: { thema: [], altersgruppe: [] },
    })),
  } as unknown as ApiClient;
}

describe("every CME screen sits on the shared content column", () => {
  it("the catalogue puts its panel on it", async () => {
    const { container } = render(
      <CourseList client={catalogueClient()} branding={branding} onOpen={vi.fn()} />,
    );

    await waitFor(() => {
      expect(columns(container).length).toBeGreaterThan(0);
    });
  });

  it("the course detail puts its meta strip on it", () => {
    const { container } = render(
      <StickyMetaBar
        course={course()}
        state={state()}
        onBack={undefined}
        onResume={undefined}
      />,
    );

    expect(columns(container).length).toBeGreaterThan(0);
  });

  it("the player puts its band and its panel on it", () => {
    const { container } = render(
      <CourseShell
        apiBase="https://api.invalid"
        projectSlug="ds"
        course={course()}
        state={state()}
        currentContentId=""
        onOpen={vi.fn()}
        onBack={vi.fn()}
        onResume={undefined}
        progress={false}
        onClaimPoints={undefined}
      >
        <p>Abschnitt</p>
      </CourseShell>,
    );

    /*
     * Two, and the number matters. The teal band bleeds to the edges of the
     * page and insets its own contents; the white panel below is inset as a
     * whole. One column would mean the band had swallowed the panel or the
     * panel had swallowed the band, and either way something is no longer
     * bleeding that the drawing bleeds.
     */
    expect(columns(container).length).toBe(2);
  });
});
