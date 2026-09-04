/**
 * The **Fortbildungsfortschritt** sidebar (layout 6.5).
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
  overrides: {
    onOpen?: (id: string) => void;
    actions?: readonly PlayerAction[];
    claim?: { done: boolean; open: (() => void) | undefined };
  } = {},
) {
  render(
    <ModuleSidebar
      course={course()}
      state={state()}
      currentContentId="v3"
      onOpen={overrides.onOpen ?? vi.fn()}
      actions={overrides.actions ?? []}
      claim={overrides.claim}
    />,
  );
}

describe("which chapter the learner is inside", () => {
  /*
   * P106-03. The client, from the running product: *"now i am doing kapitel 1
   * module 4, and this is the view, it is not like i am doing that, maybe an
   * indention would help?"*
   *
   * Three levels of small grey text at three paddings do not say which one
   * contains you. Two things now do, and both are asserted here rather than
   * eyeballed: the containing chapter's own row changes weight, and the list of
   * its contents carries a coloured rule down its left edge.
   *
   * These are class assertions, which are usually a bad trade — so they are
   * written as **comparisons between two sibling chapters in one render**. A
   * marker applied to every chapter and a marker applied to none are the two
   * ways this silently stops working, and both fail the comparison; a Tailwind
   * shade change does not.
   */
  function twoChapters(): { course: CourseDetail; state: EnrolmentState } {
    const detail = course();
    const enrolment = state();
    const module = detail.modules[2];
    const moduleState = enrolment.modules[2];
    if (module === undefined || moduleState === undefined) {
      throw new Error("the fixture has no third module");
    }

    module.chapters.push({
      id: "c3b",
      ordinal: 1,
      title: "Kapitel 3b",
      contents: [
        {
          id: "v3b",
          ordinal: 0,
          kind: "video",
          title: "Video 3b",
          durationSec: 600,
          mimeType: null,
        } satisfies ContentSummary,
      ],
    });
    moduleState.chapters.push({
      id: "c3b",
      gate: "available",
      progress: progress(),
      contents: [{ id: "v3b", gate: "available", progress: progress() }],
    });

    return { course: detail, state: enrolment };
  }

  /** The `<ul>` of contents drawn under a chapter's own row. */
  function contentsOf(chapterTitle: string): HTMLElement {
    const row = screen.getByText(chapterTitle).closest("li");
    const list = row?.querySelector("ul");
    if (list === null || list === undefined) {
      throw new Error(`no contents drawn under ${chapterTitle}`);
    }
    return list as HTMLElement;
  }

  function renderTwo() {
    const fixture = twoChapters();
    render(
      <ModuleSidebar
        course={fixture.course}
        state={fixture.state}
        currentContentId="v3"
        onOpen={vi.fn()}
        actions={[]}
      />,
    );
  }

  it("draws the indent guide in the brand colour under the chapter you are in", () => {
    renderTwo();
    // "Kapitel 3" holds Video 3, which is where the learner is. "Kapitel 3b" is
    // its sibling in the same open module and must not be marked.
    expect(contentsOf("Kapitel 3").className).toContain("border-brand");
    expect(contentsOf("Kapitel 3b").className).not.toContain("border-brand");
  });

  it("gives every chapter's contents a guide, marked or not", () => {
    // The rule is what says "these belong to that". Only its colour carries
    // the you-are-here; without the rule itself the contents float under a
    // heading they are merely near.
    renderTwo();
    for (const title of ["Kapitel 3", "Kapitel 3b"]) {
      expect(contentsOf(title).className).toContain("border-l-2");
    }
  });

  it("weights the containing chapter's title differently from its sibling's", () => {
    renderTwo();
    const here = screen.getByText("Kapitel 3").parentElement;
    const other = screen.getByText("Kapitel 3b").parentElement;
    expect(here?.className).not.toBe(other?.className);
    expect(here?.className).toContain("font-semibold");
  });
});

