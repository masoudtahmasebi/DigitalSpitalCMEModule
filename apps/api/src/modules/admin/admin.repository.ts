/**
 * Admin console data access (P9). Infrastructure layer — ADR-0006.
 *
 * Everything here runs inside the tenant transaction, so RLS scopes every read
 * and write to the caller's customer (ADR-0002). There is no `customer_id`
 * filter in these queries by choice: adding one would be defence in depth, and
 * writing it here would invite the belief that it is the defence.
 *
 * ## Why the participant list reads in batches
 *
 * The list needs each enrolment's stored progress to compute its figures
 * through the one rollup path. Reading that per enrolment would be one query
 * per participant. `findProgressByEnrolment` reads them all in a single query
 * and returns exactly the same `ProgressRow` shape the learner path uses, so
 * the rollup input is identical — only the fetch is batched.
 */

import { and, count, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../../db/tenant-db.js";
import {
  auditLog,
  certificates,
  chapters,
  contentProgress,
  contents,
  courses,
  efnProfiles,
  eivSubmissions,
  enrolments,
  evaluationResponses,
  modules,
  projects,
  users,
} from "../../db/schema.js";
import type { ProgressRow } from "../learning/learning.repository.js";

export interface AdminCourseRow {
  id: string;
  slug: string;
  /** Editorial state (P53-01): `draft` is invisible to every learner. */
  status: "draft" | "published";
  title: string;
  // Presentation — what the learner-facing layout draws (P13-01).
  description: string | null;
  deliveryType: "on_demand" | "live" | "praesenz";
  thema: string[];
  altersgruppe: string[];
  learningObjectives: string[];
  targetAudience: string | null;
  prerequisites: string | null;
  heroImageUrl: string | null;
  validFrom: Date | null;
  validTo: Date | null;
  vnr: string | null;
  cmePoints: number | null;
  cmeCategory: string | null;
  requiredWatchPercent: number;
  passThresholdPercent: number;
  maxQuizAttempts: number | null;
  revealCorrectAnswers: boolean;
  eivPunkteBasis: boolean;
  eivPunkteLernerfolg: boolean;
  organizer: string | null;
  eventLocation: string | null;
  accreditationBody: string | null;
  scientificLeadName: string | null;
  scientificLeadTitle: string | null;
  certificateIssuePlace: string | null;
  /**
   * Presence, not bytes. The query asks Postgres whether the column is null
   * rather than selecting a bytea the API would then have to remember not to
   * return — the safest place to not leak a value is to not read it.
   */
  hasStampImage: boolean;
  hasSignatureImage: boolean;
  hasVnrPassword: boolean;
}

export interface EnrolmentListRow {
  enrolmentId: string;
  userId: string;
  requiredWatchPercent: number;
  passThresholdPercent: number;
  /** The enrolment's snapshot — see `EnrolmentRow` in the learning repository. */
  cmePoints: number | null;
  completedAt: Date | null;
  /** When the course itself was finished (P51-01); null on older rows. */
  courseCompletedAt: Date | null;
  attestedName: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
}

export interface SubmissionStateRow {
  enrolmentId: string;
  status:
    | "queued"
    | "held"
    | "submitted"
    | "failed_retryable"
    | "failed_permanent"
    | "window_closed"
    | "withdrawn";
  attemptCount: number;
  reportDueAt: Date;
}

export interface CertificateStateRow {
  enrolmentId: string;
  status: "pending" | "issued" | "delivered" | "bounced";
}

/**
 * The white-label font as an admin sees it: whether one is stored, what it is
 * called, and when it changed. **Never the bytes.** The console renders a
 * preview by pointing an `@font-face` at `GET /branding/font`, the same way a
 * learner's browser does — putting a megabyte of base64 in a settings response
 * would be a different code path for the same file, and the one that matters
 * would be the untested one.
 */
export interface ProjectFontState {
  fontFamilyName: string | null;
  /** The upload timestamp, which doubles as the cache-busting version. */
  fontUpdatedAt: Date | null;
  fontBytes: number | null;
}

/**
 * A font upload, or its removal.
 *
 * All four values or all four nulls — the table's `font_all_or_nothing` CHECK
 * refuses anything in between, and a family name with no file would name a
 * family nothing declares.
 */
export interface ProjectFontPatch {
  fontFile: Buffer | null;
  fontMime: string | null;
  fontFamilyName: string | null;
  fontUpdatedAt: Date | null;
}

export interface AdminRepositoryPort {
  /** Every media URL on a course, in playing order (P62-03). */
  listCourseMediaUrls(courseId: string): Promise<string[]>;
  listCourses(): Promise<AdminCourseRow[]>;
  findCourse(slug: string): Promise<AdminCourseRow | undefined>;
  countEnrolments(
    courseIds: readonly string[],
  ): Promise<Map<string, { total: number; completed: number }>>;
  updateCourse(courseId: string, patch: CoursePatch): Promise<void>;
  setCertificateAssets(courseId: string, assets: CertificateAssetPatch): Promise<void>;
  findProjectFont(slug: string): Promise<ProjectFontState | undefined>;
  setProjectFont(
    slug: string,
    patch: ProjectFontPatch,
  ): Promise<ProjectFontState | undefined>;
  listEnrolments(courseId: string): Promise<EnrolmentListRow[]>;
  findProgressByEnrolment(
    enrolmentIds: readonly string[],
  ): Promise<Map<string, ProgressRow[]>>;
  findEvaluationSubmitted(enrolmentIds: readonly string[]): Promise<Set<string>>;
  findEfnPresent(userIds: readonly string[]): Promise<Set<string>>;
  findSubmissions(
    enrolmentIds: readonly string[],
  ): Promise<Map<string, SubmissionStateRow>>;
  findCertificates(
    enrolmentIds: readonly string[],
  ): Promise<Map<string, CertificateStateRow>>;
  audit(entry: {
    customerId: string;
    actorId: string;
    /** Which population `actorId` names (ADR-0012). Never `system` here. */
    actorIdentity: "learner" | "staff";
    action: string;
    subject: string;
    detail: Record<string, unknown>;
  }): Promise<void>;
}

export interface CoursePatch {
  /** Publish or retract (P53-01). */
  status?: "draft" | "published";
  title?: string;
  description?: string | null;
  deliveryType?: "on_demand" | "live" | "praesenz";
  thema?: string[];
  altersgruppe?: string[];
  learningObjectives?: string[];
  targetAudience?: string | null;
  prerequisites?: string | null;
  heroImageUrl?: string | null;
  cmePoints?: number | null;
  cmeCategory?: string | null;
  validFrom?: Date | null;
  validTo?: Date | null;
  requiredWatchPercent?: number;
  passThresholdPercent?: number;
  organizer?: string | null;
  eventLocation?: string | null;
  accreditationBody?: string | null;
  scientificLeadName?: string | null;
  scientificLeadTitle?: string | null;
  certificateIssuePlace?: string | null;
  vnr?: string | null;
  /** Already encrypted by the service — a repository never holds a plaintext secret. */
  vnrPasswordEnc?: Buffer;
  eivPunkteBasis?: boolean;
  eivPunkteLernerfolg?: boolean;
}

export interface CertificateAssetPatch {
  stampImage?: Buffer;
  stampImageMime?: string;
  signatureImage?: Buffer;
  signatureImageMime?: string;
}

const COURSE_COLUMNS = {
  id: courses.id,
  slug: courses.slug,
  status: courses.status,
  title: courses.title,
  description: courses.description,
  deliveryType: courses.deliveryType,
  thema: courses.thema,
  altersgruppe: courses.altersgruppe,
  learningObjectives: courses.learningObjectives,
  targetAudience: courses.targetAudience,
  prerequisites: courses.prerequisites,
  heroImageUrl: courses.heroImageUrl,
  validFrom: courses.validFrom,
  validTo: courses.validTo,
  vnr: courses.vnr,
  cmePoints: courses.cmePoints,
  cmeCategory: courses.cmeCategory,
  requiredWatchPercent: courses.requiredWatchPercent,
  passThresholdPercent: courses.passThresholdPercent,
  maxQuizAttempts: courses.maxQuizAttempts,
  revealCorrectAnswers: courses.revealCorrectAnswers,
  eivPunkteBasis: courses.eivPunkteBasis,
  eivPunkteLernerfolg: courses.eivPunkteLernerfolg,
  organizer: courses.organizer,
  eventLocation: courses.eventLocation,
  accreditationBody: courses.accreditationBody,
  scientificLeadName: courses.scientificLeadName,
  scientificLeadTitle: courses.scientificLeadTitle,
  certificateIssuePlace: courses.certificateIssuePlace,
  hasStampImage: sql<boolean>`${courses.stampImage} IS NOT NULL`,
  hasSignatureImage: sql<boolean>`${courses.signatureImage} IS NOT NULL`,
  hasVnrPassword: sql<boolean>`${courses.vnrPasswordEnc} IS NOT NULL`,
};

const PROJECT_FONT_COLUMNS = {
  fontFamilyName: projects.fontFamilyName,
  fontUpdatedAt: projects.fontUpdatedAt,
  fontBytes: sql<number | null>`octet_length(${projects.fontFile})`,
};

export class AdminRepository implements AdminRepositoryPort {
  constructor(private readonly db: Db) {}

  /**
   * Every media URL on a course, in playing order (P62-03).
   *
   * Ordered by module, chapter and content so the report an operator reads
   * follows the course rather than the physical row order. Inside the tenant
   * transaction like every other read here, so a slug from another customer
   * simply yields nothing (CLAUDE.md §9.6).
   */
  async listCourseMediaUrls(courseId: string): Promise<string[]> {
    const rows = await this.db
      .select({ sources: contents.mediaSources })
      .from(contents)
      .innerJoin(chapters, eq(chapters.id, contents.chapterId))
      .innerJoin(modules, eq(modules.id, chapters.moduleId))
      .where(and(eq(modules.courseId, courseId), eq(contents.kind, "video")))
      .orderBy(modules.ordinal, chapters.ordinal, contents.ordinal);

    const urls: string[] = [];
    for (const row of rows) {
      if (!Array.isArray(row.sources)) continue;
      for (const source of row.sources) {
        const url = (source as { url?: unknown }).url;
        if (typeof url === "string" && url !== "") urls.push(url);
      }
    }
    return urls;
  }

  async listCourses(): Promise<AdminCourseRow[]> {
    return this.db.select(COURSE_COLUMNS).from(courses).orderBy(courses.title);
  }

  async findCourse(slug: string): Promise<AdminCourseRow | undefined> {
    const [row] = await this.db
      .select(COURSE_COLUMNS)
      .from(courses)
      .where(eq(courses.slug, slug))
      .limit(1);
    return row;
  }

  async countEnrolments(
    courseIds: readonly string[],
  ): Promise<Map<string, { total: number; completed: number }>> {
    if (courseIds.length === 0) return new Map();

    const rows = await this.db
      .select({
        courseId: enrolments.courseId,
        total: count(),
        completed: sql<number>`count(${enrolments.completedAt})::int`,
      })
      .from(enrolments)
      .where(inArray(enrolments.courseId, [...courseIds]))
      .groupBy(enrolments.courseId);

    return new Map(
      rows.map((row) => [row.courseId, { total: row.total, completed: row.completed }]),
    );
  }

  async updateCourse(courseId: string, patch: CoursePatch): Promise<void> {
    // An empty patch would produce `UPDATE ... SET WHERE`, which is a syntax
    // error rather than a no-op.
    if (Object.keys(patch).length === 0) return;

    await this.db
      .update(courses)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(courses.id, courseId));
  }

  async setCertificateAssets(
    courseId: string,
    assets: CertificateAssetPatch,
  ): Promise<void> {
    if (Object.keys(assets).length === 0) return;

    await this.db
      .update(courses)
      .set({ ...assets, updatedAt: new Date() })
      .where(eq(courses.id, courseId));
  }

  /**
   * The project's font metadata.
   *
   * `octet_length` rather than selecting the column: the size is what an admin
   * screen wants and the bytes are what it must not be handed. Asking Postgres
   * for the length keeps a megabyte out of the response by construction rather
   * than by remembering to drop it (CLAUDE.md §4 invariant 7 is about secrets,
   * but the same reasoning applies to anything large enough to be a mistake).
   */
  async findProjectFont(slug: string): Promise<ProjectFontState | undefined> {
    const [row] = await this.db
      .select(PROJECT_FONT_COLUMNS)
      .from(projects)
      .where(eq(projects.slug, slug))
      .limit(1);
    return row;
  }

  /**
   * Store or clear the font. Scoped by RLS, not by a `customer_id` filter — a
   * slug belonging to another tenant matches zero rows and the caller gets the
   * same "not found" as for a slug that does not exist (ADR-0002, ADR-0007).
   */
  async setProjectFont(
    slug: string,
    patch: ProjectFontPatch,
  ): Promise<ProjectFontState | undefined> {
    const [row] = await this.db
      .update(projects)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(projects.slug, slug))
      .returning(PROJECT_FONT_COLUMNS);
    return row;
  }

  async listEnrolments(courseId: string): Promise<EnrolmentListRow[]> {
    return this.db
      .select({
        enrolmentId: enrolments.id,
        userId: enrolments.userId,
        requiredWatchPercent: enrolments.requiredWatchPercent,
        passThresholdPercent: enrolments.passThresholdPercent,
        cmePoints: enrolments.cmePoints,
        completedAt: enrolments.completedAt,
        courseCompletedAt: enrolments.courseCompletedAt,
        attestedName: enrolments.attestedName,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
      })
      .from(enrolments)
      .innerJoin(users, eq(users.id, enrolments.userId))
      .where(eq(enrolments.courseId, courseId))
      .orderBy(enrolments.createdAt);
  }

  async findProgressByEnrolment(
    enrolmentIds: readonly string[],
  ): Promise<Map<string, ProgressRow[]>> {
    if (enrolmentIds.length === 0) return new Map();

    const rows = await this.db
      .select({
        enrolmentId: contentProgress.enrolmentId,
        contentId: contentProgress.contentId,
        status: contentProgress.status,
        watchedPercent: contentProgress.watchedPercent,
        watchedSegments: contentProgress.watchedSegments,
        lastPositionSec: contentProgress.lastPositionSec,
        scorePercent: contentProgress.scorePercent,
        updatedAt: contentProgress.updatedAt,
      })
      .from(contentProgress)
      .where(inArray(contentProgress.enrolmentId, [...enrolmentIds]));

    const grouped = new Map<string, ProgressRow[]>();
    for (const { enrolmentId, ...progress } of rows) {
      const existing = grouped.get(enrolmentId);
      if (existing === undefined) grouped.set(enrolmentId, [progress as ProgressRow]);
      else existing.push(progress as ProgressRow);
    }
    return grouped;
  }

  async findEvaluationSubmitted(enrolmentIds: readonly string[]): Promise<Set<string>> {
    if (enrolmentIds.length === 0) return new Set();

    const rows = await this.db
      .selectDistinct({ enrolmentId: evaluationResponses.enrolmentId })
      .from(evaluationResponses)
      .where(inArray(evaluationResponses.enrolmentId, [...enrolmentIds]));

    return new Set(rows.map((row) => row.enrolmentId));
  }

  /**
   * Which of these users have an EFN on file.
   *
   * Returns ids, never the EFN itself. `efn_profiles` is not customer-scoped
   * (one physician, one EFN, across customers — see completion.repository.ts),
   * so this is the one query here that must filter explicitly: RLS is not
   * doing it, and reading it by user id is what keeps that safe.
   */
  async findEfnPresent(userIds: readonly string[]): Promise<Set<string>> {
    if (userIds.length === 0) return new Set();

    const rows = await this.db
      .select({ userId: efnProfiles.userId })
      .from(efnProfiles)
      .where(inArray(efnProfiles.userId, [...userIds]));

    return new Set(rows.map((row) => row.userId));
  }

  async findSubmissions(
    enrolmentIds: readonly string[],
  ): Promise<Map<string, SubmissionStateRow>> {
    if (enrolmentIds.length === 0) return new Map();

    const rows = await this.db
      .select({
        enrolmentId: eivSubmissions.enrolmentId,
        status: eivSubmissions.status,
        attemptCount: eivSubmissions.attemptCount,
        reportDueAt: eivSubmissions.reportDueAt,
      })
      .from(eivSubmissions)
      .where(inArray(eivSubmissions.enrolmentId, [...enrolmentIds]));

    return new Map(rows.map((row) => [row.enrolmentId, row]));
  }

  async findCertificates(
    enrolmentIds: readonly string[],
  ): Promise<Map<string, CertificateStateRow>> {
    if (enrolmentIds.length === 0) return new Map();

    const rows = await this.db
      .select({
        enrolmentId: certificates.enrolmentId,
        status: certificates.status,
      })
      .from(certificates)
      .where(inArray(certificates.enrolmentId, [...enrolmentIds]));

    return new Map(rows.map((row) => [row.enrolmentId, row]));
  }

  /**
   * Append-only. `detail` carries ids and counts — never an EFN, a name, a
   * password or a free-text evaluation answer (ADR-0004).
   */
  async audit(entry: {
    customerId: string;
    actorId: string;
    /**
     * Which population `actorId` names (ADR-0012). Never `system` here: this
     * path only runs for a request that already has a principal.
     */
    actorIdentity: "learner" | "staff";
    action: string;
    subject: string;
    detail: Record<string, unknown>;
  }): Promise<void> {
    await this.db.insert(auditLog).values(entry);
  }
}
