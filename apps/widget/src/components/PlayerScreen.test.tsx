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
import { CourseShell } from "./CourseShell.js";
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

/**
 * Which modules carry a Lernerfolgskontrolle (P87-02).
 *
 * Two and three, and the order is the whole point. The fixture's lesson is
 * `v3`, so module 3's exam is the one the screen must offer — and module 2's
 * comes **first in course order**, so it is what the old course-wide search
 * returns. Putting the second exam in a *later* module would have left these
 * tests green against the behaviour P87-02 replaces, which is the trap
 * CLAUDE.md §9.1 is about; both were watched to fail with the search restored.
 *
 * Modules 1, 4 and 5 have none, which is the other half of the client's rule:
 * *"each module part, can have quiz or not, if it has the tab is shown, if not
 * it is not shown."*
 */
const MODULES_WITH_QUIZ = [2, 3];

/** The exam id for a module that has one — `quiz3`, `quiz5`. */
function quizId(module: number): string {
  return `quiz${String(module)}`;
}

/** Five modules, with an exam on two of them — see `MODULES_WITH_QUIZ`. */
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
          ...(MODULES_WITH_QUIZ.includes(n)
            ? [
                {
                  id: quizId(n),
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
        // Every exam starts locked, including module 3's, whose chapter is
        // reachable: P87-04 holds a module's Lernerfolgskontrolle shut until
        // that module's videos are watched, so a reachable chapter and a
        // locked exam inside it is the normal state, not a contrived one.
        ...(MODULES_WITH_QUIZ.includes(n)
          ? [{ id: quizId(n), gate: "locked" as GateStatus, progress: progress() }]
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

/**
 * The server has opened one module's Lernerfolgskontrolle.
 *
 * Only the exam's own gate moves, not its chapter's or its module's: that is
 * exactly the state P87-04 produces once a module's videos are watched, and a
 * helper that opened everything at once would let a widget that ignores the
 * content gate pass.
 */
function withQuizOpen(base: EnrolmentState, module: number): EnrolmentState {
  const id = quizId(module);
  return {
    ...base,
    modules: base.modules.map((entry) => ({
      ...entry,
      chapters: entry.chapters.map((chapter) => ({
        ...chapter,
        contents: chapter.contents.map((content) =>
          content.id === id ? { ...content, gate: "available" as GateStatus } : content,
        ),
      })),
    })),
  };
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

/**
 * The player **inside its real shell** (P93-03).
 *
 * Since the layout pass, two of the things this screen decides are drawn by
 * `CourseShell`: the progress card in the masthead and the primary action under
 * the module list. Rendering `PlayerScreen` alone would leave both untested and
 * the suite green — CLAUDE.md §9.7, name the caller — and rebuilding the
 * composition here instead would be a second implementation of the wiring,
 * which the tests would then agree with even when the product was wrong.
 *
 * So this renders the component the product renders. It costs a `useBranding`
 * fetch that resolves to nothing in jsdom, which is what a project with no logo
 * does in production too.
 */
function renderPlayer(
  overrides: {
    course?: CourseDetail;
    state?: EnrolmentState;
    lesson?: LessonContent;
    onOpen?: (id: string) => void;
    onReporting?: () => void;
    onBack?: () => void;
  } = {},
) {
  const client = { recordProgress: vi.fn() } as unknown as ApiClient;
  const courseNode = overrides.course ?? course();
  const enrolment = overrides.state ?? state();
  const current = overrides.lesson ?? lesson();
  const onOpen = overrides.onOpen ?? vi.fn();
  const onBack = overrides.onBack ?? vi.fn();

  render(
    <CourseShell
      apiBase="https://api.invalid"
      projectSlug="ds"
      course={courseNode}
      state={enrolment}
      currentContentId={current.id}
      onOpen={onOpen}
      onBack={onBack}
      onResume={undefined}
      progress={false}
    >
      <PlayerScreen
        client={client}
        courseSlug="adhs"
        course={courseNode}
        state={enrolment}
        lesson={current}
        onProgress={vi.fn()}
        onOpen={onOpen}
        onBack={onBack}
        onReporting={overrides.onReporting ?? vi.fn()}
      />
    </CourseShell>,
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

  it("opens **this module's** quiz once the server opens its gate", () => {
    /*
     * The assertion that P87-02 is for. The learner is on `v3`, and the course
     * has an exam on module 2 *and* on module 3. Opening module 3's is the only
     * right answer; the old course-wide search returned the first quiz it found
     * anywhere, which here is module 2's — somebody else's module's exam,
     * offered from this one.
     */
    const onOpen = vi.fn();
    renderPlayer({ onOpen, state: withQuizOpen(state(), 3) });

    fireEvent.click(screen.getByRole("tab", { name: "Lernerfolgskontrolle" }));
    fireEvent.click(screen.getByRole("button", { name: "Zur Lernerfolgskontrolle" }));
    expect(onOpen).toHaveBeenCalledWith("quiz3");
  });

  it("draws no Lernerfolgskontrolle tab on a module that has none", () => {
    /*
     * The other half of the client's rule, and the case that makes the tab
     * mean something: *"each module part, can have quiz or not, if it has the
     * tab is shown, if not it is not shown."*
     *
     * Module 1 has no exam while the course has two. Before P87-02 this drew a
     * padlocked tab pointing at module 2's — an affordance for an exam that
     * belongs to a different part of the course (§9.2).
     */
    renderPlayer({
      lesson: lesson({ id: "v1", title: "Video 1" }),
    });

    expect(screen.queryByRole("tab", { name: /Lernerfolgskontrolle/ })).toBeNull();
    expect(screen.queryByRole("tab", { name: /Punktemeldung/ })).toBeNull();
    expect(screen.getByRole("tab", { name: /Zusammenfassung/ })).toBeTruthy();
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

  it("offers no Lernerfolgskontrolle tab on a course that has none", () => {
    /*
     * P82-03, reported as *"if a module does not have erfolgs controlle, it
     * should not appear"*.
     *
     * The tab was drawn regardless and padlocked, which reads as "not yet".
     * On a course with no quiz content there is no yet — nothing will ever
     * unlock it, and the learner is left waiting for something that does not
     * exist. That is precisely the judgement the Teilprüfung case above
     * records; it had simply never been applied to the tab beside it.
     *
     * The Punktemeldung follows it: without a Lernerfolgskontrolle there is no
     * `quizPassed` to reach, so it too could only ever be locked.
     */
    const withoutQuiz = course();
    for (const module of withoutQuiz.modules) {
      for (const chapter of module.chapters) {
        (chapter as { contents: unknown[] }).contents = chapter.contents.filter(
          (content) => content.kind !== "quiz",
        );
      }
    }

    renderPlayer({ course: withoutQuiz });

    expect(screen.queryByRole("tab", { name: /Lernerfolgskontrolle/ })).toBeNull();
    expect(screen.queryByRole("tab", { name: /Punktemeldung/ })).toBeNull();
    // The one that is always meaningful stays.
    expect(screen.getByRole("tab", { name: /Zusammenfassung/ })).toBeTruthy();
  });

  it("keeps the tabs on a course that does have a Lernerfolgskontrolle", () => {
    // The control: without it the assertion above would pass on a player that
    // renders no tabs at all.
    renderPlayer();
    expect(screen.getByRole("tab", { name: /Lernerfolgskontrolle/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Punktemeldung/ })).toBeTruthy();
  });

  it("says which module unlocks the exam, beside a control that cannot yet open it", () => {
    /*
     * P93-03, and the reason it reverses an earlier decision.
     *
     * This used to assert the *absence* of a Teilprüfung, because a per-module
     * exam was out of the 140 h scope and a padlocked button for a feature
     * that would never unlock is worse than none. P87 put per-module exams in
     * scope, so the padlock now means "not yet" rather than "never", and
     * `Player-Ansicht-Tab-Zusammenfassung-V2` draws exactly this pair.
     *
     * The learner is on `v3`, whose module's exam is `quiz3` and is locked.
     */
    renderPlayer();

    expect(screen.getByText("Wird nach Modul 3 freigeschaltet")).toBeTruthy();
    const control = screen.getByRole("button", { name: "Zur Teilprüfung" });
    expect((control as HTMLButtonElement).disabled).toBe(true);
  });

  it("stops saying it once the server opens the gate", () => {
    // The control for the case above. A sentence about when something unlocks
    // is wrong the moment it has, and the sidebar's action is the way in from
    // then on — two controls for one exam is how the two come to disagree.
    renderPlayer({ state: withQuizOpen(state(), 3) });

    expect(screen.queryByText(/freigeschaltet$/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Zur Teilprüfung" })).toBeNull();
  });

  it("draws no exam announcement on a module that has no exam", () => {
    // §9.2 at the granularity P87 gave the course: module 1 has no exam, so
    // there is nothing for a sentence about unlocking one to be about.
    renderPlayer({ lesson: lesson({ id: "v1", title: "Video 1" }) });
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

  it("leaves the player through Zurück zur Übersicht", () => {
    const onBack = vi.fn();
    renderPlayer({ onBack });
    // `getAllByRole`: the shell draws the same action in the masthead, which is
    // where the layout puts it and where the first one is.
    const [back] = screen.getAllByRole("button", { name: /Zurück zur Übersicht/ });
    if (back === undefined) throw new Error("no way back rendered");
    fireEvent.click(back);
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("puts the primary action under the module list, not under the video", () => {
    /*
     * P93-03, and the §9.7 half of it: `PlayerScreen` decides which action it
     * is and `ModuleSidebar` draws it, so the property that matters is the
     * report between them. Rendered through the real `CourseShell`, this goes
     * red if the report stops arriving — which a test of either component
     * alone would not notice.
     */
    renderPlayer();

    const outline = screen.getByRole("navigation", { name: "Modul Übersicht" });
    const pause = screen.getByRole("button", { name: "Fortbildung pausieren" });
    expect(outline.contains(pause)).toBe(true);
  });

  it("draws the exam as the accent action, and only once", () => {
    /*
     * P94-02, from the report —
     *
     *   > "although being complete and next step being lernerfolgskontrolle,
     *   >  but there is no button for it with being also CTA. when i click on
     *   >  the title of lernerfolgskontrolle it goes to lernerfolgskontrolle,
     *   >  but the user does not know it"
     *
     * Two halves. The control was teal, so it did not read as the thing to do;
     * and `nextAvailableContent` drew a **second** one beside it labelled with
     * the exam's own title and nothing to say it was an exam, so clicking the
     * obvious-looking one started a Lernerfolgskontrolle unannounced.
     *
     * The class is the assertion because the class *is* the token: `cta` is
     * what `tailwind.preset.js` defines as "resume the thing you started", and
     * a test that only counted buttons would stay green on the teal one.
     */
    renderPlayer({ state: withQuizOpen(state(), 3) });

    const begin = screen.getByRole("button", { name: "Lernerfolgskontrolle beginnen" });
    expect(begin.className).toContain("bg-cta-500");

    // And nothing else on the screen offers the same exam.
    expect(screen.queryByText(/Weiter: .*Prüfung|Weiter: .*Lernerfolg/u)).toBeNull();
    expect(
      screen.getAllByRole("button", { name: /Lernerfolgskontrolle beginnen/ }),
    ).toHaveLength(1);
  });

  it("does not draw a second Weiter control pointing at the exam", () => {
    /*
     * The control for the case above. `nextAvailableContent` returns whatever
     * the server has open, and once a module's video is done that is the
     * module's own quiz — so without the guard this row carries a secondary
     * button labelled with the quiz's title.
     */
    const openState = withQuizOpen(state(), 3);
    renderPlayer({ state: openState });

    for (const button of screen.getAllByRole("button")) {
      expect(button.textContent ?? "").not.toContain("Weiter: Abschlussprüfung");
    }
  });

  it("swaps that action for the exam once the server opens its gate", () => {
    const onOpen = vi.fn();
    renderPlayer({ onOpen, state: withQuizOpen(state(), 3) });

    const outline = screen.getByRole("navigation", { name: "Modul Übersicht" });
    const begin = screen.getByRole("button", { name: "Lernerfolgskontrolle beginnen" });
    expect(outline.contains(begin)).toBe(true);
    expect(screen.queryByRole("button", { name: "Fortbildung pausieren" })).toBeNull();

    fireEvent.click(begin);
    expect(onOpen).toHaveBeenCalledWith("quiz3");
  });
});

/**
 * The section nobody can finish (P76-03).
 *
 * These are the §9.7 half of `mediaLengthVerdict`'s own unit tests: those
 * prove the rule, and would have stayed green on the player that never called
 * it — which is precisely the player that shipped, and which left a physician
 * watching a 45-second video behind a 25:24 gate with nothing on screen to say
 * why the bar would not fill (P75).
 *
 * The measured length has to come from the element, because that is where it
 * comes from in the product: jsdom reports `duration: NaN` until a test says
 * otherwise, so each case defines it and fires the event the browser fires.
 */
function playVideoOfLength(seconds: number) {
  const video = document.querySelector("video");
  if (video === null) throw new Error("no <video> rendered");
  Object.defineProperty(video, "duration", { value: seconds, configurable: true });
  fireEvent(video, new Event("loadedmetadata"));
}

describe("a section whose configured length the file cannot satisfy", () => {
  it("says so, naming both lengths, once the browser knows the file", () => {
    // The reported course: 1545 s authored, a 45 s recording, gate at 80 %.
    renderPlayer({ lesson: lesson({ durationSec: 1545 }) });

    // Nothing before metadata: the rule cannot be sure, and a warning that
    // flickers onto every course during loading is one nobody reads.
    expect(screen.queryByRole("alert")).toBeNull();

    playVideoOfLength(45);

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("fehlerhaft konfiguriert");
    // Both numbers, because the learner can already see one of them.
    expect(alert.textContent).toContain("0:45 Min.");
    expect(alert.textContent).toContain("25:45 Min.");
    // And that watching on will not help, which is the thing they would
    // otherwise try for twenty-five minutes.
    expect(alert.textContent).toContain("weiteres Ansehen ändert daran nichts");
  });

  it("stays silent when the file matches its configured length", () => {
    renderPlayer({ lesson: lesson({ durationSec: 1545 }) });
    playVideoOfLength(1545);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("stays silent when the gate is low enough that the file still satisfies it", () => {
    // 80 % of 100 s is 80 s, and the file has 90. Short of its authored length
    // and completable anyway — the case a naive "measured < configured" check
    // would have called broken.
    renderPlayer({ lesson: lesson({ durationSec: 100 }) });
    playVideoOfLength(90);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says nothing on a lesson that has no timeline to disagree about", () => {
    renderPlayer({ lesson: lesson({ kind: "text", sources: [], durationSec: 1545 }) });
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
