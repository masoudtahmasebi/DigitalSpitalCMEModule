/**
 * The player screen's behaviour (layout §4.3).
 *
 * What is worth asserting here is everything the learner would read as a
 * statement about their own progress or their own permissions:
 *
 * 1. **"Modul 3 von 5" counts the right module.** It is derived from the tree,
 *    so an off-by-one is invisible in review and wrong on every screen.
 * 2. **A locked tab offers no way through it.** The padlock and the reason are
 *    the whole content of a locked tab; if a button leaked out beside them the
 *    server would reject the call, but the learner would have been told they
 *    could proceed.
 * 3. **The lock states come from the server's fields**, not from anything the
 *    widget worked out — flipping `quizPassed` alone changes the Punktemeldung
 *    tab, and nothing else does.
 * 4. **Teilprüfung is absent**, deliberately (§6.1). Asserted so that its
 *    reappearance is a failing test rather than a quiet scope addition.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type {
  ApiClient,
  ChapterState,
  ContentSummary,
  CourseDetail,
  EnrolmentState,
  GateStatus,
  LessonContent,
  ModuleState,
  ProgressSummary,
} from "@ds/sdk";
import { PlayerScreen } from "./PlayerScreen.js";

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

function lesson(overrides: Partial<LessonContent> = {}): LessonContent {
  return {
    id: "v3",
    kind: "video",
    title: "Video 3",
    durationSec: 1545,
    sources: [
      { url: "https://example.invalid/v3.mp4", mimeType: "video/mp4", label: null },
    ],
    posterUrl: null,
    captionsUrl: null,
    body: "Erste Zusammenfassung.\n\nZweiter Absatz.",
    lastPositionSec: 875,
    watchedPercent: 40,
    watchedSegments: [],
    ...overrides,
  } as LessonContent;
}

function renderPlayer(
  overrides: {
    state?: EnrolmentState;
    lesson?: LessonContent;
    onOpen?: (id: string) => void;
    onReporting?: () => void;
    onBack?: () => void;
  } = {},
) {
  const client = { recordProgress: vi.fn() } as unknown as ApiClient;
  render(
    <PlayerScreen
      client={client}
      courseSlug="adhs"
      course={course()}
      state={overrides.state ?? state()}
      lesson={overrides.lesson ?? lesson()}
      onProgress={vi.fn()}
      onOpen={overrides.onOpen ?? vi.fn()}
      onBack={overrides.onBack ?? vi.fn()}
      onReporting={overrides.onReporting ?? vi.fn()}
    />,
  );
}

describe("the progress panel", () => {
  it("counts the module the current content is actually in", () => {
    renderPlayer();
    expect(screen.getByText("Modul 3 von 5")).toBeTruthy();
  });

  it("names the quantity behind the percentage rather than showing a bare figure", () => {
    // The layout's `63% absolviert` does not say what it is a percentage of;
    // see the S16 note in docs/show-stoppers.md.
    renderPlayer();
    expect(screen.getByText("63 % der Fortbildung absolviert")).toBeTruthy();
  });

  it("shows the resume position against the authored length, not the element's", () => {
    // 875 s and 1545 s — the layout's own `14:35 / 25:45`. jsdom reports
    // `duration: NaN`, so a player reading the element would print NaN here.
    renderPlayer();
    expect(screen.getByText("14:35 / 25:45")).toBeTruthy();
  });

  it("promises the autosave the flush behaviour actually delivers", () => {
    renderPlayer();
    expect(screen.getByText("Ihr Fortschritt wird automatisch gespeichert")).toBeTruthy();
  });

  /*
   * P62-05's assertion deliberately does **not** live here, and the absence is
   * written down rather than left to be discovered.
   *
   * When the session lapses this line is replaced by "Ihre Sitzung ist
   * abgelaufen …". Driving that from a test needs a real flush, which needs the
   * element to have ticked while playing — and jsdom has no media pipeline:
   * `paused`, `currentTime` and `seeking` are inert, the watch tracker never
   * records an interval, and the flush returns before it can fail. Stubbing
   * enough of the element to get past that would be a test of the stubs.
   *
   * So the decision is unit-tested where it is pure — `isSessionExpired` in
   * `src/session.test.ts`, including every status that must *not* trigger it —
   * and the wiring from a 401 to the sentence was verified in a real browser
   * across a real token expiry. That run is in docs/backlog/P62.md.
   */

  it("omits the timeline for a lesson that has none", () => {
    renderPlayer({
      lesson: lesson({ kind: "text", sources: [], durationSec: null, id: "v3" }),
    });
    expect(screen.queryByText(/\d+:\d\d \/ /)).toBeNull();
    // The module counter and the course figure are not about the media, so
    // they stay.
    expect(screen.getByText("Modul 3 von 5")).toBeTruthy();
  });
});

