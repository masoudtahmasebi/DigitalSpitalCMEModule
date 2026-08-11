/**
 * Catalog use case (P2-05). Application layer — ADR-0006.
 *
 * Orchestrates: ask the repository for rows, shape them into the DTOs the
 * contract promises. Any decision more interesting than shaping belongs to
 * `packages/domain`.
 *
 * Depends on `CatalogRepositoryPort`, not on the Drizzle implementation, so the
 * whole use case is unit-testable with a fake in milliseconds.
 */

import { AppError } from "../../shared/problem-details.js";
import type { Db } from "../../db/tenant-db.js";
import {
  CatalogRepository,
  type CatalogRepositoryPort,
  type CourseRow,
  type CourseTreeRows,
} from "./catalog.repository.js";
import { isCourseOffered } from "@ds/domain";

import type {
  CourseDetail,
  CourseListQuery,
  CourseListResponse,
  CourseSummary,
  ModuleSummary,
} from "./catalog.dto.js";

export class CatalogService {
  /**
   * `now` is injected so the validity window (P50-01) is testable at its
   * boundaries. Defaulted for every production caller, because threading a
   * clock through four controllers to change nothing would be ceremony — the
   * rule that *decides* is pure and takes time as an argument, which is where
   * CLAUDE.md §4 invariant 4 actually applies.
   */
  constructor(
    private readonly repository: CatalogRepositoryPort,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * The composition entry point controllers use.
   *
   * The repository import stays inside this file — the application layer —
   * rather than in the controller, which is what ADR-0006 requires: the
   * interface layer may construct a use case, but it must not know the
   * concrete infrastructure class backing it. See
   * `db/tenant-db.decorator.ts` for why this per-request construction
   * replaces NestJS request-scoped DI here.
   */
  static fromDb(db: Db): CatalogService {
    return new CatalogService(new CatalogRepository(db));
  }

  async listCourses(query: CourseListQuery, userId: string): Promise<CourseListResponse> {
    const selection = {
      ...(query.thema === undefined ? {} : { thema: query.thema }),
      ...(query.altersgruppe === undefined ? {} : { altersgruppe: query.altersgruppe }),
      ...(query.deliveryType === undefined ? {} : { deliveryType: query.deliveryType }),
    };

    const readAt = this.now();
    const { rows, total, durations } = await this.repository.listCourses({
      ...selection,
      now: readAt,
      limit: query.perPage,
      offset: (query.page - 1) * query.perPage,
    });

    // One query for the page, not one per card.
    const enrolled = await this.repository.findEnrolments(
      rows.map((row) => row.id),
      userId,
    );

    return {
      items: rows.map((row) =>
        toSummary(
          row,
          durations.get(row.id) ?? { moduleCount: 0, totalDurationSec: 0 },
          enrolled.get(row.id) ?? null,
        ),
      ),
      page: query.page,
      perPage: query.perPage,
      total,
      /*
       * Counted under the *rest* of the selection, not over the whole
       * catalogue. A count next to a filter value is a promise about what
       * choosing it will show, and unconditional counts break that promise in
       * the most annoying possible way: `Diagnostik (3)` beside
       * `Übergang / Transition (1)` while the two together match nothing.
       * Each facet excludes only its own axis, so the value currently chosen
       * still appears and can be swapped for a sibling.
       */
      // The same `now` the page query used. Counting facets at a different
      // instant than the list would let a boundary between the two calls
      // produce a count that does not describe the page.
      facets: await this.repository.facets({ ...selection, now: readAt }),
    };
  }

  /**
   * The whole tree in one call, so the detail view does not waterfall.
   *
   * A course the caller cannot see is indistinguishable from one that does not
   * exist: RLS returns no row, and this returns 404 rather than 403. Existence
   * is not disclosed (P2-05 acceptance criterion).
   */
  async getCourseBySlug(slug: string, userId: string): Promise<CourseDetail> {
    const tree = await this.repository.findCourseTree(slug);

    if (tree === undefined) {
      throw AppError.notFound(`course slug=${slug} not visible in this tenant`);
    }

    /*
     * A course outside its validity window is not offered (P50-01).
     *
     * 404 and not 403, for the same reason the tenant check above is: a course
     * somebody cannot have is indistinguishable from one that does not exist,
     * and a distinct status would let anybody enumerate which VNRs this
     * installation has retired (§9.5).
     *
     * This is the *second* place the rule is applied — the list query filters
     * in SQL — and both are needed, because a detail page is reachable by a
     * bookmarked URL that never went through the list.
     */
    if (!isCourseOffered(tree.course, this.now())) {
      throw AppError.notFound(`course slug=${slug} is outside its validity window`);
    }

    const enrolled = await this.repository.findEnrolments([tree.course.id], userId);

    return toDetail(tree, enrolled.get(tree.course.id) ?? null);
  }
}

function toSummary(
  row: CourseRow,
  aggregate: { moduleCount: number; totalDurationSec: number },
  enrolment: { complete: boolean } | null,
): CourseSummary {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    heroImageUrl: row.heroImageUrl,
    deliveryType: row.deliveryType,
    thema: row.thema,
    altersgruppe: row.altersgruppe,
    cmePoints: row.cmePoints,
    cmeCategory: row.cmeCategory,
    moduleCount: aggregate.moduleCount,
    totalDurationSec: aggregate.totalDurationSec,
    enrolment,
  };
}

