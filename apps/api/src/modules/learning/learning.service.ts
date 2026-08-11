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
  courseAvailability,
  courseChapterSequence,
  courseWatchCoverage,
  evaluateSequence,
  isCourseComplete,
  mergeWatchedSegments,
  isCourseOffered,
  resumePosition,
  seekCeiling,
  orderSources,
  parseMediaSources,
  rollupProgress,
  validateSegments,
  watchedPercent,
  type AvailabilityWindow,
  type ContentProgressRecord,
  type ContentSegments,
  type CourseNode,
  type CourseRollup,
  type GateResult,
  type WatchedSegment,
} from "@ds/domain";
import { AppError } from "../../shared/problem-details.js";
import { PassthroughMediaResolver, type MediaResolver } from "../../shared/media-url.js";
import type { Db } from "../../db/tenant-db.js";
import {
  LearningRepository,
  type AttestedCompletion,
  type CourseComplianceRow,
  type CourseTree,
  type EnrolmentRow,
  type LearningRepositoryPort,
  type ProgressRow,
} from "./learning.repository.js";
import type {
  ChapterState,
  ContentKind,
  ContentState,
  EnrolmentState,
  LessonContent,
  Material,
  MaterialLibrary,
  ModuleState,
  ProgressReport,
  ProgressResult,
} from "./learning.dto.js";

/** What a learner may open through the player. A quiz has its own endpoint. */
const OPENABLE_KINDS: readonly ContentKind[] = ["video", "text", "details"];

/** Identity the use case acts for. Never taken from a request body. */
export interface LearnerContext {
  readonly customerId: string;
  readonly userId: string;
}

/**
 * Everything needed to decide anything about one learner's position in one
 * course. Built by `loadProgressContext` and by nothing else.
 */
export interface ProgressContext {
  readonly course: CourseComplianceRow;
  readonly enrolment: EnrolmentRow;
  readonly tree: CourseTree;
  readonly stored: readonly ProgressRow[];
  /** The tree as `@ds/domain` sees it — the input to every rule. */
  readonly courseNode: CourseNode;
  readonly rollup: CourseRollup;
}

export class LearningService {
  /**
   * `media` turns a stored reference into something a browser can fetch
   * (P10-09). It defaults to passthrough, so a deployment with no object
   * storage behaves exactly as before: plain URLs work, `s3://` references
   * stay locked because nothing can sign them.
   */
  constructor(
    private readonly repository: LearningRepositoryPort,
    private readonly media: MediaResolver = new PassthroughMediaResolver(),
    /**
     * Injectable so the course-completion stamp and the validity-window check
     * can be tested at an instant of the test's choosing rather than at
     * whatever "now" happens to be while the suite runs (P51).
     */
    private readonly clock: () => Date = () => new Date(),
  ) {}

  static fromDb(db: Db, media?: MediaResolver): LearningService {
    return new LearningService(new LearningRepository(db), media);
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

    /*
     * A course outside its validity window takes no new learners (P50-01).
     *
     * Checked here and not only in the catalogue: the list hides it, and a
     * bookmark, a WordPress embed or a link in an old email reaches this
     * method without ever having gone through the list.
     *
     * **An existing enrolment is deliberately unaffected.** A physician who
     * started while the course was open keeps their access and their progress:
     * the compliance settings are already snapshotted onto the enrolment
     * (P3-01), and revoking a half-finished course is a worse outcome than a
     * late completion — which the Ärztekammer's own `beginn`/`ende` check
     * refuses at submission time anyway, loudly, inside the correction window.
     * If the accreditation rule turns out to require hard cut-off, this is the
     * one line that changes.
     */
    const existingEnrolment = await this.repository.findEnrolment(
      course.id,
      learner.userId,
    );
    if (existingEnrolment === undefined && !isCourseOffered(course, new Date())) {
      throw AppError.notFound(`course slug=${slug} is outside its validity window`);
    }

    const enrolment =
      existingEnrolment ??
      (await this.repository.createEnrolment({
        customerId: learner.customerId,
        courseId: course.id,
        userId: learner.userId,
        course,
      }));

    return this.buildState(slug, course.id, enrolment, learner);
  }

