/**
 * The learning use case (P3). Application layer — ADR-0006.
 *
 * This service orchestrates; it decides nothing. Every compliance question —
 * how much was watched, what is unlocked, whether the course is complete — is
 * answered by a pure function in `@ds/domain`. What lives here is the
 * sequencing: load rows, hand them to the core, persist what comes back.
 *
 * That split is the point. If a rule is wrong, there is exactly one file to
 * fix and it has exhaustive unit tests; if the plumbing is wrong, no CME
 * outcome silently changes with it.
 */

import {
  courseChapterSequence,
  courseWatchCoverage,
  evaluateSequence,
  isCourseComplete,
  mergeWatchedSegments,
  rollupProgress,
  validateSegments,
  watchedPercent,
  type ContentProgressRecord,
  type ContentSegments,
  type CourseNode,
  type CourseRollup,
  type GateResult,
  type WatchedSegment,
} from "@ds/domain";
import { AppError } from "../../shared/problem-details.js";
import type { Db } from "../../db/tenant-db.js";
import {
  LearningRepository,
  type CourseTree,
  type EnrolmentRow,
  type LearningRepositoryPort,
  type ProgressRow,
} from "./learning.repository.js";
import type {
  ChapterState,
  ContentState,
  EnrolmentState,
  Material,
  MaterialLibrary,
  ModuleState,
  ProgressReport,
  ProgressResult,
} from "./learning.dto.js";

/** Identity the use case acts for. Never taken from a request body. */
export interface LearnerContext {
  readonly customerId: string;
  readonly userId: string;
}

export class LearningService {
  constructor(private readonly repository: LearningRepositoryPort) {}

  static fromDb(db: Db): LearningService {
    return new LearningService(new LearningRepository(db));
  }

  /**
   * Enrol, or return the existing enrolment unchanged.
   *
   * The course's settings are copied onto the enrolment here and never read
   * live again (P3-01): a learner who starts under a 70 % threshold finishes
   * under it, even if an admin edits the course mid-course.
   */
  async enrol(slug: string, learner: LearnerContext): Promise<EnrolmentState> {
    const course = await this.requireCourse(slug);

    const existing = await this.repository.findEnrolment(course.id, learner.userId);
    const enrolment =
      existing ??
      (await this.repository.createEnrolment({
        customerId: learner.customerId,
        courseId: course.id,
        userId: learner.userId,
        course,
      }));

    return this.buildState(slug, course.id, enrolment, learner);
  }

  async getState(slug: string, learner: LearnerContext): Promise<EnrolmentState> {
    const course = await this.requireCourse(slug);
    const enrolment = await this.requireEnrolment(course.id, learner.userId);

    return this.buildState(slug, course.id, enrolment, learner);
  }

  /**
   * Record which intervals of a video were actually played.
   *
   * Three things happen in order, and the order matters:
   *
   * 1. **Gate check.** Reporting progress against locked content is refused —
   *    otherwise the sequence gate could be walked around by posting progress
   *    for a later chapter directly.
   * 2. **Validation.** `validateSegments` rejects the impossible (inverted,
   *    out of bounds) and the implausible (more playback than wall-clock time
   *    since the last report, which is what a scripted client produces).
   * 3. **Union merge.** Accepted intervals join the stored union and the
   *    percentage is recomputed from it — never taken from the request.
   */
  async recordProgress(
    slug: string,
    contentId: string,
    report: ProgressReport,
    learner: LearnerContext,
    now: Date,
  ): Promise<ProgressResult> {
    const { enrolment, content, stored } = await this.requireReachableContent(
      slug,
      contentId,
      learner,
      "video",
    );

    if (content.durationSec === null || content.durationSec <= 0) {
      throw new AppError(
        "internal",
        `content=${contentId} is video but has no usable duration`,
      );
    }

    const existing = stored.find((row) => row.contentId === contentId);
    const previousSegments = readSegments(existing?.watchedSegments);

    // Wall-clock budget: how much playback could plausibly have happened since
    // this content was last written. A first report gets the video's own
    // duration as its budget rather than zero, since we have no earlier
    // timestamp to measure from.
    const elapsedWallClockSec =
      existing === undefined
        ? content.durationSec
        : Math.max(0, (now.getTime() - existing.updatedAt.getTime()) / 1000);

    const validation = validateSegments(report.segments, {
      durationSec: content.durationSec,
      elapsedWallClockSec,
    });

    const merged = mergeWatchedSegments([...previousSegments, ...validation.accepted]);
    const percent = watchedPercent(merged, content.durationSec);

    // A video counts as done at full coverage. The course-level requirement
    // (which may be lower) is applied by the completion gate, not here — this
    // status is about this one video.
    const status =
      percent >= 100 ? "completed" : percent > 0 ? "in_progress" : "not_started";

    await this.repository.upsertProgress({
      customerId: learner.customerId,
      enrolmentId: enrolment.id,
      contentId,
      status,
      watchedPercent: percent,
      watchedSegments: merged,
      lastPositionSec: Math.floor(report.lastPositionSec ?? 0),
    });

    return {
      contentId,
      watchedPercent: percent,
      status,
      accepted: validation.accepted.length,
      rejected: validation.rejected.map((entry) => ({
        segment: entry.segment,
        reason: entry.reason,
      })),
    };
  }

