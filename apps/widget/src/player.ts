/**
 * The player screen's derivations (layout §4.3).
 *
 * Separate from the components because every one of these is a question with a
 * right answer that a rendering test would not ask: *which* module is "Modul 3
 * von 5" counting, and which of four icons an item gets. Both are read by a
 * learner as a statement about their own progress, and both are easy to get
 * subtly wrong in JSX where nothing checks them.
 *
 * Nothing here decides anything. `itemIcon` maps a gate and a status the
 * **server** produced onto a glyph; it never infers a gate from progress, and a
 * locked item stays locked whatever else is true. `locateContent` walks the
 * catalogue tree the browse response already returned. Neither reads a clock,
 * fetches, or holds state — the same reasons `packages/domain` is pure apply
 * one layer out, even though this file is allowed to import SDK types.
 */

import type {
  ContentKind,
  CourseDetail,
  EnrolmentState,
  GateStatus,
  ProgressSummary,
} from "@ds/sdk";

/**
 * The five states the sidebar draws.
 *
 * The layout names four — completed (check), in progress (play), locked
 * (padlock), paused. `available` is the fifth because the layout's screenshot
 * happens not to contain one: an item the learner may reach but has not opened.
 * Giving it the "in progress" play glyph would tell them they had started
 * something they had not.
 */
export type ItemState = "completed" | "playing" | "paused" | "available" | "locked";

export interface ContentLocation {
  readonly moduleId: string;
  /** Zero-based. `moduleIndex + 1` is the "3" in "Modul 3 von 5". */
  readonly moduleIndex: number;
  readonly chapterId: string;
}

/**
 * Where a content sits in the course tree.
 *
 * The player needs this to say "Modul 3 von 5" and to open the sidebar on the
 * right module. It searches rather than being told, because the screen graph
 * navigates by content id alone — a module id threaded through every call site
 * would be a second copy of this fact, free to disagree with the first.
 *
 * `undefined` for an unknown id rather than a guess: a caller that cannot place
 * the content shows no module counter, which is better than showing the wrong
 * one.
 */
export function locateContent(
  course: Pick<CourseDetail, "modules">,
  contentId: string,
): ContentLocation | undefined {
  for (const [moduleIndex, module] of course.modules.entries()) {
    for (const chapter of module.chapters) {
      for (const content of chapter.contents) {
        if (content.id === contentId) {
          return { moduleId: module.id, moduleIndex, chapterId: chapter.id };
        }
      }
    }
  }
  return undefined;
}

/**
 * A module's position in the course, zero-based (P115-01).
 *
 * The one source for a module's number. `locateContent` answers this for the
 * content a learner is looking at; the sidebar needs it for every module in a
 * list that is **not** `course.modules` — the enrolment state — and used its own
 * position in that list instead. The two disagreed on a real course, and the
 * symptom was the sidebar and the heading below the video naming the same
 * module differently.
 *
 * `undefined` when the module is not in the course, for the same reason
 * `locateContent` returns it: a caller that cannot place the module should
 * decide what to do, not be handed a plausible wrong answer.
 */
export function moduleNumber(
  course: Pick<CourseDetail, "modules">,
  moduleId: string,
): number | undefined {
  const at = course.modules.findIndex((module) => module.id === moduleId);
  return at === -1 ? undefined : at;
}

/**
 * Which glyph an outline item gets.
 *
 * The order of the tests is the whole content of this function:
 *
 * 1. **Locked wins over everything.** A locked item with stale progress on it —
 *    a chapter reordered behind one the learner has not finished — is locked.
 *    Drawing a check on it would say the gate had been satisfied.
 * 2. **Completed beats current.** Re-opening a finished video must not turn its
 *    check back into a play arrow; the learner would read that as the
 *    completion having been withdrawn.
 * 3. **Current is playing, started-but-not-current is paused.** The layout
 *    distinguishes them, and this is the only reading that makes "paused" mean
 *    something: it is where the learner stopped, waiting to be resumed.
 */
export function itemIcon(input: {
  gate: GateStatus;
  progress: Pick<ProgressSummary, "status">;
  current: boolean;
}): ItemState {
  if (input.gate === "locked") return "locked";
  if (input.gate === "completed" || input.progress.status === "completed") {
    return "completed";
  }
  if (input.current) return "playing";
  if (input.progress.status === "in_progress") return "paused";
  return "available";
}