function toDetail(
  tree: CourseTreeRows,
  enrolment: { complete: boolean } | null,
): CourseDetail {
  const { course } = tree;

  const contentsByChapter = new Map<string, CourseTreeRows["contents"]>();
  for (const content of tree.contents) {
    const list = contentsByChapter.get(content.chapterId) ?? [];
    list.push(content);
    contentsByChapter.set(content.chapterId, list);
  }

  const chaptersByModule = new Map<string, CourseTreeRows["chapters"]>();
  for (const chapter of tree.chapters) {
    const list = chaptersByModule.get(chapter.moduleId) ?? [];
    list.push(chapter);
    chaptersByModule.set(chapter.moduleId, list);
  }

  const modules: ModuleSummary[] = tree.modules.map((module) => ({
    id: module.id,
    ordinal: module.ordinal,
    title: module.title,
    subtitle: module.subtitle,
    chapters: (chaptersByModule.get(module.id) ?? []).map((chapter) => ({
      id: chapter.id,
      ordinal: chapter.ordinal,
      title: chapter.title,
      contents: (contentsByChapter.get(chapter.id) ?? []).map((content) => ({
        id: content.id,
        ordinal: content.ordinal,
        kind: content.kind,
        title: content.title,
        durationSec: content.durationSec,
        mimeType: content.mimeType,
      })),
    })),
  }));

  const totalDurationSec = tree.contents.reduce(
    (total, content) => total + (content.durationSec ?? 0),
    0,
  );

  return {
    ...toSummary(
      course,
      { moduleCount: tree.modules.length, totalDurationSec },
      enrolment,
    ),
    learningObjectives: course.learningObjectives,
    targetAudience: course.targetAudience,
    prerequisites: course.prerequisites,
    vnr: course.vnr,
    accreditationBody: course.accreditationBody,
    fortbildungsnummer: course.fortbildungsnummer,
    organizer: course.organizer,
    eventLocation: course.eventLocation,
    validFrom: course.validFrom?.toISOString() ?? null,
    validTo: course.validTo?.toISOString() ?? null,
    // Exposed so the Zertifizierung tab renders the course's real configured
    // values rather than a hardcoded 80 % or 100 % (P5-06).
    requiredWatchPercent: course.requiredWatchPercent,
    passThresholdPercent: course.passThresholdPercent,
    modules,
    experts: tree.experts,
  };
}
