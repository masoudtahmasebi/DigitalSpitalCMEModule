/**
 * Catalog data access (P2-05). Infrastructure layer — ADR-0006.
 *
 * Rows in, rows out. **No business decisions here.** Whether a chapter is
 * locked, whether a learner passed, what counts as complete — all of that is
 * `packages/domain`, called by the service.
 *
 * Every query runs inside the tenant transaction opened by `runInTenant`, so
 * PostgreSQL RLS scopes it (ADR-0002). The `eq(courses.customerId, …)` filters
 * below are **defence in depth, not the guarantee** — remove them and the
 * queries still return only the caller's tenant, which is exactly the property
 * the P10-02 suite asserts.
 */

import { and, asc, count, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../../db/tenant-db.js";
import {
  chapters,
  contents,
  courseExperts,
  courses,
  enrolments,
  modules,
} from "../../db/schema.js";

export interface CourseRow {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  heroImageUrl: string | null;
  learningObjectives: string[];
  targetAudience: string | null;
  prerequisites: string | null;
  fortbildungsnummer: string | null;
  deliveryType: "on_demand" | "live" | "praesenz";
  thema: string[];
  altersgruppe: string[];
  cmePoints: number | null;
  cmeCategory: string | null;
  vnr: string | null;
  accreditationBody: string | null;
  organizer: string | null;
  eventLocation: string | null;
  validFrom: Date | null;
  validTo: Date | null;
  requiredWatchPercent: number;
  passThresholdPercent: number;
}

export interface CourseTreeRows {
  course: CourseRow;
  modules: Array<{
    id: string;
    ordinal: number;
    title: string;
    subtitle: string | null;
  }>;
  chapters: Array<{ id: string; moduleId: string; ordinal: number; title: string }>;
  contents: Array<{
    id: string;
    chapterId: string;
    ordinal: number;
    kind: "video" | "text" | "quiz" | "details" | "material";
    title: string;
    durationSec: number | null;
    mimeType: string | null;
  }>;
  experts: Array<{
    id: string;
    ordinal: number;
    roleLabel: string;
    name: string;
    institution: string | null;
    biography: string | null;
    photoUrl: string | null;
  }>;
}

export interface CourseListFilter {
  thema?: string;
  altersgruppe?: string;
  /** A set, because one tab can group several — see `catalog.dto.ts`. */
  deliveryType?: readonly ("on_demand" | "live" | "praesenz")[];
  limit: number;
  offset: number;
}

/** What is being asked for, without the page. Facets are counted under this. */
export type CourseSelection = Omit<CourseListFilter, "limit" | "offset">;

/**
 * The port the service depends on. Declaring it lets the service be unit-tested
 * with a fake, which is what keeps the fast suite fast (ADR-0006).
 */
export interface CatalogRepositoryPort {
  listCourses(filter: CourseListFilter): Promise<{
    rows: CourseRow[];
    total: number;
    durations: Map<string, { moduleCount: number; totalDurationSec: number }>;
  }>;
  facets(selection: CourseSelection): Promise<{
    thema: Array<{ value: string; count: number }>;
    altersgruppe: Array<{ value: string; count: number }>;
  }>;
  findCourseTree(slug: string): Promise<CourseTreeRows | undefined>;
  findEnrolments(
    courseIds: readonly string[],
    userId: string,
  ): Promise<Map<string, { complete: boolean }>>;
}

export class CatalogRepository implements CatalogRepositoryPort {
  constructor(private readonly db: Db) {}

  /**
   * Which of these courses the caller is enrolled on, and which are finished.
   *
   * One query for the whole page rather than one per card. Scoped to the user
   * explicitly *and* by RLS: `enrolments` is tenant-isolated, and the
   * `user_id` filter is what stops a caller seeing another learner's standing
   * within their own tenant — that part is not RLS's job.
   */
  async findEnrolments(
    courseIds: readonly string[],
    userId: string,
  ): Promise<Map<string, { complete: boolean }>> {
    if (courseIds.length === 0) return new Map();

    const rows = await this.db
      .select({ courseId: enrolments.courseId, completedAt: enrolments.completedAt })
      .from(enrolments)
      .where(
        and(inArray(enrolments.courseId, [...courseIds]), eq(enrolments.userId, userId)),
      );

    return new Map(
      rows.map((row) => [row.courseId, { complete: row.completedAt !== null }]),
    );
  }

  async listCourses(filter: CourseListFilter) {
    const where = whereFor(filter);

    const rows = (await this.db
      .select()
      .from(courses)
      .where(where)
      .orderBy(asc(courses.title))
      .limit(filter.limit)
      .offset(filter.offset)) as unknown as CourseRow[];

    const [totalRow] = await this.db
      .select({ value: count() })
      .from(courses)
      .where(where);

    return {
      rows,
      total: totalRow?.value ?? 0,
      durations: await this.aggregate(rows.map((row) => row.id)),
    };
  }

  /** Module count and total video duration per course, for the card metadata line. */
  private async aggregate(courseIds: string[]) {
    const result = new Map<string, { moduleCount: number; totalDurationSec: number }>();
    if (courseIds.length === 0) return result;

    const rows = await this.db
      .select({
        courseId: modules.courseId,
        moduleCount: sql<number>`count(distinct ${modules.id})::int`,
        totalDurationSec: sql<number>`coalesce(sum(${contents.durationSec}), 0)::int`,
      })
      .from(modules)
      .leftJoin(chapters, eq(chapters.moduleId, modules.id))
      .leftJoin(contents, eq(contents.chapterId, chapters.id))
      .where(inArray(modules.courseId, courseIds))
      .groupBy(modules.courseId);

    for (const row of rows) {
      result.set(row.courseId, {
        moduleCount: row.moduleCount,
        totalDurationSec: row.totalDurationSec,
      });
    }
    return result;
  }

  /**
   * Facet values and their counts, each counted under the *other* filters.
   *
   * The `thema` counts apply the delivery-type tab and the chosen
   * Altersgruppe but not the chosen Thema, and vice versa. That is the
   * standard faceted-search rule and it exists to stop the control offering
   * dead ends: without it a learner can pick two values that each report a
   * non-zero count and land on "keine Fortbildungen".
   *
   * Excluding a facet's own axis is what keeps the currently chosen value in
   * its own list. Counting it under itself would leave the dropdown showing
   * one option — the one already selected — with no way back to a sibling.
   */
  async facets(selection: CourseSelection) {
    const countOver = async (
      column: typeof courses.thema | typeof courses.altersgruppe,
      under: CourseSelection,
    ) =>
      this.db
        .select({
          value: sql<string>`unnest(${column})`,
          count: sql<number>`count(*)::int`,
        })
        .from(courses)
        .where(whereFor(under))
        .groupBy(sql`1`)
        // Ordered in SQL so the dropdown is stable between requests. Postgres
        // makes no promise about the order of a grouped result, and a filter
        // whose options reshuffle on every keystroke is its own bug report.
        .orderBy(sql`1`);

    const { thema: chosenThema, altersgruppe: chosenAltersgruppe, ...rest } = selection;

    return {
      thema: await countOver(courses.thema, {
        ...rest,
        ...(chosenAltersgruppe === undefined ? {} : { altersgruppe: chosenAltersgruppe }),
      }),
      altersgruppe: await countOver(courses.altersgruppe, {
        ...rest,
        ...(chosenThema === undefined ? {} : { thema: chosenThema }),
      }),
    };
  }

  async findCourseTree(slug: string): Promise<CourseTreeRows | undefined> {
    const [course] = (await this.db
      .select()
      .from(courses)
      .where(eq(courses.slug, slug))
      .limit(1)) as unknown as CourseRow[];

    if (course === undefined) return undefined;

    const moduleRows = await this.db
      .select({
        id: modules.id,
        ordinal: modules.ordinal,
        title: modules.title,
        subtitle: modules.subtitle,
      })
      .from(modules)
      .where(eq(modules.courseId, course.id))
      .orderBy(asc(modules.ordinal));

    const moduleIds = moduleRows.map((row) => row.id);

    const chapterRows =
      moduleIds.length === 0
        ? []
        : await this.db
            .select({
              id: chapters.id,
              moduleId: chapters.moduleId,
              ordinal: chapters.ordinal,
              title: chapters.title,
            })
            .from(chapters)
            .where(inArray(chapters.moduleId, moduleIds))
            .orderBy(asc(chapters.ordinal));

    const chapterIds = chapterRows.map((row) => row.id);

    // Note: quiz_options.is_correct is never selected. The answer key has no
    // path to a learner-facing response (P4-01).
    const contentRows =
      chapterIds.length === 0
        ? []
        : await this.db
            .select({
              id: contents.id,
              chapterId: contents.chapterId,
              ordinal: contents.ordinal,
              kind: contents.kind,
              title: contents.title,
              durationSec: contents.durationSec,
              mimeType: contents.mimeType,
            })
            .from(contents)
            .where(inArray(contents.chapterId, chapterIds))
            .orderBy(asc(contents.ordinal));

    const expertRows = await this.db
      .select({
        id: courseExperts.id,
        ordinal: courseExperts.ordinal,
        roleLabel: courseExperts.roleLabel,
        name: courseExperts.name,
        institution: courseExperts.institution,
        biography: courseExperts.biography,
        photoUrl: courseExperts.photoUrl,
      })
      .from(courseExperts)
      .where(eq(courseExperts.courseId, course.id))
      .orderBy(asc(courseExperts.ordinal));

    return {
      course,
      modules: moduleRows,
      chapters: chapterRows,
      contents: contentRows as CourseTreeRows["contents"],
      experts: expertRows,
    };
  }
}

/**
 * The `WHERE` a course selection means.
 *
 * One function, used by the page query, the total and both facet counts. They
 * have to agree — a facet counted with a different predicate than the list is
 * a count that does not describe the list — and the way to make sure of that
 * is for there to be one predicate.
 *
 * `@>` and not `= ANY`: `thema` and `altersgruppe` are arrays, and containment
 * is what "this course is tagged Diagnostik" means when a course can carry
 * several tags.
 */
function whereFor(selection: CourseSelection) {
  const conditions = [];

  if (selection.deliveryType !== undefined) {
    conditions.push(inArray(courses.deliveryType, [...selection.deliveryType]));
  }
  if (selection.thema !== undefined) {
    conditions.push(sql`${courses.thema} @> ARRAY[${selection.thema}]::text[]`);
  }
  if (selection.altersgruppe !== undefined) {
    conditions.push(
      sql`${courses.altersgruppe} @> ARRAY[${selection.altersgruppe}]::text[]`,
    );
  }

  return conditions.length > 0 ? and(...conditions) : undefined;
}
