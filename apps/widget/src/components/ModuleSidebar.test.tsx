/**
 * The **Modul Übersicht** sidebar (layout 6.5).
 *
 * These assertions used to live in `PlayerScreen.test.tsx`, because the sidebar
 * used to live in `PlayerScreen`. It moved to `CourseShell` in #61 — the layout
 * draws it on the player, on all four exam states and on the Punktemeldung, and
 * a copy beside each would have been a second reading of which chapter is
 * unlocked.
 *
 * What is worth asserting is what a learner would read as a statement about
 * their own permissions: every module is listed including the locked ones, a
 * locked content cannot be opened, and each state glyph has a name, because in
 * this list the glyph is the only thing separating a finished chapter from a
 * locked one.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type {
  ChapterState,
  ContentSummary,
  CourseDetail,
  EnrolmentState,
  GateStatus,
  ModuleState,
  ProgressSummary,
} from "@ds/sdk";
import { ModuleSidebar } from "./ModuleSidebar.js";
import type { PlayerAction } from "../player-status.js";

afterEach(cleanup);

function progress(overrides: Partial<ProgressSummary> = {}): ProgressSummary {
  return {
    status: "not_started",
    completedCount: 0,
    totalCount: 1,
    percent: 0,
    ...overrides,
  };
}

/** Five modules; the quiz lives in the fifth, which is where the layout puts it. */
function course(): CourseDetail {
  const modules = [1, 2, 3, 4, 5].map((n) => ({
    id: `m${n}`,
    ordinal: n - 1,
    title: `Modul ${n}`,
    subtitle: null,
    chapters: [
      {
        id: `c${n}`,
        ordinal: 0,
        title: `Kapitel ${n}`,
        contents: [
          {
            id: `v${n}`,
            ordinal: 0,
            kind: "video",
            title: `Video ${n}`,
            durationSec: 1545,
            mimeType: null,
          } satisfies ContentSummary,
          ...(n === 5
            ? [
                {
                  id: "quiz",
                  ordinal: 1,
                  kind: "quiz",
                  title: "Lernerfolgskontrolle",
                  durationSec: null,
                  mimeType: null,
                } satisfies ContentSummary,
              ]
            : []),
        ],
      },
    ],
  }));

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
    totalDurationSec: 7725,
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
    modules,
    experts: [],
  } as unknown as CourseDetail;
}

function state(overrides: Partial<EnrolmentState> = {}): EnrolmentState {
  const modules: ModuleState[] = [1, 2, 3, 4, 5].map((n) => {
    const gate: GateStatus = n <= 3 ? "available" : "locked";
    const chapter: ChapterState = {
      id: `c${n}`,
      gate,
      progress: progress(),
      contents: [
        { id: `v${n}`, gate, progress: progress() },
        ...(n === 5
          ? [{ id: "quiz", gate: "locked" as GateStatus, progress: progress() }]
          : []),
      ],
    };
    return { id: `m${n}`, gate, progress: progress(), chapters: [chapter] };
  });

  return {
    enrolmentId: "e1",
    courseSlug: "adhs",
    requiredWatchPercent: 80,
    passThresholdPercent: 70,
    achievedWatchPercent: 41,
    quizPassed: false,
    evaluationSubmitted: false,
    efnPresent: false,
    complete: false,
    outstanding: [],
    completedAt: null,
    progress: progress({
      status: "in_progress",
      completedCount: 2,
      totalCount: 6,
      percent: 63,
    }),
    moduleCompletion: { completed: 2, total: 5 },
    modules,
    resumeContentId: "v3",
    ...overrides,
  } as EnrolmentState;
}

/** The learner is in Video 3, exactly as the player's own fixtures have it. */
function renderSidebar(
  overrides: { onOpen?: (id: string) => void; action?: PlayerAction } = {},
) {
  render(
    <ModuleSidebar
      course={course()}
      state={state()}
      currentContentId="v3"
      onOpen={overrides.onOpen ?? vi.fn()}
      action={overrides.action}
    />,
  );
}

describe("the Modul Übersicht sidebar", () => {
  it("opens on the module being watched", () => {
    renderSidebar();
    const toggle = screen.getByRole("button", {
      name: /^Modul „Modul 3“ ein- oder ausklappen/,
    });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });

  it("lists every module, including the ones still locked", () => {
    // A learner who cannot see Modul 5 cannot tell a course they have not
    // unlocked from a course that is shorter than they thought.
    renderSidebar();
    for (const n of [1, 2, 3, 4, 5]) {
      expect(
        screen.getByRole("button", {
          name: new RegExp(`^Modul „Modul ${n}“ ein- oder ausklappen`, "u"),
        }),
      ).toBeTruthy();
    }
  });

  it("marks the current content and refuses to open a locked one", () => {
    const onOpen = vi.fn();
    renderSidebar({ onOpen });

    const current = screen.getByRole("button", { name: /Video 3/ });
    expect(current.getAttribute("aria-current")).toBe("true");

    fireEvent.click(
      screen.getByRole("button", { name: /^Modul „Modul 5“ ein- oder ausklappen/ }),
    );
    const locked = screen.getByRole("button", { name: /Video 5/ }) as HTMLButtonElement;
    expect(locked.disabled).toBe(true);
    fireEvent.click(locked);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("draws no counter beside a module row, and keeps the count in its name", () => {
    /*
     * P93-03. `Player-Ansicht-*` draws a glyph, a title and a chevron on each
     * module row and nothing else; the visible "2/3" was ours.
     *
     * Both halves matter. Removing it from the row is the layout; keeping it in
     * the accessible name is because a screen reader announces one row at a
     * time, so without it "Abgeschlossen, Modul 2" and a module that is half
     * done sound the same (§9.4).
     */
    renderSidebar();

    const toggle = screen.getByRole("button", {
      name: /^Modul „Modul 3“ ein- oder ausklappen/,
    });
    expect(toggle.textContent).not.toMatch(/\d+\s*\/\s*\d+/u);
    expect(toggle.getAttribute("aria-label")).toContain("von");
  });

  it("draws the primary action under the list when the screen has one", () => {
    // The action belongs to the screen inside `CourseShell` — the pause is the
    // media element's state and the exam is the server's gate — so this only
    // renders what it is handed, and renders nothing when handed nothing.
    const run = vi.fn();
    renderSidebar({
      action: { label: "Fortbildung pausieren", variant: "cta", disabled: false, run },
    });

    const outline = screen.getByRole("navigation", { name: "Modul Übersicht" });
    const button = screen.getByRole("button", { name: "Fortbildung pausieren" });
    expect(outline.contains(button)).toBe(true);

    fireEvent.click(button);
    expect(run).toHaveBeenCalledOnce();
  });

  it("draws nothing there on a screen with no action, which is every exam page", () => {
    renderSidebar();
    expect(screen.queryByRole("button", { name: "Fortbildung pausieren" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Lernerfolgskontrolle beginnen" }),
    ).toBeNull();
  });

  it("names each state for a screen reader, since the glyph is the only cue", () => {
    renderSidebar();
    expect(screen.getAllByRole("img", { name: "Wird angesehen" }).length).toBeGreaterThan(
      0,
    );
    expect(screen.getAllByRole("img", { name: "Gesperrt" }).length).toBeGreaterThan(0);
  });
});
