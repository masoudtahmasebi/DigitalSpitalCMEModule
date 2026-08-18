/**
 * The player screen (layout pages 06–07).
 *
 * The progress panel, the media, the one control under it, and the three
 * content tabs beneath.
 *
 * ## What moved out of here
 *
 * The **Modul Übersicht** sidebar and the teal masthead around it. They belong
 * to `CourseShell` in `App.tsx` now, because the layout draws them on five
 * screens — the player, the exam's four states and the Punktemeldung — and a
 * sidebar that lived here would have had to be rebuilt beside each of the
 * others, which is how two module lists end up disagreeing about which chapter
 * is unlocked (#61).
 *
 * ## The numbers in the progress panel, and where each comes from
 *
 * | Reading | Source |
 * | --- | --- |
 * | `Modul 3 von 5` | position in the catalogue tree — presentation, not a verdict |
 * | `14:35 / 25:45` | the media element's clock, against the **authored** length the watch gate uses |
 * | `… % der Fortbildung absolviert` | `progress.percent`, computed by the server |
 *
 * The third is a deliberate deviation from the layout, recorded as S16 in
 * `docs/show-stoppers.md`. The screen shows a bare `63% absolviert` whose
 * referent is not stated and which matches neither the video position beside it
 * nor anything else derivable from the screenshot. CLAUDE.md §7 forbids
 * guessing on a number a learner will trust, so this names the quantity it is
 * actually showing and keeps the layout's word. If MEDICE confirms a different
 * quantity, one locale entry and one prop change.
 *
 * ## The Lernerfolgskontrolle is this module's (P87)
 *
 * This header used to record the opposite, and the reasoning is worth keeping
 * because it was right when it was written: *"a Teilprüfung is a per-module
 * assessment and is explicitly out of the 140 h scope; the quiz engine models
 * one course-level Lernerfolgskontrolle"*, so the layout's locked
 * **Zur Teilprüfung** was deliberately not drawn — a learner must not be shown a
 * control waiting for something that will never unlock.
 *
 * The client asked for per-module assessment directly (P87), which makes it in
 * scope and makes the old shape a defect rather than a simplification: with one
 * course-wide search every module offered module 1's exam and no later exam was
 * reachable at all. The tab now follows the module — drawn when this one has a
 * Lernerfolgskontrolle, absent when it does not — which is the same judgement as
 * before, applied at the granularity the course now has.
 *
 * ## The tab locks are the server's
 *
 * The Lernerfolgskontrolle tab reads the quiz content's own `gate`, and the CME
 * Punktemeldung tab reads `quizPassed`. Both are fields the API produced. The
 * widget nowhere decides that finishing the modules unlocks the quiz — it
 * renders the decision (CLAUDE.md §4 invariant 1).
 */

import { useState } from "react";
import { germanMinutesAndSeconds, mediaLengthVerdict } from "@ds/domain";
import type { ApiClient, CourseDetail, EnrolmentState, LessonContent } from "@ds/sdk";
import { de } from "../locale/de.js";
import {
  findQuizContent,
  locateContent,
  nextAvailableContent,
  playbackDuration,
} from "../player.js";
import { useReportPlayerStatus } from "../player-status.js";
import { LessonScreen, type PlaybackState } from "./LessonScreen.js";
import { Button, LockIcon } from "./primitives.js";

const CONTENT_TABS = ["summary", "quiz", "reporting"] as const;
type ContentTab = (typeof CONTENT_TABS)[number];

/**
 * Which tabs this course actually has (P82-03).
 *
 * A course without a Lernerfolgskontrolle used to render the tab anyway,
 * padlocked, forever — reported as *"if a module does not have erfolgs
 * controlle, it should not appear"*. The padlock says "not yet", and for a
 * course with no quiz content there is no yet: nothing will ever unlock it.
 *
 * That is the same judgement the module header already records for
 * **Zur Teilprüfung**, which is deliberately not drawn because the feature does
 * not exist — *"the learner would wait for something that is never going to
 * unlock"*. The reasoning was written down and then not applied to the case
 * beside it (CLAUDE.md §9.2).
 *
 * The Punktemeldung tab follows it: with no Lernerfolgskontrolle there is no
 * `quizPassed` to reach, so the tab could only ever be locked as well.
 */
