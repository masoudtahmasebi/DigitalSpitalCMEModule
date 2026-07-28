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
import type {
  CourseDetail,
  CourseListQuery,
  CourseListResponse,
  CourseSummary,
  ModuleSummary,
} from "./catalog.dto.js";

export class CatalogService {
  constructor(private readonly repository: CatalogRepositoryPort) {}

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

  async listCourses(query: CourseListQuery): Promise<CourseListResponse> {
    const { rows, total, durations } = await this.repository.listCourses({
      ...(query.thema === undefined ? {} : { thema: query.thema }),
      ...(query.altersgruppe === undefined ? {} : { altersgruppe: query.altersgruppe }),
      ...(query.deliveryType === undefined ? {} : { deliveryType: query.deliveryType }),
      limit: query.perPage,
      offset: (query.page - 1) * query.perPage,
    });

    return {
      items: rows.map((row) =>
        toSummary(row, durations.get(row.id) ?? { moduleCount: 0, totalDurationSec: 0 }),
      ),
      page: query.page,
      perPage: query.perPage,
      total,
      facets: await this.repository.facets(),
    };
  }

  /**
   * The whole tree in one call, so the detail view does not waterfall.
   *
   * A course the caller cannot see is indistinguishable from one that does not
   * exist: RLS returns no row, and this returns 404 rather than 403. Existence
   * is not disclosed (P2-05 acceptance criterion).
   */
  async getCourseBySlug(slug: string): Promise<CourseDetail> {
    const tree = await this.repository.findCourseTree(slug);

    if (tree === undefined) {
      throw AppError.notFound(`course slug=${slug} not visible in this tenant`);
    }

    return toDetail(tree);
  }
}

function toSummary(
  row: CourseRow,
  aggregate: { moduleCount: number; totalDurationSec: number },
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
  };
}

function toDetail(tree: CourseTreeRows): CourseDetail {
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
        fileUrl: content.fileUrl,
        mimeType: content.mimeType,
      })),
    })),
  }));

  const totalDurationSec = tree.contents.reduce(
    (total, content) => total + (content.durationSec ?? 0),
    0,
  );

  return {
    ...toSummary(course, { moduleCount: tree.modules.length, totalDurationSec }),
    learningObjectives: course.learningObjectives,
    targetAudience: course.targetAudience,
    vnr: course.vnr,
    accreditationBody: course.accreditationBody,
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