export interface ContentMeta {
  readonly title: string;
  readonly kind: ContentKind;
}

export interface CourseTitles {
  readonly modules: ReadonlyMap<string, string>;
  readonly chapters: ReadonlyMap<string, string>;
  readonly contents: ReadonlyMap<string, ContentMeta>;
}

/**
 * Titles and kinds, by id.
 *
 * Two responses describe the same tree and neither duplicates the other: the
 * catalogue carries titles and kinds, the enrolment carries gates and progress.
 * Every outline in the widget therefore has to zip them, and this is the one
 * place that does it — the Zertifizierung tab and the player's sidebar were
 * otherwise building the same three maps from the same loop.
 *
 * The catalogue is deliberately the side without URLs (see `ContentSummary` in
 * the contract), so nothing reachable through these maps can leak a gated file.
 */
export function indexTitles(course: Pick<CourseDetail, "modules">): CourseTitles {
  const modules = new Map<string, string>();
  const chapters = new Map<string, string>();
  const contents = new Map<string, ContentMeta>();

  for (const module of course.modules) {
    modules.set(module.id, module.title);
    for (const chapter of module.chapters) {
      chapters.set(chapter.id, chapter.title);
      for (const content of chapter.contents) {
        contents.set(content.id, { title: content.title, kind: content.kind });
      }
    }
  }

  return { modules, chapters, contents };
}

export interface QuizLocation {
  readonly id: string;
  readonly gate: GateStatus;
}

/**
 * **This module's** Lernerfolgskontrolle, if it has one, with the server's gate
 * (P87-02).
 *
 * The player's second content tab is the quiz, and it has to know both where it
 * is and whether it is open yet. The gate is looked up in `EnrolmentState`
 * rather than inferred from module completion here — the API decides what is
 * reachable, and a second rule in the widget would be a client-side gate that
 * happened to agree until it did not.
 *
 * ## Why the search is scoped to one module now
 *
 * It used to return the **first** quiz in the whole course, on the reasoning
 * that the quiz engine models one course-level Lernerfolgskontrolle and a
 * per-module Teilprüfung was out of scope. The client has since asked for one
 * per module directly — *"each module part, can have quiz or not, if it has the
 * tab is shown, if not it is not shown"* — and the old search makes that shape
 * unfinishable: every module offers module 1's exam, and no later exam is
 * reachable by any route.
 *
 * `undefined` when this module has none, which is what draws no tab at all
 * rather than a padlock on something that will never unlock (P82-03, now at
 * module granularity).
 *
 * `undefined` also for a content id that is not in the course — a caller that
 * cannot place the learner shows no exam, which is the same judgement
 * `locateContent` makes one function up and for the same reason.
 */
export function findQuizContent(
  course: Pick<CourseDetail, "modules">,
  state: {
    modules: readonly {
      chapters: readonly { contents: readonly { id: string; gate: GateStatus }[] }[];
    }[];
  },
  currentContentId: string,
): QuizLocation | undefined {
  const gates = new Map<string, GateStatus>();
  for (const module of state.modules) {
    for (const chapter of module.chapters) {
      for (const content of chapter.contents) gates.set(content.id, content.gate);
    }
  }

  const here = locateContent(course, currentContentId);
  if (here === undefined) return undefined;

  const module = course.modules.find((entry) => entry.id === here.moduleId);
  if (module === undefined) return undefined;

  for (const chapter of module.chapters) {
    for (const content of chapter.contents) {
      if (content.kind !== "quiz") continue;
      const gate = gates.get(content.id);
      // No gate means the enrolment does not know this content — treat it as
      // locked rather than as open.
      return { id: content.id, gate: gate ?? "locked" };
    }
  }
  return undefined;
}