  async getState(slug: string, learner: LearnerContext): Promise<EnrolmentState> {
    const { course, enrolment } = await this.requireEnrolled(slug, learner);
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
    const { course, enrolment, content, stored } = await this.requireReachableContent(
      slug,
      contentId,
      learner,
      ["video"],
    );

    // P51-02. Before anything is written: an expired course accepts no more
    // playback, however far through it the learner is.
    this.requireCourseStillOffered(course, slug);

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
      watchedSegments: [...merged],
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
      // The union that was just stored, so the player's bar redraws from what
      // the gate credited rather than from what the client believed it sent.
      watchedSegments: [...merged],
      // And how far it may now seek, computed from that same union. Sent rather
      // than left to the client so the ceiling advances as the learner watches
      // without the player owning the rule.
      seekCeilingSec: seekCeiling(merged),
    };
  }

  /**
   * Open a lesson: the video URL or the text body, behind the sequence gate.
   *
   * The gate is the whole point of this endpoint existing. `CourseDetail` is a
   * browse response and deliberately carries no `videoUrl` — if it did, the
   * padlock on chapter 4 would be decorative, because the URL would already be
   * in a response the learner can read while chapter 1 is unfinished. Here the
   * URL is only produced after `requireReachableContent` agrees.
   *
   * A quiz is excluded: it has its own endpoint whose response shape has
   * nowhere to put a correct answer (P4-01), and routing it through here would
   * mean maintaining that guarantee in two places.
   */
  async getLesson(
    slug: string,
    contentId: string,
    learner: LearnerContext,
    now: Date,
  ): Promise<LessonContent> {
    const { content, stored } = await this.requireReachableContent(
      slug,
      contentId,
      learner,
      OPENABLE_KINDS,
    );

    const progress = stored.find((row) => row.contentId === contentId);

    return {
      id: content.id,
      kind: content.kind,
      title: content.title,
      durationSec: content.durationSec,
      // Signed here and nowhere else: the gate has already agreed above, and
      // the URLs are short-lived so they cannot outlive that agreement by much.
      //
      // *Every* rendition goes through the resolver, not merely the first. A
      // per-source tenant check is the whole point — one unsigned `s3://` URL
      // in a list of four would be a cross-tenant read that the other three
      // being correct does nothing to prevent.
      sources: this.resolveSources(content.mediaSources, learner.customerId, now),
      posterUrl: this.media.resolve(content.posterUrl, learner.customerId, now),
      // Signed the same way and for the same lifetime as the video. A caption
      // track that expired before the video it belongs to would leave a
      // hard-of-hearing learner watching an uncaptioned recording — the exact
      // failure the track exists to prevent.
      captionsUrl: this.media.resolve(content.captionsUrl, learner.customerId, now),
      body: content.body,
      lastPositionSec: progress?.lastPositionSec ?? 0,
      /*
       * Where playback actually starts, decided here rather than in the
       * player.
       *
       * A learner who left at 14:35 comes back at 14:00 — the containing
       * minute — because dropping somebody into the middle of a sentence they
       * have half-forgotten is worse than replaying thirty seconds. The replay
       * is free: coverage is a union, so re-watching the same seconds cannot
       * inflate the percentage (invariant 5).
       *
       * Server-side because it is a rule about what a learner is shown of a
       * course that awards a CME point, and the client is a renderer
       * (invariant 1). It also means every host — the widget, the portal, the
       * WordPress embed — rewinds by the same amount without three of them
       * agreeing to.
       */
      resumeAtSec: resumePosition({
        // Capped at the seek ceiling before it is floored, so the resume point
        // can never be a position the player would then refuse to seek to.
        //
        // The two can diverge because `lastPositionSec` is reported by the
        // client while the ceiling is derived from segments this API validated:
        // a report whose segments were rejected as implausible still moves the
        // position. Without the cap, a client could raise its own ceiling by
        // reporting a position it never watched to — which would credit nothing
        // (the union is untouched) but would still hand out a scrub bar it had
        // not earned.
        lastPositionSec: Math.min(
          progress?.lastPositionSec ?? 0,
          seekCeiling([...readSegments(progress?.watchedSegments)]),
        ),
        durationSec: content.durationSec,
      }),
      /*
       * The furthest second the player may seek to.
       *
       * The end of what has actually been watched, plus the same tolerance
       * `isSeekAllowed` applies, so the scrub bar cannot offer a position the
       * API would then refuse to credit. Seeking backwards is unrestricted.
       *
       * Sent rather than derived in the client from `watchedSegments` for the
       * usual reason: the client already has the segments, but the *rule*
       * about what they permit belongs to one place, and that place is the
       * server.
       */
      seekCeilingSec: seekCeiling([...readSegments(progress?.watchedSegments)]),
      watchedPercent: progress?.watchedPercent ?? 0,
      // The intervals the percentage above was computed from, so the player's
      // coverage bar and its number come from one source.
      watchedSegments: [...readSegments(progress?.watchedSegments)],
    };
  }

  /**
   * Resolve every stored rendition, dropping the ones that cannot be served.
   *
   * Ordered by `orderSources` here rather than in the client, so all three
   * frontends and any future host get the same negotiation. A source the
   * resolver refuses — a key belonging to another customer, or an `s3://`
   * reference on a deployment with no storage — is dropped rather than emitted
   * with a null URL: a `<source>` with no `src` is one the browser tries and
   * fails on, which is worse than one that was never offered.
   */
  private resolveSources(
    stored: unknown,
    customerId: string,
    now: Date,
  ): Array<{ url: string; mimeType: string; label: string | null }> {
    const resolved: Array<{ url: string; mimeType: string; label: string | null }> = [];

    for (const source of orderSources(parseMediaSources(stored))) {
      const url = this.media.resolve(source.url, customerId, now);
      if (url === null) continue;
      resolved.push({ url, mimeType: source.mimeType, label: source.label });
    }

    return resolved;
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
    expectedKinds: readonly ContentKind[],
  ) {
    const context = await this.loadProgressContext(slug, learner);

    const content = context.tree.contents.find((row) => row.id === contentId);
    if (content === undefined) {
      // Content outside this course is a 404, not a 403: the caller learns
      // nothing about whether it exists elsewhere.
      throw AppError.notFound(`content=${contentId} is not part of course=${slug}`);
    }
    if (!expectedKinds.includes(content.kind)) {
      throw new AppError(
        "validation",
        `content=${contentId} is kind=${content.kind}, expected one of ${expectedKinds.join("|")}`,
        "Dieser Inhalt kann hier nicht geöffnet werden.",
      );
    }

    this.assertReachable(context.courseNode, context.rollup, context.tree, contentId);

    return { ...context, content };
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
  async getMaterials(
    slug: string,
    learner: LearnerContext,
    now: Date,
  ): Promise<MaterialLibrary> {
    const { tree, rollup } = await this.loadProgressContext(slug, learner);

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
          // Sent while locked too, like the title. The layout blurs a locked
          // group rather than hiding it, so a learner sees that material
          // exists and what unlocks it; the gate is the absent `fileUrl`.
          description: content.body,
          locked,
          // A locked item still gets no URL at all — the gate is the absent
          // URL, and signing one for a padlocked file would defeat it.
          fileUrl: locked
            ? null
            : this.media.resolve(content.fileUrl, learner.customerId, now),
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
   * `attested` carries the name the learner confirmed for their certificate,
   * its three parts, and the consent that authorises the Punktemeldung — all
   * written in the one statement that stamps the completion. A `null` name
   * keeps whatever is stored.
   */
  async markCompleted(
    enrolmentId: string,
    at: Date,
    attested: AttestedCompletion,
  ): Promise<void> {
    await this.repository.markCompleted(enrolmentId, at, attested);
  }

  /**
   * The course and the caller's enrolment on it, or a 404.
   *
   * Seven call sites across three services opened with these two lines. That
   * is fine right up until one of them is written without the second, at which
   * point a learner acts on a course they never enrolled on — so the pair is a
   * single operation with a single name.
   */
  async requireEnrolled(
    slug: string,
    learner: LearnerContext,
  ): Promise<{ course: CourseComplianceRow; enrolment: EnrolmentRow }> {
    const course = await this.requireCourse(slug);
    const enrolment = await this.requireEnrolment(course.id, learner.userId);
    return { course, enrolment };
  }

  /**
   * Refuse to advance a course that is outside its validity window (P51-02).
   *
   * ## Why this is not in `requireEnrolled`
   *
   * Because it must not apply to reads. A physician whose course has expired
   * **keeps their enrolment and everything in it** — their progress, their
   * quiz score, their certificate if they earned one. They can open the course
   * and look at all of it. What they cannot do is add to it.
   *
   * Putting the check in `requireEnrolled` would have been one line instead of
   * four call sites, and it would have made an expired course disappear from
   * the learner's own history. That is the opposite of "keep the existing".
   *
   * ## Why a 409 and not a 404
   *
   * A 404 is what `enrol` gives somebody who has never taken this course: as
   * far as they are concerned it does not exist, and saying otherwise
   * enumerates the catalogue (§9.5). This caller is different — they are
   * enrolled, they are looking at the course right now, and the thing that
   * changed is the world, not their permissions. `conflict` says so.
   *
   * ## What the message has to do
   *
   * Tell them their work is not lost. The first thing anybody thinks when a
   * button they have used for an hour stops working is that they have lost the
   * hour (§9.4).
   *
   * And tell them *which* refusal this is. `courseAvailability` distinguishes
   * "not open yet" from "closed", and a course an enrolled learner cannot
   * advance because `validFrom` was moved into the future is not expired —
   * telling them it is would send them looking for a deadline they never
   * missed. That is a narrow case, but the alternative is a message that is
   * confidently wrong, and the distinction already exists in the domain: it
   * was written for exactly this and, until now, called by nothing (§9.3).
   */
  requireCourseStillOffered(course: AvailabilityWindow, slug: string): void {
    const availability = courseAvailability(course, this.clock());
    if (availability === "available") return;

    throw new AppError(
      "conflict",
      `course slug=${slug} is ${availability}; refusing to advance it`,
      availability === "not_yet"
        ? "Diese Fortbildung ist noch nicht freigeschaltet. Ihre bisherigen Ergebnisse bleiben erhalten."
        : "Der Teilnahmezeitraum dieser Fortbildung ist abgelaufen. Ihre bisherigen Ergebnisse bleiben erhalten.",
    );
  }

  /**
   * Everything the compliance rules need to decide anything about a learner:
   * the course tree, their stored progress, and the rollup over both.
   *
   * The four screens that need this — lesson, materials, state, progress —
   * each built it by hand from the same five calls in the same order. The
   * order is not arbitrary (the rollup is computed over the tree, not over the
   * rows), and a fifth screen assembling it slightly differently would produce
   * a second answer to "how far has this person got". CLAUDE.md §4 invariant 6
   * says there is one rollup path; this is the loader that feeds it.
   */
  async loadProgressContext(
    slug: string,
    learner: LearnerContext,
  ): Promise<ProgressContext> {
    const { course, enrolment } = await this.requireEnrolled(slug, learner);

    const [tree, stored] = await Promise.all([
      this.repository.findCourseTree(course.id),
      this.repository.findProgress(enrolment.id),
    ]);

    const courseNode = toCourseNode(tree);
    const rollup = rollupProgress(courseNode, toProgressRecords(stored, tree));

    return { course, enrolment, tree, stored, courseNode, rollup };
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

    const figures = summariseEnrolment({
      tree,
      stored,
      requiredWatchPercent: enrolment.requiredWatchPercent,
      passThresholdPercent: enrolment.passThresholdPercent,
      efnPresent,
      evaluationSubmitted,
      cmePoints: enrolment.cmePoints,
    });

    const courseNode = toCourseNode(tree);
    const rollup = rollupProgress(courseNode, toProgressRecords(stored, tree));
    const gates = evaluateSequence(courseChapterSequence(courseNode, rollup));

    /*
     * Record the moment the Fortbildung was finished (P51-01).
     *
     * `courseComplete` is always *derived* — the line above computes it from
     * the stored rows every time — so this write is only ever about keeping the
     * date, never about deciding the answer. That is what makes it safe to do
     * from a read: if the write is lost, skipped or never reached, the state
     * this method returns is unchanged and no gate moves.
     *
     * It lives here rather than in `recordProgress` and the quiz submission
     * because those are two call sites for one rule, and a rule written twice
     * is the shape CLAUDE.md §9.3 keeps catching. This is the single funnel
     * through which every recomputation of the state passes.
     *
     * The trade-off, stated: a learner who passes the quiz and never loads
     * their state again gets no timestamp until they next do. The widget
     * refetches immediately after both writes, so in practice it lands within
     * seconds — and a missing date is visibly missing, where a wrong date
     * would not be.
     */
    const stampCourseCompletionAt =
      figures.courseComplete && enrolment.courseCompletedAt === null
        ? this.clock()
        : undefined;
    if (stampCourseCompletionAt !== undefined) {
      await this.repository.markCourseCompleted(enrolment.id, stampCourseCompletionAt);
    }
    const courseCompletedAt = enrolment.courseCompletedAt ?? stampCourseCompletionAt;

    return {
      enrolmentId: enrolment.id,
      courseSlug: slug,
      requiredWatchPercent: enrolment.requiredWatchPercent,
      passThresholdPercent: enrolment.passThresholdPercent,
      achievedWatchPercent: figures.achievedWatchPercent,
      quizPassed: figures.quizPassed,
      evaluationSubmitted,
      efnPresent,
      courseComplete: figures.courseComplete,
      complete: figures.complete,
      outstanding: [...figures.outstanding],
      outstandingForCourse: [...figures.outstandingForCourse],
      completedAt: enrolment.completedAt?.toISOString() ?? null,
      courseCompletedAt: courseCompletedAt?.toISOString() ?? null,
      progress: figures.progress,
      moduleCompletion: figures.moduleCompletion,
      modules: buildModuleStates(tree, rollup, gates),
      resumeContentId: firstReachableIncomplete(tree, rollup, gates),
    };
  }
}

/**
 * The compliance figures for one enrolment, from its stored rows.
 *
 * **This is the one rollup path** (CLAUDE.md §4 invariant 6). The learner's own
 * `GET /enrolment` and the admin console's participant list both call it, over
 * the same `findCourseTree` and the same `ProgressRow` shape. Two
 * implementations would eventually disagree, and a participant list showing a
 * physician 96 % while their own screen shows 100 % is not a display bug — it
 * is two different answers to "did this person earn a CME point", one of which
 * has already been reported to the Ärztekammer.
 *
 * Pure: rows in, figures out, no I/O. The caller reads the rows.
 */
export function summariseEnrolment(input: {
  tree: CourseTree;
  stored: readonly ProgressRow[];
  requiredWatchPercent: number;
  passThresholdPercent: number;
  efnPresent: boolean;
  evaluationSubmitted: boolean;
  /**
   * The enrolment's snapshot of the course's points, not the live course
   * record — a course re-accredited after somebody enrolled must not change
   * what was asked of them mid-way, which is the same reason
   * `requiredWatchPercent` is snapshotted.
   */
  cmePoints: number | null;
}): {
  achievedWatchPercent: number;
  quizPassed: boolean;
  progress: CourseRollup["course"];
  moduleCompletion: CourseRollup["moduleCompletion"];
  courseComplete: boolean;
  complete: boolean;
  outstanding: readonly EnrolmentState["outstanding"][number][];
  outstandingForCourse: readonly EnrolmentState["outstanding"][number][];
} {
  const courseNode = toCourseNode(input.tree);
  const records = toProgressRecords(input.stored, input.tree);
  const rollup = rollupProgress(courseNode, records);

  const coverage = courseWatchCoverage(courseNode, toContentSegments(input.stored));
  const quizPassed = hasPassedQuiz(records, input.tree, input.passThresholdPercent);

  const completion = isCourseComplete({
    requiredWatchPercent: input.requiredWatchPercent,
    achievedWatchPercent: coverage.percent,
    quizPassed,
    evaluationSubmitted: input.evaluationSubmitted,
    efnPresent: input.efnPresent,
    // No points, no Punktemeldung, and therefore no reason to hold a
    // physician's Fortbildungsnummer — see the note in `completion.ts`.
    awardsCmePoints: input.cmePoints !== null && input.cmePoints > 0,
  });

  return {
    achievedWatchPercent: coverage.percent,
    quizPassed,
    progress: rollup.course,
    moduleCompletion: rollup.moduleCompletion,
    courseComplete: completion.courseComplete,
    complete: completion.complete,
    outstanding: completion.outstanding,
    outstandingForCourse: completion.outstandingForCourse,
  };
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
