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
import { PassthroughMediaResolver, type MediaResolver } from "../../shared/media-url.js";
import type { Db } from "../../db/tenant-db.js";
import {
  CatalogRepository,
  type CatalogRepositoryPort,
  type CourseRow,
  type CourseTreeRows,
} from "./catalog.repository.js";
import { courseAvailability, isCourseOffered } from "@ds/domain";

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
    /**
     * Turns a stored `s3://` reference into something a browser can fetch
     * (P211-01).
     *
     * The catalogue used to pass `hero_image_url` and an expert's `photo_url`
     * straight through, which was correct while the only way to fill those
     * fields was to paste an `https://` URL. Now that both offer the Mediathek,
     * a row can hold `s3://<key>` — and an unresolved one reaches the page as
     * `<img src="s3://…">`, which renders nothing and logs nothing. That is
     * §9.2: a control whose result cannot work.
     *
     * The **same** resolver the lesson path uses, not a second one: it already
     * refuses a key belonging to another customer, and a bucket has no RLS to
     * fall back on (§4 invariant 3).
     */
    private readonly media: MediaResolver = new PassthroughMediaResolver(),
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
  static fromDb(db: Db, media?: MediaResolver): CatalogService {
    return new CatalogService(
      new CatalogRepository(db),
      () => new Date(),
      ...(media === undefined ? [] : [media]),
    );
  }

  /**
   * `userId` is **undefined** for the DocCheck catalogue preview (P213-01).
   *
   * Not an empty string, which was the first attempt and is worse than wrong:
   * `enrolments.user_id` is a `uuid`, so `''` does not match nothing — it is
   * rejected by the type, and the whole request 500s. The integration case
   * found it, which is the only reason this comment exists rather than a
   * plausible-looking sentinel.
   *
   * Undefined means "there is nobody to have an enrolment", and the query is
   * skipped rather than run in a form that cannot return a row.
   */
  async listCourses(
    query: CourseListQuery,
    userId: string | undefined,
  ): Promise<CourseListResponse> {
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

    // One query for the page, not one per card — and none at all when nobody
    // is asking on their own behalf (the preview; see the note above).
    const enrolled =
      userId === undefined
        ? new Map<string, { courseComplete: boolean; complete: boolean }>()
        : await this.repository.findEnrolments(
            rows.map((row) => row.id),
            userId,
          );

    return {
      items: rows.map((row) =>
        toSummary(
          row,
          durations.get(row.id) ?? { moduleCount: 0, totalDurationSec: 0 },
          enrolled.get(row.id) ?? null,
          (stored) => this.media.resolve(stored, row.customerId, readAt),
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
  async getCourseBySlug(slug: string, userId: string | undefined): Promise<CourseDetail> {
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
      /*
       * One message for a draft and for an expired course, and one status.
       *
       * `courseAvailability` distinguishes them and the *learner* must not:
       * telling somebody "this course is still being written" confirms that a
       * course by that slug exists and is coming, which is a fact about an
       * unannounced product (§9.5). The internal string below says which, for
       * the log.
       */
      throw AppError.notFound(
        `course slug=${slug} is not offered: ${courseAvailability(tree.course, this.now())}`,
      );
    }

    const enrolled =
      userId === undefined
        ? new Map<string, { courseComplete: boolean; complete: boolean }>()
        : await this.repository.findEnrolments([tree.course.id], userId);

    return toDetail(tree, enrolled.get(tree.course.id) ?? null, (stored) =>
      this.media.resolve(stored, tree.course.customerId, this.now()),
    );
  }
}

function toSummary(
  row: CourseRow,
  aggregate: { moduleCount: number; totalDurationSec: number },
  enrolment: { courseComplete: boolean; complete: boolean } | null,
  /** See the constructor: an unresolved `s3://` renders as a broken image. */
  resolve: (stored: string | null) => string | null,
): CourseSummary {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    heroImageUrl: resolve(row.heroImageUrl),
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
  enrolment: { courseComplete: boolean; complete: boolean } | null,
  resolve: (stored: string | null) => string | null,
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
      resolve,
    ),
    learningObjectives: course.learningObjectives,
    targetAudience: course.targetAudience,
    prerequisites: course.prerequisites,
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
    /* A Referent's photograph goes through the same resolver as the hero and
       the lesson's video — one home for "what does this stored string mean"
       (§9.10b). */
    experts: tree.experts.map((expert) => ({
      ...expert,
      photoUrl: resolve(expert.photoUrl),
    })),
  };
}