describe("the Fortbildungsfortschritt sidebar", () => {
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
      actions: [
        { label: "Fortbildung pausieren", variant: "secondary", disabled: false, run },
      ],
    });

    const outline = screen.getByRole("navigation", { name: "Fortbildungsfortschritt" });
    const button = screen.getByRole("button", { name: "Fortbildung pausieren" });
    expect(outline.contains(button)).toBe(true);

    fireEvent.click(button);
    expect(run).toHaveBeenCalledOnce();
  });

  it("draws nothing there on a screen with no action, which is every exam page", () => {
    renderSidebar();
    expect(screen.queryByRole("button", { name: "Fortbildung pausieren" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Prüfung starten" })).toBeNull();
  });

  it("calls the module under way *bearbeitet* and the chapter in it *angesehen*", () => {
    /*
     * P94-02. The layout gives the module you are inside a pause glyph and the
     * chapter you are on a play arrow, which is a real distinction rather than
     * a decoration: the module is a container you are part-way through, the
     * chapter is the thing in front of you. "Wird angesehen" on a module would
     * be a claim about five chapters at once.
     */
    renderSidebar();

    expect(
      screen.getAllByRole("img", { name: "Wird bearbeitet" }).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByRole("img", { name: "Wird angesehen" }).length).toBeGreaterThan(
      0,
    );
  });

  it("names each state for a screen reader, since the glyph is the only cue", () => {
    renderSidebar();
    expect(screen.getAllByRole("img", { name: "Wird angesehen" }).length).toBeGreaterThan(
      0,
    );
    expect(screen.getAllByRole("img", { name: "Gesperrt" }).length).toBeGreaterThan(0);
  });
});

/**
 * The Punktemeldung row (layout pages 05–12, P190-01).
 *
 * Three states and they are three different pieces of news, which is why each
 * gets its own case rather than one parameterised over a flag: shut, open, and
 * done. The one worth the most is *shut* — the drawing has this row on every
 * page of the player, from the first minute of the first module, and what it
 * has to do there is say **what opens it** (CLAUDE.md §9.4). A padlock alone
 * is a closed door with no sign on it.
 *
 * It is also the case that could not previously exist. `player.reportingLocked`
 * was written in P95-01, translated, covered by `check:i18n`, and rendered by
 * nothing at all — §9.3, and `check:copy` had it baselined as known-dead.
 */
describe("the CME-Punkte geltend machen row", () => {
  it("is not drawn at all when the caller passes no claim", () => {
    renderSidebar();

    expect(screen.queryByText("CME-Punkte geltend machen")).toBeNull();
  });

  it("says what opens it while the server would refuse the completion", () => {
    renderSidebar({ claim: { done: false, open: undefined } });

    expect(screen.getByText("CME-Punkte geltend machen")).toBeTruthy();
    expect(
      screen.getByText("Wird nach bestandener Lernerfolgskontrolle freigeschaltet."),
    ).toBeTruthy();
    /*
      §9.2: never offer what the system will refuse. While it is shut this is a
      line of text, not a control — a button here could only ever produce a 409,
      and it would produce it *after* the learner had committed to the step.
    */
    expect(
      screen.queryByRole("button", { name: /CME-Punkte geltend machen/u }),
    ).toBeNull();
  });

  it("becomes a control once the caller supplies the way onward", () => {
    const open = vi.fn();
    renderSidebar({ claim: { done: false, open } });

    const button = screen.getByRole("button", { name: /CME-Punkte geltend machen/u });
    fireEvent.click(button);
    expect(open).toHaveBeenCalledTimes(1);

    // The explanation goes with the padlock: there is nothing left to explain.
    expect(
      screen.queryByText("Wird nach bestandener Lernerfolgskontrolle freigeschaltet."),
    ).toBeNull();
  });

  it("stops inviting once the points have been reported", () => {
    renderSidebar({ claim: { done: true, open: undefined } });

    expect(screen.getByText("CME-Punkte geltend machen")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /CME-Punkte geltend machen/u }),
    ).toBeNull();
    expect(
      screen.queryByText("Wird nach bestandener Lernerfolgskontrolle freigeschaltet."),
    ).toBeNull();
  });
});