  /**
   * Resolve a piece of content the learner may currently act on, or throw.
   *
   * The single entry point for "is this allowed" — the player, the quiz and
   * anything added later all come through here, so the sequence gate has one
   * implementation rather than one per feature. Two gates would eventually
   * disagree, and a gate that disagrees with itself is a compliance incident.
   *
   * Returns the loaded rows too, so the caller does not re-query what this
   * already had to read in order to decide.
   */
  async requireReachableContent(
    slug: string,
    contentId: string,
    learner: LearnerContext,
    expectedKind: "video" | "quiz",
  ) {
    const course = await this.requireCourse(slug);
    const enrolment = await this.requireEnrolment(course.id, learner.userId);

    const tree = await this.repository.findCourseTree(course.id);
    const content = tree.contents.find((row) => row.id === contentId);
    if (content === undefined) {
      // Content outside this course is a 404, not a 403: the caller learns
      // nothing about whether it exists elsewhere.
      throw AppError.notFound(`content=${contentId} is not part of course=${slug}`);
    }
    if (content.kind !== expectedKind) {
      throw new AppError(
        "validation",
        `content=${contentId} is kind=${content.kind}, not ${expectedKind}`,
        `Dieser Inhalt ist keine ${expectedKind === "video" ? "Videolektion" : "Lernerfolgskontrolle"}.`,
      );
    }

    const stored = await this.repository.findProgress(enrolment.id);
    const courseNode = toCourseNode(tree);
    const rollup = rollupProgress(courseNode, toProgressRecords(stored, tree));

    this.assertReachable(courseNode, rollup, tree, contentId);

    return { course, enrolment, tree, content, stored, rollup };
  }

  /**
   * The Mediathek (P5): downloads grouped by module, locked until that module
   * is complete.
   *
   * A locked item comes back **without its `fileUrl`**. Returning the URL
   * alongside `locked: true` and trusting the client to hide it would not be a
   * gate — the JSON is readable by anyone holding the token. Withholding the
   * URL is what makes the padlock mean something.
   */
  async getMaterials(slug: string, learner: LearnerContext): Promise<MaterialLibrary> {
    const course = await this.requireCourse(slug);
    const enrolment = await this.requireEnrolment(course.id, learner.userId);

    const [tree, stored] = await Promise.all([
      this.repository.findCourseTree(course.id),
      this.repository.findProgress(enrolment.id),
    ]);

    const courseNode = toCourseNode(tree);
    const rollup = rollupProgress(courseNode, toProgressRecords(stored, tree));

    const groups = tree.modules.map((module) => {
      // A module's material unlocks when the module's own content is done —
      // not when the whole course is, which would make the Mediathek useless
      // until the very end.
      const locked = rollup.modules[module.id]?.status !== "completed";

      const chapterIds = new Set(
        tree.chapters
          .filter((chapter) => chapter.moduleId === module.id)
          .map((chapter) => chapter.id),
      );

      const materials: Material[] = tree.contents
        .filter(
          (content) => content.kind === "material" && chapterIds.has(content.chapterId),
        )
        .map((content) => ({
          id: content.id,
          title: content.title,
          locked,
          fileUrl: locked ? null : content.fileUrl,
          mimeType: content.mimeType,
          fileSize: content.fileSize,
        }));

      return {
        moduleId: module.id,
        moduleTitle: module.title,
        ordinal: module.ordinal,
        locked,
        materials,
      };
    });

    // Modules with nothing to download do not become empty padlocked sections.
    return { courseSlug: slug, groups: groups.filter((g) => g.materials.length > 0) };
  }

  /**
   * Stamped by the completion service once every condition is satisfied.
   *
   * `attestedName` is the name the learner confirmed for their certificate, or
   * `null` to keep whatever is stored.
   */
  async markCompleted(
    enrolmentId: string,
    at: Date,
    attestedName: string | null,
  ): Promise<void> {
    await this.repository.markCompleted(enrolmentId, at, attestedName);
  }

