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
import { chapters, contents, courseExperts, courses, modules } from "../../db/schema.js";

export interface CourseRow {
  id: string;
  slug: string;
  title: string;
  description: string | null;
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
    fileUrl: string | null;
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
  deliveryType?: "on_demand" | "live" | "praesenz";
  limit: number;
  offset: number;
}

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
  facets(): Promise<{
    thema: Array<{ value: string; count: number }>;
    altersgruppe: Array<{ value: string; count: number }>;
  }>;
  findCourseTree(slug: string): Promise<CourseTreeRows | undefined>;
}

export class CatalogRepository implements CatalogRepositoryPort {
  constructor(private readonly db: Db) {}

  async listCourses(filter: CourseListFilter) {
    const conditions = [];
    if (filter.deliveryType !== undefined) {
      conditions.push(eq(courses.deliveryType, filter.deliveryType));
    }
    if (filter.thema !== undefined) {
      conditions.push(sql`${courses.thema} @> ARRAY[${filter.thema}]::text[]`);
    }
    if (filter.altersgruppe !== undefined) {
      conditions.push(
        sql`${courses.altersgruppe} @> ARRAY[${filter.altersgruppe}]::text[]`,
      );
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

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

  async facets() {
    const thema = await this.db
      .select({
        value: sql<string>`unnest(${courses.thema})`,
        count: sql<number>`count(*)::int`,
      })
      .from(courses)
      .groupBy(sql`1`);

    const altersgruppe = await this.db
      .select({
        value: sql<string>`unnest(${courses.altersgruppe})`,
        count: sql<number>`count(*)::int`,
      })
      .from(courses)
      .groupBy(sql`1`);

    return { thema, altersgruppe };
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
              fileUrl: contents.fileUrl,
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
