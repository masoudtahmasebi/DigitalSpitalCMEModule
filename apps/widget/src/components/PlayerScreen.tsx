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
import { moduleHeading } from "../module-title.js";
import {
  contentProgressOf,
  findQuizContent,
  indexTitles,
  locateContent,
  nextAvailableContent,
  playbackDuration,
  passedQuizScore,
} from "../player.js";
import { useReportPlayerStatus } from "../player-status.js";
import { LessonScreen, type PlaybackState } from "./LessonScreen.js";
import { Button } from "./primitives.js";

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

  /**
   * This lesson is prose that has not been marked read yet (P167-01).
   *
   * Read from the enrolment state, which is where the server's answer lives, so
   * the disabled button and the sidebar's tick cannot disagree.
   */
  const readingAcknowledged = contentProgressOf(state, lesson.id)?.status === "completed";
  const readingPending =
    (lesson.kind === "text" || lesson.kind === "details") && !readingAcknowledged;

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

  // Scoped to the module this section is in (P87-02): a course with an exam on
  // every module must offer *this* module's, and a module without one must
  // offer none.
  const quiz = findQuizContent(course, state, lesson.id);
  /*
   * Whether that exam is already behind them (P176-01).
   *
   * `scorePercent` is recorded by `upsertQuizProgress` only when an attempt has
   * been graded, and the row carries the best of them — so its presence is the
   * server's own answer to "has this been sat". The *pass* is a comparison
   * against the course's threshold, and it lives in `passedQuizScore` rather
   * than here (P190-01): this screen had the comparison and the exam screen did
   * not, which is how a 60 % on an 85 % course came to read "bereits
   * bestanden".
   */
  const quizScore = quiz === undefined ? undefined : passedQuizScore(state, quiz.id);
  const quizPassed = quizScore !== undefined;
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

  /** Where this section sits, for the headings the layout draws under the video. */
  const here = locateContent(course, lesson.id);
  const titles = indexTitles(course);

  /** Undefined while the server still has the quiz locked. */
  const quizOpen =
    quiz === undefined || quiz.gate === "locked"
      ? undefined
      : () => props.onOpen(quiz.id);

  /*
   * The controls the layout draws under the module list (P95-02).
   *
   * The complete desktop layout stacks **both** once the exam opens: orange
   * *Lernerfolgskontrolle beginnen* above outlined *Fortbildung pausieren*.
   * P94-02 swapped one for the other, from an older export in which only one is
   * drawn — they are different actions, and a learner who wants to stop for
   * today should not have to give up the exam to find it.
   *
   * The gate is the **server's**, not a percentage worked out here. A client
   * that decided it for itself would offer the exam to a learner the API is
   * about to refuse — or, worse, would look right while the two disagreed about
   * what 100 % means (union coverage, not playhead).
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
      actions: [
        ...(quizOpen === undefined
          ? []
          : [
              {
                /*
                 * "beginnen" only while there is something to begin (P176-01).
                 *
                 * P170-01 closed the sitting once an exam is passed and took
                 * the button off the exam's own intro. This one is drawn by a
                 * different component, under the module list, and went on
                 * offering to *start* an exam whose screen then says it cannot
                 * be sat again — which is what the client met, both sentences
                 * on screen at once.
                 *
                 * The control is kept rather than hidden: the screen behind it
                 * carries the score and the way on to the Punktemeldung or the
                 * next section, and a physician who has just passed has every
                 * reason to open it. It is the verb that was wrong.
                 */
                label: quizPassed ? de.player.quizReview : de.player.quizBegin,
                variant: "cta" as const,
                disabled: false,
                run: quizOpen,
              },
            ]),
        ...(lesson.kind !== "video"
          ? []
          : [
              {
                label: de.player.pause,
                // Outlined, as drawn: the pause is the alternative to the
                // thing in the accent colour, never the thing itself.
                variant: "secondary" as const,
                disabled: !playback.playing,
                icon: "pause" as const,
                run: () => setPaused(true),
              },
            ]),
      ],
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
        acknowledged={readingAcknowledged}
        paused={paused}
        // The learner pressing the video's own play control clears the
        // chrome's pause, so the two never contradict each other.
        onPlayback={(next) => {
          setPlayback(next);
          if (next.playing) setPaused(false);
        }}
      />

      <div className="flex flex-wrap gap-3">
        {/*
          The way onward, when the server has one open (P78-02).

          Reported as *"i can not go forward"*: a finished section offered only
          „Fortbildung pausieren" and „Zurück zur Übersicht", so continuing
          meant returning to the outline and finding the next item by hand.

          The pause and the exam CTA left this row for the sidebar in P93-03,
          which is where the layout draws the primary action; this row is the
          two ways *out* of the section.

          **Never the exam** (P94-02). `nextAvailableContent` returns whatever
          the server has open, and once a module's video is done that is the
          module's Lernerfolgskontrolle — so this drew a second control for it,
          labelled with the exam's own title and nothing to say it *was* the
          exam. The client met it as "Weiter: Patienteninformation Modul 4 –
          Psychotherapie & Coaching", clicked it, and arrived at a
          Lernerfolgskontrolle they had not been told they were starting
          (§9.4). One exam, one control, and it is the orange one.
        */}
        {/*
          Disabled until a text section is acknowledged (P167-01, §S33).

          The client's own specification: *"the next button which is disabled
          becomes enabled and that counts as that part as done."* It is not a
          second rule — the server refuses to complete the course while a
          section is unread either way — it is the screen agreeing with the
          server at the point the person acts, rather than letting them walk
          past a condition and meet it at the end.

          Only for prose. A video's way onward is its own completion, and a
          disabled Weiter on a video would be a second, contradictory gate
          beside the watch percentage.
        */}
        {next === undefined || next.id === quiz?.id ? null : (
          <Button
            variant="secondary"
            disabled={readingPending}
            onClick={() => props.onOpen(next.id)}
          >
            {de.player.nextSection(next.title)}
          </Button>
        )}

        <Button variant="secondary" onClick={props.onBack}>
          {de.player.back}
        </Button>
      </div>

      {/*
        The Zusammenfassung, directly under the player (P95-01).

        It was a tab, beside **Lernerfolgskontrolle** and **CME Punktemeldung**.
        The complete desktop layout has no tab row at all: the module and
        chapter headings sit under the video with the text below them, the exam
        is a row in the Modul Übersicht, and the Punktemeldung is where the
        passed exam sends you. Three destinations, none of them a tab.

        That is the better shape for the reason P82-03 was about — the exam
        belongs to the course's structure, which is the column on the right,
        rather than to whichever section a learner happens to be watching. It
        also removes the last place where a padlocked control sat next to the
        thing it was not.
      */}
      <Summary lesson={lesson} here={here} titles={titles} />
    </div>
  );
}

