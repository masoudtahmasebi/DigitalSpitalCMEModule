/**
 * The player screen (layout §4.3).
 *
 * The media, the progress panel above it, the **Modul Übersicht** sidebar, the
 * two controls, and the three content tabs beneath.
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
import { ModuleSidebar } from "./ModuleSidebar.js";
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
  });
  const [paused, setPaused] = useState(false);
  const [tab, setTab] = useState<ContentTab>("summary");

  const here = locateContent(course, lesson.id);
  const quiz = findQuizContent(course, state);
  const duration = playbackDuration(lesson.durationSec, playback.durationSec);

  return (
    <div className="space-y-4">
      <section className="rounded-[var(--ds-radius)] border border-gray-200 bg-gray-50 p-4">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
          {here === undefined ? null : (
            <p className="font-semibold text-gray-900">
              {de.player.moduleOf(here.moduleIndex + 1, course.modules.length)}
            </p>
          )}

          {lesson.kind !== "video" ? null : (
            <p className="tabular-nums text-gray-700">
              <span className="sr-only">{de.player.positionLabel}: </span>
              {de.player.position(clockTime(playback.positionSec), clockTime(duration))}
            </p>
          )}

          <p className="text-gray-700">
            {de.player.courseProgress(state.progress.percent)}
          </p>
        </div>

        <p className="mt-1 text-xs text-gray-500">{de.player.autosave}</p>
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0 space-y-4">
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

          <div className="flex flex-wrap gap-3">
            {lesson.kind !== "video" ? null : (
              <Button
                variant="secondary"
                disabled={!playback.playing}
                onClick={() => setPaused(true)}
              >
                {de.player.pause}
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
            quizLocked={quiz === undefined || quiz.gate === "locked"}
            reportingLocked={!state.quizPassed}
            onQuiz={quiz === undefined ? undefined : () => props.onOpen(quiz.id)}
            onReporting={props.onReporting}
          />
        </div>

        <ModuleSidebar
          course={course}
          state={state}
          currentContentId={lesson.id}
          onOpen={props.onOpen}
        />
      </div>
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
        className="flex flex-wrap gap-1 border-b border-gray-200"
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
            className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium ${
              props.tab === entry
                ? "border-brand-600 text-brand-700"
                : "border-transparent text-gray-600"
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
        className="pt-4"
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
