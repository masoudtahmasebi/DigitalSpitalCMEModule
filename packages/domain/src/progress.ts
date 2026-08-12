/**
 * Progress rollup (P3-04).
 *
 * `CLAUDE.md` §4 invariant 6: one rollup path. The learner's own view and the
 * admin participant list both call this function over the same repository
 * method. Two implementations would eventually disagree, and disagreeing
 * numbers on a CME participation record is a compliance problem, not a display
 * bug — so there is exactly one place where a status is derived.
 *
 * Percentages are content-weighted at every level: a module's percentage is
 * completed content items over total content items beneath it, not the mean of
 * its chapters' percentages. Averaging percentages would let a chapter with one
 * item count as much as a chapter with twenty.
 */

import type {
  ChapterNode,
  ContentProgressRecord,
  ContentStatus,
  CourseNode,
  ModuleNode,
} from "./types.js";
import type { GatingItem } from "./gating.js";

export interface ProgressSummary {
  readonly status: ContentStatus;
  readonly completedCount: number;
  readonly totalCount: number;
  /** Integer 0–100, content-weighted. */
  readonly percent: number;
  /** Present for video content only. */
  readonly watchedPercent?: number;
  /** Present for quiz content only. */
  readonly scorePercent?: number;
}

/**
 * Module-level counts for the "Ihr Fortschritt — 2 von 5" ring.
 *
 * The design counts *modules*, while `ProgressSummary.percent` is
 * content-weighted. Both are correct for their own purpose and they will not
 * agree — 2 of 5 modules is 40 %, but those two modules might hold 60 % of the
 * course's content items. The ring is therefore fed from here rather than from
 * `course.percent`, so the widget cannot accidentally render one as the other.
 */
export interface ModuleCompletion {
  readonly completed: number;
  readonly total: number;
}

export interface CourseRollup {
  readonly course: ProgressSummary;
  /** Feeds "Sie haben X von Y Modulen abgeschlossen". */
  readonly moduleCompletion: ModuleCompletion;
  readonly modules: Readonly<Record<string, ProgressSummary>>;
  readonly chapters: Readonly<Record<string, ProgressSummary>>;
  readonly contents: Readonly<Record<string, ProgressSummary>>;
}

export function rollupProgress(
  course: CourseNode,
  progress: readonly ContentProgressRecord[],
): CourseRollup {
  const byContentId = new Map(progress.map((record) => [record.contentId, record]));

  const contents: Record<string, ProgressSummary> = {};
  const chapters: Record<string, ProgressSummary> = {};
  const modules: Record<string, ProgressSummary> = {};

  let courseCompleted = 0;
  let courseTotal = 0;

  for (const module of course.modules) {
    let moduleCompleted = 0;
    let moduleTotal = 0;

    for (const chapter of module.chapters) {
      let chapterCompleted = 0;

      for (const content of chapter.contents) {
        const record = byContentId.get(content.id);
        const status: ContentStatus = record?.status ?? "not_started";

        contents[content.id] = {
          status,
          completedCount: status === "completed" ? 1 : 0,
          totalCount: 1,
          percent: status === "completed" ? 100 : 0,
          ...(record?.watchedPercent === undefined
            ? {}
            : { watchedPercent: record.watchedPercent }),
          ...(record?.scorePercent === undefined
            ? {}
            : { scorePercent: record.scorePercent }),
        };

        if (status === "completed") chapterCompleted += 1;
      }

      const chapterTotal = chapter.contents.length;
      chapters[chapter.id] = summarise(chapterCompleted, chapterTotal, () =>
        anyStartedIn(
          byContentId,
          chapter.contents.map((content) => content.id),
        ),
      );

      moduleCompleted += chapterCompleted;
      moduleTotal += chapterTotal;
    }

    modules[module.id] = summarise(moduleCompleted, moduleTotal, () =>
      anyStartedIn(
        byContentId,
        module.chapters.flatMap((chapter) =>
          chapter.contents.map((content) => content.id),
        ),
      ),
    );

    courseCompleted += moduleCompleted;
    courseTotal += moduleTotal;
  }

  /*
   * "Started" means the same thing at every level (P68-02).
   *
   * It did not. Modules and chapters ask whether **any content** has left
   * `not_started`; the course asked whether any content had been *completed* —
   * so a physician who had watched half of a one-module course was reported as
   * `not_started` by the course summary and `in_progress` by the module inside
   * it, from the same rollup, in the same response.
   *
   * The visible consequence was small and exactly the kind of thing nobody
   * files: the hero button said **Fortbildung starten** next to a panel saying
   * "50 % der Videoinhalte angesehen". The rule underneath is not small —
   * CLAUDE.md §4 invariant 6 is that there is one rollup path, and two levels
   * of one rollup disagreeing about what a word means is that invariant being
   * false inside a single function.
   *
   * One predicate now, passed to all three levels.
   */
  const courseSummary = summarise(courseCompleted, courseTotal, () =>
    anyStartedIn(
      byContentId,
      course.modules.flatMap((module) =>
        module.chapters.flatMap((chapter) =>
          chapter.contents.map((content) => content.id),
        ),
      ),
    ),
  );

  const moduleCompletion: ModuleCompletion = {
    completed: course.modules.filter(
      (module) => modules[module.id]?.status === "completed",
    ).length,
    total: course.modules.length,
  };

  return { course: courseSummary, moduleCompletion, modules, chapters, contents };
}

/**
 * Has anything in this subtree been touched?
 *
 * One implementation for the course, the module and the chapter — see the
 * comment at the course summary for what three copies of it cost.
 */
function anyStartedIn(
  byContentId: ReadonlyMap<string, ContentProgressRecord>,
  contentIds: readonly string[],
): boolean {
  return contentIds.some(
    (id) => (byContentId.get(id)?.status ?? "not_started") !== "not_started",
  );
}

/**
 * A course with no content reports 0 %, never `NaN`. An empty course is an
 * authoring state that occurs in the admin console every time a course is
 * created, so it must not produce a division error on the learner side.
 */
function summarise(
  completed: number,
  total: number,
  anyStarted: () => boolean,
): ProgressSummary {
  if (total === 0) {
    return { status: "not_started", completedCount: 0, totalCount: 0, percent: 0 };
  }

  const status: ContentStatus =
    completed === total ? "completed" : anyStarted() ? "in_progress" : "not_started";

  return {
    status,
    completedCount: completed,
    totalCount: total,
    percent: Math.floor((completed / total) * 100),
  };
}

/**
 * Flatten a course into the ordered chapter sequence that gating runs over.
 *
 * Gating is sequential across the whole course, not restarted per module, so
 * modules are ordered first and their chapters follow in order within them.
 */
export function courseChapterSequence(
  course: CourseNode,
  rollup: CourseRollup,
): readonly GatingItem[] {
  const sequence: GatingItem[] = [];
  let ordinal = 0;

  for (const module of orderedModules(course)) {
    for (const chapter of orderedChapters(module)) {
      sequence.push({
        id: chapter.id,
        ordinal: ordinal++,
        completed: rollup.chapters[chapter.id]?.status === "completed",
      });
    }
  }

  return sequence;
}

function orderedModules(course: CourseNode): readonly ModuleNode[] {
  return [...course.modules].sort((a, b) => a.ordinal - b.ordinal);
}

function orderedChapters(module: ModuleNode): readonly ChapterNode[] {
  return [...module.chapters].sort((a, b) => a.ordinal - b.ordinal);
}