/**
 * The module and chapter headings, and the section's prose (layout page 5).
 *
 * The drawing puts **Modul 3 – Therapie** in black above **Kapitel 2 –
 * Pharmakotherapie** in teal, then the text. Both come from the catalogue tree
 * the sidebar already reads, so a learner who has scrolled the video out of
 * view still knows where they are.
 *
 * A video's `body` is the summary written alongside it. A text lesson's `body`
 * *is* the lesson and is already rendered above, so repeating it here would
 * present the same prose twice as if it were two things.
 *
 * Rendered as text, never as HTML — same reasoning as `TextLesson`: authored
 * markup injected into a shadow root that holds a bearer token would make a
 * careless admin account a scripting vector.
 */
function Summary(props: {
  lesson: LessonContent;
  here: ReturnType<typeof locateContent>;
  titles: ReturnType<typeof indexTitles>;
}) {
  const body = props.lesson.kind === "video" ? (props.lesson.body ?? "") : "";
  const paragraphs = body.split(/\n{2,}/).filter((part) => part.trim() !== "");

  const moduleTitle =
    props.here === undefined
      ? undefined
      : moduleHeading(
          props.here.moduleIndex + 1,
          props.titles.modules.get(props.here.moduleId) ?? "",
        );
  const chapterTitle =
    props.here === undefined
      ? undefined
      : props.titles.chapters.get(props.here.chapterId);

  return (
    <section className="space-y-3">
      {moduleTitle === undefined ? null : (
        <h2 className="text-lg font-bold text-gray-900">{moduleTitle}</h2>
      )}
      {chapterTitle === undefined || chapterTitle === "" ? null : (
        <h3 className="text-sm font-semibold text-brand-700">{chapterTitle}</h3>
      )}

      {paragraphs.length === 0 ? (
        <p className="text-sm text-gray-600">{de.player.noSummary}</p>
      ) : (
        <div className="space-y-3 text-sm leading-relaxed text-gray-800">
          {paragraphs.map((paragraph, index) => (
            // Paragraphs have no id and never reorder, so the index is stable.
            <p key={index}>{paragraph}</p>
          ))}
        </div>
      )}
    </section>
  );
}