describe("the content tabs", () => {
  it("locks the Lernerfolgskontrolle until the server opens its gate", () => {
    renderPlayer();
    fireEvent.click(screen.getByRole("tab", { name: /Lernerfolgskontrolle/ }));

    expect(
      screen.getByText("Wird nach Abschluss der Module freigeschaltet."),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Zur Lernerfolgskontrolle" })).toBeNull();
  });

  it("opens the quiz by id once its gate is available", () => {
    const onOpen = vi.fn();
    const opened = state();
    const fifth = opened.modules[4] as ModuleState;
    const chapter = fifth.chapters[0] as ChapterState;
    renderPlayer({
      onOpen,
      state: {
        ...opened,
        modules: [
          ...opened.modules.slice(0, 4),
          {
            ...fifth,
            gate: "available",
            chapters: [
              {
                ...chapter,
                gate: "available",
                contents: chapter.contents.map((c) => ({ ...c, gate: "available" })),
              },
            ],
          },
        ],
      },
    });

    fireEvent.click(screen.getByRole("tab", { name: "Lernerfolgskontrolle" }));
    fireEvent.click(screen.getByRole("button", { name: "Zur Lernerfolgskontrolle" }));
    expect(onOpen).toHaveBeenCalledWith("quiz");
  });

  it("locks CME Punktemeldung on quizPassed and nothing else", () => {
    const onReporting = vi.fn();
    renderPlayer({ onReporting });
    fireEvent.click(screen.getByRole("tab", { name: /CME Punktemeldung/ }));
    expect(
      screen.getByText("Wird nach bestandener Lernerfolgskontrolle freigeschaltet."),
    ).toBeTruthy();

    cleanup();

    renderPlayer({ onReporting, state: state({ quizPassed: true }) });
    fireEvent.click(screen.getByRole("tab", { name: "CME Punktemeldung" }));
    fireEvent.click(screen.getByRole("button", { name: "Zur CME Punktemeldung" }));
    expect(onReporting).toHaveBeenCalledOnce();
  });

  it("shows a video's body as the Zusammenfassung", () => {
    renderPlayer();
    expect(screen.getByText("Erste Zusammenfassung.")).toBeTruthy();
    expect(screen.getByText("Zweiter Absatz.")).toBeTruthy();
  });

  it("does not repeat a text lesson's body under Zusammenfassung", () => {
    // The body is the lesson and is already on screen above; printing it twice
    // would present one thing as two.
    renderPlayer({ lesson: lesson({ kind: "text", sources: [] }) });
    expect(
      screen.getByText("Für diesen Abschnitt ist keine Zusammenfassung hinterlegt."),
    ).toBeTruthy();
  });

  it("offers no Teilprüfung", () => {
    // Out of the 140 h scope (docs/requirements/medice-adhs.md §6.1). A locked
    // button for a feature that will never unlock is worse than its absence.
    renderPlayer();
    expect(screen.queryByText(/Teilprüfung/)).toBeNull();
  });
});

describe("the controls", () => {
  it("offers pause only while something is playing", () => {
    renderPlayer();
    const pause = screen.getByRole("button", { name: "Fortbildung pausieren" });
    expect((pause as HTMLButtonElement).disabled).toBe(true);
  });

  it("has no pause control on a lesson with no timeline", () => {
    renderPlayer({ lesson: lesson({ kind: "text", sources: [] }) });
    expect(screen.queryByRole("button", { name: "Fortbildung pausieren" })).toBeNull();
  });

  it("leaves the player only through Zurück zur Übersicht", () => {
    const onBack = vi.fn();
    renderPlayer({ onBack });
    fireEvent.click(screen.getByRole("button", { name: "Zurück zur Übersicht" }));
    expect(onBack).toHaveBeenCalledOnce();
  });
});