/**
 * The next content a learner may actually open, in course order (P78-02).
 *
 * ## Why this exists
 *
 * Finishing a section left the learner nowhere to go. The only controls under
 * the video were „Fortbildung pausieren" and „Zurück zur Übersicht", so
 * advancing meant going back to the outline and finding the next item by hand —
 * which was reported, accurately, as *"i can not go forward"*.
 *
 * ## Why it reads the enrolment's gates and decides nothing
 *
 * The candidate must be `available` **according to the server**. This walks the
 * catalogue for order and the enrolment for permission, exactly as
 * `findQuizContent` does one function up, and for the same reason: a widget
 * that worked out for itself what comes next would offer a section the API is
 * about to refuse, or — worse — look right while the two quietly disagreed
 * (CLAUDE.md §4 invariant 1).
 *
 * ## The quiz is on the way now (P87-03)
 *
 * This used to `continue` past a `quiz`, so that finishing a video never slid
 * the learner into an exam they had not chosen to start. That reasoning holds
 * for a course with one exam at the end — and it is what makes a course with an
 * exam on every module impossible: after module 1's last video, **Weiter**
 * jumped over module 1's Lernerfolgskontrolle to a module the server has
 * locked, found nothing available, and drew no control at all.
 *
 * The learner is not dropped into an exam by this: the button says
 * „Weiter: ‹Lernerfolgskontrolle›" and opens the quiz's **start** screen, which
 * is a page with a „… starten" button on it. Choosing to go on is still a
 * click, and it is now a click that exists.
 *
 * The server's gate is unchanged and still decides: a quiz that P87-04 holds
 * shut is not `available`, so it is not offered here either.
 *
 * Returns `undefined` when nothing further is open — the last section, or a
 * course whose next module is still locked — and the caller then offers
 * nothing rather than a control that would refuse.
 */
export function nextAvailableContent(
  course: Pick<CourseDetail, "modules">,
  state: {
    modules: readonly {
      chapters: readonly { contents: readonly { id: string; gate: GateStatus }[] }[];
    }[];
  },
  currentContentId: string,
): { readonly id: string; readonly title: string } | undefined {
  const gates = new Map<string, GateStatus>();
  for (const module of state.modules) {
    for (const chapter of module.chapters) {
      for (const content of chapter.contents) gates.set(content.id, content.gate);
    }
  }

  const ordered = course.modules.flatMap((module) =>
    module.chapters.flatMap((chapter) => chapter.contents),
  );

  const here = ordered.findIndex((content) => content.id === currentContentId);
  if (here === -1) return undefined;

  for (const content of ordered.slice(here + 1)) {
    if (gates.get(content.id) !== "available") continue;
    return { id: content.id, title: content.title };
  }
  return undefined;
}

/**
 * The video's length, preferring the authored figure.
 *
 * `lesson.durationSec` is what the server computes the watch percentage
 * against. The media element's own `duration` can differ — a re-encode, a
 * container reporting a different length — and if the two disagree the learner
 * must see the one the gate uses, or "25:45" and "80 % angesehen" become two
 * numbers about different videos.
 *
 * The element's duration is the fallback only, for content authored before
 * lengths were required. `NaN` before metadata loads is handled by `clockTime`.
 */
/**
 * The best score already recorded against one quiz, if there is one (P164-04).
 *
 * A physician who has finished the course and holds the certificate still meets
 * a bare **Lernerfolgskontrolle beginnen**, which reads as an outstanding task
 * on a course that has none. The intro needs to know the exam is already passed
 * in order to say so — and the figure, because "you passed" without the score
 * invites the retake it is trying to explain away.
 *
 * Read from the enrolment state rather than the quiz payload: `Quiz` carries
 * `attemptsUsed` and no score, and `ProgressSummary.scorePercent` is already
 * the best attempt the server stored. A second source would be a second answer
 * to "what did they get" (§4 invariant 6).
 */
export function recordedQuizScore(
  state: Pick<EnrolmentState, "modules">,
  contentId: string,
): number | undefined {
  for (const module of state.modules) {
    for (const chapter of module.chapters) {
      for (const content of chapter.contents) {
        if (content.id === contentId) return content.progress.scorePercent;
      }
    }
  }
  return undefined;
}

export function playbackDuration(authoredSec: number | null, elementSec: number): number {
  if (authoredSec !== null && authoredSec > 0) return authoredSec;
  return Number.isFinite(elementSec) ? elementSec : 0;
}
