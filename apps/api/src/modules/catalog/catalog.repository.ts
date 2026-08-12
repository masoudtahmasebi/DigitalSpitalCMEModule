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

import { and, asc, count, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { CourseStatus } from "@ds/domain";
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
  /** Editorial state (P53-01). `findCourseTree` selects the whole row. */
  status: CourseStatus;
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
  /**
   * The instant the catalogue is being read at (P50-01).
   *
   * Required, not defaulted to `new Date()`: this is infrastructure and the
   * clock belongs to the caller, the same way it does in `@ds/domain`. A
   * default here would make "what did the catalogue look like at 23:59?"
   * untestable, and the boundary is exactly what needs testing.
   */
  now: Date;
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
  ): Promise<Map<string, { courseComplete: boolean; complete: boolean }>>;
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
  ): Promise<Map<string, { courseComplete: boolean; complete: boolean }>> {
    if (courseIds.length === 0) return new Map();

    const rows = await this.db
      .select({
        courseId: enrolments.courseId,
        completedAt: enrolments.completedAt,
        courseCompletedAt: enrolments.courseCompletedAt,
      })
      .from(enrolments)
      .where(
        and(inArray(enrolments.courseId, [...courseIds]), eq(enrolments.userId, userId)),
      );

    return new Map(
      rows.map((row) => [
        row.courseId,
        {
          /*
           * Two timestamps, no rollup (P52-05).
           *
           * The card cannot afford `summariseEnrolment` — that reads the whole
           * course tree and every progress row, and this method exists to
           * answer a page of cards in one query. `course_completed_at`
           * (migration 0037) is what makes the weaker milestone answerable at
           * the same cost as the stronger one: a stamped column, not a
           * derivation.
           *
           * `completedAt` is the fallback for rows certified before 0037
           * existed, which carry no course-completion date. Certification
           * implies the course was finished, so reading it as finished is
           * true — and without this clause those learners would see a course
           * they hold a certificate for described as unfinished.
           */
          courseComplete: row.courseCompletedAt !== null || row.completedAt !== null,
          complete: row.completedAt !== null,
        },
      ]),
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

  /*
   * Only courses currently being offered (P50-01).
   *
   * `isCourseOffered` in `@ds/domain` is the rule; this is the same rule in
   * SQL, and it is here rather than as a filter over fetched rows because
   * paging and the facet counts both have to agree with it — a total that
   * counted expired courses would page a list that does not contain them.
   *
   * That makes two implementations of one rule, which this repository normally
   * refuses. It is the ADR-0002 trade again: the predicate that *decides* is
   * the domain function, this narrows what leaves the database, and
   * `catalog.service.ts` applies the domain function to what comes back — so a
   * disagreement between them cannot show a course that the rule says is
   * closed.
   *
   * `IS NULL OR` on both ends, because validity is optional and the common
   * case is a course with neither date. Getting that wrong would empty the
   * catalogue rather than filter it.
   */
  /*
   * Drafts never reach a learner (P53-01).
   *
   * Beside the window rather than folded into it: the two answer different
   * questions — "is this finished being written" and "is the accreditation
   * running" — and a course can fail either independently. A course created
   * in the console starts as a draft, which is what stops an operator
   * building it in front of the physicians.
   */
  conditions.push(eq(courses.status, "published"));

  conditions.push(or(isNull(courses.validFrom), lte(courses.validFrom, selection.now)));
  conditions.push(or(isNull(courses.validTo), gte(courses.validTo, selection.now)));

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