  /** Shared by the quiz, evaluation and completion services. */
  async requireCourse(slug: string) {
    const course = await this.repository.findCourseBySlug(slug);
    if (course === undefined) {
      // Not visible in this tenant is indistinguishable from not existing.
      throw AppError.notFound(`course slug=${slug} not visible in this tenant`);
    }
    return course;
  }

  async requireEnrolment(courseId: string, userId: string): Promise<EnrolmentRow> {
    const enrolment = await this.repository.findEnrolment(courseId, userId);
    if (enrolment === undefined) {
      throw AppError.notFound(`user=${userId} is not enrolled on course=${courseId}`);
    }
    return enrolment;
  }

  /**
   * Refuse to act on content the learner cannot currently reach.
   *
   * Gating is evaluated over the whole course's chapter sequence, so this also
   * covers the "post directly to a later module" case, not only the UI's own
   * next/previous navigation.
   */
  private assertReachable(
    courseNode: CourseNode,
    rollup: CourseRollup,
    tree: CourseTree,
    contentId: string,
  ): void {
    const chapterId = tree.contents.find((row) => row.id === contentId)?.chapterId;
    if (chapterId === undefined) return;

    const gates = evaluateSequence(courseChapterSequence(courseNode, rollup));
    const gate = gates.get(chapterId);

    if (gate?.status === "locked") {
      throw new AppError(
        "gate_locked",
        `chapter=${chapterId} is locked${gate.blockedBy === undefined ? "" : ` by ${gate.blockedBy}`}`,
        "Diese Inhalte werden nach Abschluss der vorherigen Module freigeschaltet.",
      );
    }
  }

  private async buildState(
    slug: string,
    courseId: string,
    enrolment: EnrolmentRow,
    learner: LearnerContext,
  ): Promise<EnrolmentState> {
    const [tree, stored, efnPresent, evaluationSubmitted] = await Promise.all([
      this.repository.findCourseTree(courseId),
      this.repository.findProgress(enrolment.id),
      this.repository.hasEfn(learner.userId),
      this.repository.hasEvaluationResponse(enrolment.id),
    ]);

    const courseNode = toCourseNode(tree);
    const records = toProgressRecords(stored, tree);
    const rollup = rollupProgress(courseNode, records);
    const gates = evaluateSequence(courseChapterSequence(courseNode, rollup));

    const coverage = courseWatchCoverage(courseNode, toContentSegments(stored));
    const quizPassed = hasPassedQuiz(records, tree, enrolment.passThresholdPercent);

    const completion = isCourseComplete({
      requiredWatchPercent: enrolment.requiredWatchPercent,
      achievedWatchPercent: coverage.percent,
      quizPassed,
      evaluationSubmitted,
      efnPresent,
    });

    const modules = buildModuleStates(tree, rollup, gates);

    return {
      enrolmentId: enrolment.id,
      courseSlug: slug,
      requiredWatchPercent: enrolment.requiredWatchPercent,
      passThresholdPercent: enrolment.passThresholdPercent,
      achievedWatchPercent: coverage.percent,
      quizPassed,
      evaluationSubmitted,
      efnPresent,
      complete: completion.complete,
      outstanding: [...completion.outstanding],
      completedAt: enrolment.completedAt?.toISOString() ?? null,
      progress: rollup.course,
      moduleCompletion: rollup.moduleCompletion,
      modules,
      resumeContentId: firstReachableIncomplete(tree, rollup, gates),
    };
  }
}

/**
 * Is this content a step the learner completes, or a resource attached to one?
 *
 * `material` is a Mediathek download. It has no completion event — nothing
 * happens when a PDF is fetched that could mark it done — so including it in
 * the compliance tree would make its chapter permanently incomplete, which
 * would in turn lock every later module forever. The Mediathek serves these
 * from the raw tree and gates them on the module's own completion instead.
 *
 * Every traversal that feeds progress, gating or the resume target goes
 * through this predicate, so the three cannot disagree about what counts.
 */
function isComplianceContent(
  content: CourseTree["contents"][number],
): content is CourseTree["contents"][number] & {
  kind: "video" | "text" | "quiz" | "details";
} {
  return content.kind !== "material";
}

/** Maps flat rows into the tree shape `@ds/domain` consumes. */
export function toCourseNode(tree: CourseTree): CourseNode {
  return {
    id: "course",
    modules: tree.modules.map((module) => ({
      id: module.id,
      ordinal: module.ordinal,
      chapters: tree.chapters
        .filter((chapter) => chapter.moduleId === module.id)
        .map((chapter) => ({
          id: chapter.id,
          ordinal: chapter.ordinal,
          contents: tree.contents
            .filter((content) => content.chapterId === chapter.id)
            .filter(isComplianceContent)
            .map((content) => ({
              id: content.id,
              kind: content.kind,
              ...(content.durationSec === null
                ? {}
                : { durationSec: content.durationSec }),
            })),
        })),
    })),
  };
}

