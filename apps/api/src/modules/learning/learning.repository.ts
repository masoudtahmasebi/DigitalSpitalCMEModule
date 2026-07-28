/**
 * Learning data access (P3). Infrastructure layer — ADR-0006.
 *
 * Rows in, rows out; every decision belongs to the service and `@ds/domain`.
 *
 * This reads the same tables as `catalog.repository.ts` but is deliberately a
 * separate reader rather than a shared one: catalog answers "what does this
 * course look like to a browser", learning answers "what does the compliance
 * core need to judge this learner". The shapes differ (durations and kinds
 * matter here, experts and marketing copy do not) and they will diverge
 * further. Sharing a query between them would couple a display change to a
 * compliance path.
 *
 * Everything runs inside the tenant transaction, so RLS scopes it (ADR-0002).
 */

import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db } from "../../db/tenant-db.js";
import {
  chapters,
  contentProgress,
  contents,
  courses,
  efnProfiles,
  enrolments,
  evaluationResponses,
  modules,
} from "../../db/schema.js";

/** The course settings snapshotted onto an enrolment at creation. */
export interface CourseComplianceRow {
  id: string;
  slug: string;
  requiredWatchPercent: number;
  passThresholdPercent: number;
  maxQuizAttempts: number | null;
  revealCorrectAnswers: boolean;
  cmePoints: number | null;
  cmeCategory: string | null;
  vnr: string | null;
}

export interface EnrolmentRow {
  id: string;
  courseId: string;
  userId: string;
  requiredWatchPercent: number;
  passThresholdPercent: number;
  maxQuizAttempts: number | null;
  completedAt: Date | null;
}

export interface TreeContentRow {
  id: string;
  chapterId: string;
  ordinal: number;
  kind: "video" | "text" | "quiz" | "details" | "material";
  durationSec: number | null;
  title: string;
  /** The lesson payload — only ever served through a gate check. */
  body: string | null;
  videoUrl: string | null;
  captionsUrl: string | null;
  /** Mediathek fields; null for anything that is not a download. */
  fileUrl: string | null;
  mimeType: string | null;
  fileSize: number | null;
}

export interface CourseTree {
  modules: Array<{ id: string; ordinal: number; title: string }>;
  chapters: Array<{ id: string; moduleId: string; ordinal: number }>;
  contents: TreeContentRow[];
}

export interface ProgressRow {
  contentId: string;
  status: "not_started" | "in_progress" | "completed";
  watchedPercent: number;
  watchedSegments: unknown;
  lastPositionSec: number;
  scorePercent: number | null;
  updatedAt: Date;
}

export interface LearningRepositoryPort {
  findCourseBySlug(slug: string): Promise<CourseComplianceRow | undefined>;
  findEnrolment(courseId: string, userId: string): Promise<EnrolmentRow | undefined>;
  createEnrolment(input: {
    customerId: string;
    courseId: string;
    userId: string;
    course: CourseComplianceRow;
  }): Promise<EnrolmentRow>;
  findCourseTree(courseId: string): Promise<CourseTree>;
  findProgress(enrolmentId: string): Promise<ProgressRow[]>;
  upsertProgress(input: {
    customerId: string;
    enrolmentId: string;
    contentId: string;
    status: "not_started" | "in_progress" | "completed";
    watchedPercent: number;
    watchedSegments: ReadonlyArray<{ startSec: number; endSec: number }>;
    lastPositionSec: number;
  }): Promise<void>;
  hasEfn(userId: string): Promise<boolean>;
  hasEvaluationResponse(enrolmentId: string): Promise<boolean>;
  markCompleted(
    enrolmentId: string,
    at: Date,
    attestedName: string | null,
  ): Promise<void>;
}

export class LearningRepository implements LearningRepositoryPort {
  constructor(private readonly db: Db) {}

  async findCourseBySlug(slug: string): Promise<CourseComplianceRow | undefined> {
    const [row] = await this.db
      .select({
        id: courses.id,
        slug: courses.slug,
        requiredWatchPercent: courses.requiredWatchPercent,
        passThresholdPercent: courses.passThresholdPercent,
        maxQuizAttempts: courses.maxQuizAttempts,
        revealCorrectAnswers: courses.revealCorrectAnswers,
        cmePoints: courses.cmePoints,
        cmeCategory: courses.cmeCategory,
        vnr: courses.vnr,
      })
      .from(courses)
      .where(eq(courses.slug, slug))
      .limit(1);

    return row;
  }

  async findEnrolment(
    courseId: string,
    userId: string,
  ): Promise<EnrolmentRow | undefined> {
    const [row] = await this.db
      .select({
        id: enrolments.id,
        courseId: enrolments.courseId,
        userId: enrolments.userId,
        requiredWatchPercent: enrolments.requiredWatchPercent,
        passThresholdPercent: enrolments.passThresholdPercent,
        maxQuizAttempts: enrolments.maxQuizAttempts,
        completedAt: enrolments.completedAt,
      })
      .from(enrolments)
      .where(and(eq(enrolments.courseId, courseId), eq(enrolments.userId, userId)))
      .limit(1);

    return row;
  }