function tabsFor(hasQuiz: boolean): readonly ContentTab[] {
  return hasQuiz ? CONTENT_TABS : CONTENT_TABS.filter((tab) => tab === "summary");
}

export function PlayerScreen(props: {
  client: ApiClient;
  courseSlug: string;
  course: CourseDetail;
  state: EnrolmentState;
  lesson: LessonContent;
  onProgress: () => void;
  onOpen: (contentId: string) => void;
  onBack: () => void;
  /** Leaves the player for the completion step on the Zertifizierung tab. */
  onReporting: () => void;
}) {
  const { course, state, lesson } = props;

  const [playback, setPlayback] = useState<PlaybackState>({
    positionSec: lesson.lastPositionSec,
    durationSec: Number.NaN,
    playing: false,
    buffering: false,
    muted: false,
    volume: 1,
    rate: 1,
    ended: false,
  });
  const [paused, setPaused] = useState(false);
  /**
   * The session lapsed and nothing more will be credited (P62-05).
   *
   * One-way: a 401 arrives after the SDK has already spent its single refresh
   * attempt, so there is no state in which it goes back to false without a
   * reload — which is exactly what the message asks for.
   */
  const [authLost, setAuthLost] = useState(false);
  const [tab, setTab] = useState<ContentTab>("summary");

  // Scoped to the module this section is in (P87-02): a course with an exam on
  // every module must offer *this* module's, and a module without one must
  // offer none.
  const quiz = findQuizContent(course, state, lesson.id);
  /*
   * Where the learner goes after this section (P78-02).
   *
   * The server's gate decides which content that is; this only renders the
   * answer. `undefined` on the last section, or while the next module is still
   * locked — and then nothing is drawn, rather than a control that would be
   * refused (§9.2).
   */
  const next = nextAvailableContent(course, state, lesson.id);
  const duration = playbackDuration(lesson.durationSec, playback.durationSec);

  /**
   * Whether this section's gate can be satisfied by the file behind it
   * (P76-03).
   *
   * Both numbers are already here and were never compared: `lesson.durationSec`
   * is what the server computes the watch percentage against, and
   * `playback.durationSec` is what the browser found in the container. When the
   * first is larger, the gate asks for seconds the file does not contain, and
   * the learner watches a bar that cannot fill with nothing on screen to say
   * why (P75).
   *
   * `NaN` until `loadedmetadata`, which the rule reads as "cannot be sure" and
   * answers `ok` — so the notice appears when the browser knows the length, and
   * never flickers onto a course that is fine.
   *
   * This changes no gate and no percentage. It only says out loud what the
   * screen was already showing silently (CLAUDE.md §4 invariant 1).
   */
  const lengthVerdict = mediaLengthVerdict({
    configuredDurationSec: lesson.kind === "video" ? lesson.durationSec : null,
    measuredDurationSec: playback.durationSec,
    requiredWatchPercent: state.requiredWatchPercent,
  });

  /**
   * Which module's completion opens this section's exam — for the announcement
   * between the video and the tabs, and only while it is still shut.
   *
   * The exam's own module, not the learner's: `contentGates` blocks a module's
   * quiz on that module's videos, so that is the module the sentence is about.
   * They are the same module today, because `findQuizContent` is module-scoped
   * (P87-02); saying it from the quiz keeps the sentence true if that ever
   * stops being so.
   */
  const quizAt = quiz === undefined ? undefined : locateContent(course, quiz.id);
  const quizModule =
    quiz === undefined || quiz.gate !== "locked" || quizAt === undefined
      ? undefined
      : quizAt.moduleIndex + 1;

  /** Undefined while the server still has the quiz locked. */
  const quizOpen =
    quiz === undefined || quiz.gate === "locked"
      ? undefined
      : () => props.onOpen(quiz.id);

  /*
   * The one action the layout draws under the module list (P93-03, row 6.6):
   * orange **Fortbildung pausieren** while there is still watching to do, teal
   * **Lernerfolgskontrolle beginnen** once there is not.
   *
   * The switch is the **server's quiz gate**, not a percentage worked out here.
   * The layout describes the swap as happening "at 100 %", and a client that
   * decided that for itself would offer the exam to a learner the API is about
   * to refuse — or, worse, would look right while the two disagreed about what
   * 100 % means (union coverage, not playhead).
   *
   * A text lesson gets no pause, because there is nothing playing to pause.
   */
  const quizContentId = quiz?.id;
  useReportPlayerStatus(
    () => ({
      position:
        lesson.kind === "video"
          ? { positionSec: playback.positionSec, durationSec: duration }
          : undefined,
      autosaveFailed: authLost,
      action:
        quizOpen !== undefined
          ? {
              label: de.player.quizBegin,
              variant: "primary",
              disabled: false,
              run: quizOpen,
            }
          : lesson.kind === "video"
            ? {
                label: de.player.pause,
                variant: "cta",
                disabled: !playback.playing,
                run: () => setPaused(true),
              }
            : undefined,
    }),
    [
      lesson.kind,
      playback.positionSec,
      playback.playing,
      duration,
      authLost,
      quizContentId,
      quizOpen === undefined,
      props.onOpen,
    ],
  );

  return (
    <div className="space-y-4">
      {/*
        The section nobody can finish, said out loud (P76-03).

        Above the video on purpose: it explains the number the progress card
        shows — „0 % der Fortbildung absolviert" after a complete viewing — and
        since P93-03 that card is in the masthead directly above this, so the
        two are still read together. Below the player it would sit off-screen on
        a phone, which is where the learner is when they give up.

        `role="alert"` because it appears after `loadedmetadata` rather than at
        render, so a learner using a screen reader is not left with a silent
        change to a screen they have already heard. Only `unreachable` is shown
        here — `overrun` is an accreditation problem for the operator, and a
        learner who is not blocked cannot act on it (§9.10).
      */}
      {lengthVerdict.kind !== "unreachable" ? null : (
        <section
          role="alert"
          aria-label={de.player.lengthMisconfiguredLabel}
          className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
        >
          {de.player.lengthMisconfigured(
            germanMinutesAndSeconds(playback.durationSec),
            germanMinutesAndSeconds(lesson.durationSec ?? 0),
          )}
        </section>
      )}

      <LessonScreen
        onAuthLost={() => setAuthLost(true)}
        client={props.client}
        courseSlug={props.courseSlug}
        lesson={lesson}
        onProgress={props.onProgress}
        paused={paused}
        // The learner pressing the video's own play control clears the
        // chrome's pause, so the two never contradict each other.
        onPlayback={(next) => {
          setPlayback(next);
          if (next.playing) setPaused(false);
        }}
      />

      {/*
        When the exam opens, said where somebody looks for it (P93-03).

        `Player-Ansicht-Tab-Zusammenfassung-V2` draws this right-aligned between
        the video and the tabs: a sentence and a padlocked button. The
        Lernerfolgskontrolle tab beside it already announces itself as
        *gesperrt*, so the exam was never invisible — what nothing said is what
        unlocks it, which is CLAUDE.md §9.4.

        The module named is the exam's own, because `contentGates` blocks a
        module's quiz on that module's videos and nothing else. Drawn only while
        it is locked: once it opens, the action under the module list is
        **Lernerfolgskontrolle beginnen**, and a second control for the same
        thing on the same screen is how two of them end up disagreeing.
      */}
      {quizModule === undefined ? null : (
        <div className="flex flex-wrap items-center justify-end gap-3">
          <p className="text-sm text-gray-600">
            {de.player.examUnlocksAfter(quizModule)}
          </p>
          <Button variant="secondary" disabled>
            <LockIcon className="h-4 w-4" />
            {de.player.examLocked}
          </Button>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        {/*
          The way onward, when the server has one open (P78-02).

          Reported as *"i can not go forward"*: a finished section offered only
          „Fortbildung pausieren" and „Zurück zur Übersicht", so continuing
          meant returning to the outline and finding the next item by hand.

          The pause and the exam CTA left this row for the sidebar in P93-03,
          which is where the layout draws the primary action; this row is the
          two ways *out* of the section.
        */}
        {next === undefined ? null : (
          <Button variant="secondary" onClick={() => props.onOpen(next.id)}>
            {de.player.nextSection(next.title)}
          </Button>
        )}

        <Button variant="secondary" onClick={props.onBack}>
          {de.player.back}
        </Button>
      </div>

      <ContentTabs
        tab={tab}
        onTab={setTab}
        lesson={lesson}
        tabs={tabsFor(quiz !== undefined)}
        quizLocked={quiz === undefined || quiz.gate === "locked"}
        reportingLocked={!state.quizPassed}
        onQuiz={quizOpen}
        onReporting={props.onReporting}
      />
    </div>
  );
}

function ContentTabs(props: {
  tab: ContentTab;
  onTab: (tab: ContentTab) => void;
  lesson: LessonContent;
  /** The tabs this course has — see `tabsFor`. */
  tabs: readonly ContentTab[];
  quizLocked: boolean;
  reportingLocked: boolean;
  onQuiz: (() => void) | undefined;
  onReporting: () => void;
}) {
  const locked: Record<ContentTab, boolean> = {
    summary: false,
    quiz: props.quizLocked,
    reporting: props.reportingLocked,
  };

  return (
    <section>
      <div
        role="tablist"
        aria-label={de.player.tabsLabel}
        className="flex flex-wrap gap-2"
      >
        {props.tabs.map((entry) => (
          <button
            key={entry}
            type="button"
            role="tab"
            id={`ds-player-tab-${entry}`}
            aria-selected={props.tab === entry}
            aria-controls={`ds-player-panel-${entry}`}
            // A locked tab is still selectable: opening it is how the learner
            // finds out *why* it is locked. Marking it `disabled` would leave
            // the padlock as the only explanation, and a padlock does not say
            // what to do next.
            onClick={() => props.onTab(entry)}
            className={`flex items-center gap-2 rounded-t-xl px-5 py-2.5 text-sm font-semibold ${
              props.tab === entry
                ? "border border-b-0 border-gray-200 bg-white text-brand-700"
                : "bg-brand-600 text-brand-contrast hover:bg-brand-700"
            }`}
          >
            {locked[entry] ? (
              <>
                <LockIcon />
                <span className="sr-only">{de.player.tabLocked}, </span>
              </>
            ) : null}
            {de.player.tabs[entry]}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id={`ds-player-panel-${props.tab}`}
        aria-labelledby={`ds-player-tab-${props.tab}`}
        tabIndex={0}
        className="rounded-2xl rounded-tl-none border border-gray-200 bg-white p-5"
      >
        {props.tab === "summary" ? (
          <Summary lesson={props.lesson} />
        ) : props.tab === "quiz" ? (
          <Gated
            locked={props.quizLocked}
            reason={de.player.quizLocked}
            action={de.player.quizOpen}
            onAction={props.onQuiz}
          />
        ) : (
          <Gated
            locked={props.reportingLocked}
            reason={de.player.reportingLocked}
            action={de.player.reportingOpen}
            onAction={props.onReporting}
          />
        )}
      </div>
    </section>
  );
}

/**
 * The Zusammenfassung.
 *
 * A video's `body` is the summary written alongside it. A text lesson's `body`
 * *is* the lesson and is already rendered above, so repeating it here would
 * present the same prose twice as if it were two things.
 *
 * Rendered as text, never as HTML — same reasoning as `TextLesson`: authored
 * markup injected into a shadow root that holds a bearer token would make a
 * careless admin account a scripting vector.
 */
function Summary(props: { lesson: LessonContent }) {
  const body = props.lesson.kind === "video" ? (props.lesson.body ?? "") : "";
  const paragraphs = body.split(/\n{2,}/).filter((part) => part.trim() !== "");

  if (paragraphs.length === 0) {
    return <p className="text-sm text-gray-600">{de.player.noSummary}</p>;
  }

  return (
    <div className="space-y-3 text-sm leading-relaxed text-gray-800">
      {paragraphs.map((paragraph, index) => (
        // Paragraphs have no id and never reorder, so the index is stable.
        <p key={index}>{paragraph}</p>
      ))}
    </div>
  );
}

function Gated(props: {
  locked: boolean;
  reason: string;
  action: string;
  onAction: (() => void) | undefined;
}) {
  if (props.locked || props.onAction === undefined) {
    return (
      <p className="flex items-center gap-2 text-sm text-gray-600">
        <LockIcon className="h-4 w-4 shrink-0 text-status-locked" />
        {props.reason}
      </p>
    );
  }

  return <Button onClick={props.onAction}>{props.action}</Button>;
}
