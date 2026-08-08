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
 * ## What is not here
 *
 * **Zur Teilprüfung.** The layout has it, locked, with "Wird nach Modul 3
 * freigeschaltet". A Teilprüfung is a *per-module* assessment and is explicitly
 * out of the 140 h scope (`docs/requirements/medice-adhs.md` §6.1); the quiz
 * engine models one course-level Lernerfolgskontrolle. Rendering a permanently
 * locked button for a feature that does not exist would be worse than omitting
 * it — the learner would wait for something that is never going to unlock.
 *
 * ## The tab locks are the server's
 *
 * The Lernerfolgskontrolle tab reads the quiz content's own `gate`, and the CME
 * Punktemeldung tab reads `quizPassed`. Both are fields the API produced. The
 * widget nowhere decides that finishing the modules unlocks the quiz — it
 * renders the decision (CLAUDE.md §4 invariant 1).
 */

import { useState } from "react";
import { clockTime } from "@ds/domain";
import type { ApiClient, CourseDetail, EnrolmentState, LessonContent } from "@ds/sdk";
import { de } from "../locale/de.js";
import { findQuizContent, locateContent, playbackDuration } from "../player.js";
import { LessonScreen, type PlaybackState } from "./LessonScreen.js";
import { Button, LockIcon } from "./primitives.js";

const CONTENT_TABS = ["summary", "quiz", "reporting"] as const;
type ContentTab = (typeof CONTENT_TABS)[number];

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
  const [tab, setTab] = useState<ContentTab>("summary");

  const here = locateContent(course, lesson.id);
  const quiz = findQuizContent(course, state);
  const duration = playbackDuration(lesson.durationSec, playback.durationSec);

  /** Undefined while the server still has the quiz locked. */
  const quizOpen =
    quiz === undefined || quiz.gate === "locked"
      ? undefined
      : () => props.onOpen(quiz.id);

  return (
    <div className="space-y-4">
      {/*
        The layout's progress card (§4.3): where you are, how far in, and a bar
        for the whole course. The bar is `state.progress.percent` — the
        server's course figure — and never the video's own position, which is
        what the "14:35 / 25:45" beside it already says. Drawing the playhead
        here would put two different quantities on one strip.
      */}
      <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm">
          {here === undefined ? null : (
            <p className="font-bold text-gray-900">
              {de.player.moduleOf(here.moduleIndex + 1, course.modules.length)}
            </p>
          )}

          {lesson.kind !== "video" ? null : (
            <p className="tabular-nums text-gray-700">
              <span className="sr-only">{de.player.positionLabel}: </span>
              {de.player.position(clockTime(playback.positionSec), clockTime(duration))}
            </p>
          )}
        </div>

        <div
          className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-gray-200"
          role="progressbar"
          aria-valuenow={state.progress.percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={de.player.courseProgress(state.progress.percent)}
        >
          <div
            className="h-full rounded-full bg-brand-600"
            style={{ width: `${String(state.progress.percent)}%` }}
          />
        </div>

        <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <p className="text-sm font-semibold text-brand-700">
            {de.player.courseProgress(state.progress.percent)}
          </p>
          <p className="text-xs text-gray-500">{de.player.autosave}</p>
        </div>
      </section>

      <LessonScreen
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
        The layout's one action under the video, and which one it is depends on
        the course's state (row 6.6): orange **Fortbildung pausieren** while
        there is still watching to do, teal **Lernerfolgskontrolle beginnen**
        once there is not.

        The switch is the **server's quiz gate**, not a percentage worked out
        here. The layout describes the swap as happening "at 100 %", and a
        client that decided that for itself would offer the exam to a learner
        the API is about to refuse — or, worse, would look right while the two
        disagreed about what 100 % means (union coverage, not playhead).
      */}
      <div className="flex flex-wrap gap-3">
        {quizOpen === undefined ? (
          lesson.kind !== "video" ? null : (
            <Button
              variant="cta"
              disabled={!playback.playing}
              onClick={() => setPaused(true)}
            >
              {de.player.pause}
            </Button>
          )
        ) : (
          <Button onClick={quizOpen}>{de.player.quizBegin}</Button>
        )}
        <Button variant="secondary" onClick={props.onBack}>
          {de.player.back}
        </Button>
      </div>

      <ContentTabs
        tab={tab}
        onTab={setTab}
        lesson={lesson}
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
        {CONTENT_TABS.map((entry) => (
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