function toProgressRecords(
  rows: readonly ProgressRow[],
  tree: CourseTree,
): readonly ContentProgressRecord[] {
  const known = new Set(tree.contents.map((content) => content.id));

  return rows
    .filter((row) => known.has(row.contentId))
    .map((row) => ({
      contentId: row.contentId,
      status: row.status,
      watchedPercent: row.watchedPercent,
      ...(row.scorePercent === null ? {} : { scorePercent: row.scorePercent }),
    }));
}

function toContentSegments(rows: readonly ProgressRow[]): readonly ContentSegments[] {
  return rows.map((row) => ({
    contentId: row.contentId,
    segments: readSegments(row.watchedSegments),
  }));
}

/**
 * Read stored segments defensively.
 *
 * The column is `jsonb`, so its shape is not guaranteed by the type system.
 * A malformed row degrades to "nothing watched" rather than throwing —
 * unreadable history must not make a course impossible to continue.
 */
export function readSegments(value: unknown): readonly WatchedSegment[] {
  if (!Array.isArray(value)) return [];

  return value.filter(
    (entry): entry is WatchedSegment =>
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as WatchedSegment).startSec === "number" &&
      typeof (entry as WatchedSegment).endSec === "number",
  );
}

/** A course is quiz-passed when every quiz content has a passing best score. */
function hasPassedQuiz(
  records: readonly ContentProgressRecord[],
  tree: CourseTree,
  passThresholdPercent: number,
): boolean {
  const quizIds = tree.contents
    .filter((content) => content.kind === "quiz")
    .map((content) => content.id);

  // No quiz means nothing to pass; the watch and evaluation gates still stand.
  if (quizIds.length === 0) return true;

  const byContent = new Map(records.map((record) => [record.contentId, record]));

  return quizIds.every((id) => {
    const score = byContent.get(id)?.scorePercent;
    return score !== undefined && score >= passThresholdPercent;
  });
}

function buildModuleStates(
  tree: CourseTree,
  rollup: CourseRollup,
  gates: ReadonlyMap<string, GateResult>,
): ModuleState[] {
  const empty = {
    status: "not_started" as const,
    completedCount: 0,
    totalCount: 0,
    percent: 0,
  };

  return tree.modules.map((module) => {
    const moduleChapters = tree.chapters.filter(
      (chapter) => chapter.moduleId === module.id,
    );

    const chapterStates: ChapterState[] = moduleChapters.map((chapter) => {
      const gate = gates.get(chapter.id);
      const contentStates: ContentState[] = tree.contents
        .filter(
          (content) => content.chapterId === chapter.id && isComplianceContent(content),
        )
        .map((content) => ({
          id: content.id,
          // Content inherits its chapter's gate: the sequence is evaluated at
          // chapter granularity, so a content item is exactly as reachable as
          // the chapter containing it.
          gate: gate?.status ?? "available",
          progress: rollup.contents[content.id] ?? empty,
        }));

      return {
        id: chapter.id,
        gate: gate?.status ?? "available",
        ...(gate?.blockedBy === undefined ? {} : { blockedBy: gate.blockedBy }),
        progress: rollup.chapters[chapter.id] ?? empty,
        contents: contentStates,
      };
    });

    // A module is locked when every chapter in it is; if any chapter is
    // reachable the module must render as reachable too, or the tree would
    // show a padlock on something the learner can open.
    const moduleGate = chapterStates.every((chapter) => chapter.gate === "locked")
      ? "locked"
      : chapterStates.every((chapter) => chapter.gate === "completed")
        ? "completed"
        : "available";

    return {
      id: module.id,
      gate: chapterStates.length === 0 ? "available" : moduleGate,
      progress: rollup.modules[module.id] ?? empty,
      chapters: chapterStates,
    };
  });
}

/**
 * Where "Fortbildung fortsetzen" jumps to: the first incomplete content in an
 * unlocked chapter, in course order. Null when nothing is left to do.
 */
function firstReachableIncomplete(
  tree: CourseTree,
  rollup: CourseRollup,
  gates: ReadonlyMap<string, GateResult>,
): string | null {
  for (const module of tree.modules) {
    for (const chapter of tree.chapters.filter((row) => row.moduleId === module.id)) {
      if (gates.get(chapter.id)?.status === "locked") continue;

      for (const content of tree.contents.filter(
        (row) => row.chapterId === chapter.id && isComplianceContent(row),
      )) {
        if (rollup.contents[content.id]?.status !== "completed") return content.id;
      }
    }
  }
  return null;
}