  /**
   * Snapshots the course's compliance settings onto the enrolment.
   *
   * `onConflictDoNothing` on (course_id, user_id) makes concurrent first
   * requests resolve to one row rather than racing; the caller re-reads when
   * nothing came back.
   */
  async createEnrolment(input: {
    customerId: string;
    courseId: string;
    userId: string;
    course: CourseComplianceRow;
  }): Promise<EnrolmentRow> {
    const [row] = await this.db
      .insert(enrolments)
      .values({
        customerId: input.customerId,
        courseId: input.courseId,
        userId: input.userId,
        requiredWatchPercent: input.course.requiredWatchPercent,
        passThresholdPercent: input.course.passThresholdPercent,
        maxQuizAttempts: input.course.maxQuizAttempts,
        cmePoints: input.course.cmePoints,
        cmeCategory: input.course.cmeCategory,
        vnr: input.course.vnr,
      })
      .onConflictDoNothing({ target: [enrolments.courseId, enrolments.userId] })
      .returning({
        id: enrolments.id,
        courseId: enrolments.courseId,
        userId: enrolments.userId,
        requiredWatchPercent: enrolments.requiredWatchPercent,
        passThresholdPercent: enrolments.passThresholdPercent,
        maxQuizAttempts: enrolments.maxQuizAttempts,
        completedAt: enrolments.completedAt,
      });

    if (row !== undefined) return row;

    const existing = await this.findEnrolment(input.courseId, input.userId);
    if (existing === undefined) {
      throw new Error("createEnrolment: insert conflicted but no row is visible");
    }
    return existing;
  }

  async findCourseTree(courseId: string): Promise<CourseTree> {
    const moduleRows = await this.db
      .select({ id: modules.id, ordinal: modules.ordinal, title: modules.title })
      .from(modules)
      .where(eq(modules.courseId, courseId))
      .orderBy(asc(modules.ordinal));

    const moduleIds = moduleRows.map((row) => row.id);
    if (moduleIds.length === 0) return { modules: [], chapters: [], contents: [] };

    const chapterRows = await this.db
      .select({
        id: chapters.id,
        moduleId: chapters.moduleId,
        ordinal: chapters.ordinal,
      })
      .from(chapters)
      .where(inArray(chapters.moduleId, moduleIds))
      .orderBy(asc(chapters.ordinal));

    const chapterIds = chapterRows.map((row) => row.id);
    if (chapterIds.length === 0) {
      return { modules: moduleRows, chapters: [], contents: [] };
    }

    const contentRows = await this.db
      .select({
        id: contents.id,
        chapterId: contents.chapterId,
        ordinal: contents.ordinal,
        kind: contents.kind,
        durationSec: contents.durationSec,
        title: contents.title,
        // The lesson payload. Selected here rather than in a second query
        // because the gate decision needs the whole tree anyway, and a
        // separate read would be a second place that could forget the gate.
        body: contents.body,
        videoUrl: contents.videoUrl,
        captionsUrl: contents.captionsUrl,
        fileUrl: contents.fileUrl,
        mimeType: contents.mimeType,
        fileSize: contents.fileSize,
      })
      .from(contents)
      .where(inArray(contents.chapterId, chapterIds))
      .orderBy(asc(contents.ordinal));

    return {
      modules: moduleRows,
      chapters: chapterRows,
      contents: contentRows as TreeContentRow[],
    };
  }

  async findProgress(enrolmentId: string): Promise<ProgressRow[]> {
    const rows = await this.db
      .select({
        contentId: contentProgress.contentId,
        status: contentProgress.status,
        watchedPercent: contentProgress.watchedPercent,
        watchedSegments: contentProgress.watchedSegments,
        lastPositionSec: contentProgress.lastPositionSec,
        scorePercent: contentProgress.scorePercent,
        updatedAt: contentProgress.updatedAt,
      })
      .from(contentProgress)
      .where(eq(contentProgress.enrolmentId, enrolmentId));

    return rows as ProgressRow[];
  }

  async upsertProgress(input: {
    customerId: string;
    enrolmentId: string;
    contentId: string;
    status: "not_started" | "in_progress" | "completed";
    watchedPercent: number;
    watchedSegments: ReadonlyArray<{ startSec: number; endSec: number }>;
    lastPositionSec: number;
  }): Promise<void> {
    await this.db
      .insert(contentProgress)
      .values({
        customerId: input.customerId,
        enrolmentId: input.enrolmentId,
        contentId: input.contentId,
        status: input.status,
        watchedPercent: input.watchedPercent,
        watchedSegments: [...input.watchedSegments],
        lastPositionSec: input.lastPositionSec,
      })
      .onConflictDoUpdate({
        target: [contentProgress.enrolmentId, contentProgress.contentId],
        set: {
          status: input.status,
          watchedPercent: input.watchedPercent,
          watchedSegments: [...input.watchedSegments],
          lastPositionSec: input.lastPositionSec,
          updatedAt: new Date(),
        },
      });
  }

  async hasEfn(userId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ userId: efnProfiles.userId })
      .from(efnProfiles)
      .where(eq(efnProfiles.userId, userId))
      .limit(1);

    return row !== undefined;
  }

  async hasEvaluationResponse(enrolmentId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: evaluationResponses.id })
      .from(evaluationResponses)
      .where(eq(evaluationResponses.enrolmentId, enrolmentId))
      .limit(1);

    return row !== undefined;
  }

  /**
   * Stamp completion, and the attested name with it.
   *
   * One UPDATE rather than two: the name is what prints on the certificate for
   * this completion, so a crash between the two writes must not be able to
   * leave a completed enrolment carrying the wrong name. `null` leaves whatever
   * is stored alone — an omitted name is not an instruction to erase one.
   */
  async markCompleted(
    enrolmentId: string,
    at: Date,
    attestedName: string | null,
  ): Promise<void> {
    await this.db
      .update(enrolments)
      .set({
        completedAt: at,
        updatedAt: new Date(),
        ...(attestedName === null ? {} : { attestedName }),
      })
      .where(eq(enrolments.id, enrolmentId));
  }
}
