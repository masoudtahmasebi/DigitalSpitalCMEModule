import { describe, expect, it } from "vitest";
import { LearningService } from "./learning.service.js";
import {
  enrolmentStateSchema,
  materialLibrarySchema,
  progressResultSchema,
} from "./learning.dto.js";
import { AppError } from "../../shared/problem-details.js";
import type { MediaResolver } from "../../shared/media-url.js";
import type {
  CourseComplianceRow,
  CourseTree,
  EnrolmentRow,
  LearningRepositoryPort,
  ProgressRow,
} from "./learning.repository.js";

const COURSE_ID = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
const ENROLMENT_ID = "a1b2c3d4-0000-4000-8000-000000000001";
const USER_ID = "11111111-0000-4000-8000-000000000001";
const CUSTOMER_ID = "22222222-0000-4000-8000-000000000001";

const M1 = "aaaaaaaa-0000-4000-8000-000000000001";
const M2 = "aaaaaaaa-0000-4000-8000-000000000002";
const C1 = "bbbbbbbb-0000-4000-8000-000000000001";
const C2 = "bbbbbbbb-0000-4000-8000-000000000002";
const VIDEO_1 = "cccccccc-0000-4000-8000-000000000001";
const VIDEO_2 = "cccccccc-0000-4000-8000-000000000002";
const QUIZ = "cccccccc-0000-4000-8000-000000000003";
const PDF_1 = "cccccccc-0000-4000-8000-000000000004";
const PDF_2 = "cccccccc-0000-4000-8000-000000000005";

const NOW = new Date("2026-07-28T10:00:00Z");
const learner = { customerId: CUSTOMER_ID, userId: USER_ID };

const course: CourseComplianceRow = {
  id: COURSE_ID,
  slug: "adhs-akademie-adult",
  requiredWatchPercent: 100,
  passThresholdPercent: 70,
  maxQuizAttempts: null,
  revealCorrectAnswers: false,
  cmePoints: 4,
  cmeCategory: "D",
  vnr: "9999999999999999999",
  validFrom: null,
  validTo: null,
};

/** Two modules, one chapter each; module 1 has a video, module 2 video + quiz. */
const tree: CourseTree = {
  modules: [
    { id: M1, ordinal: 0, title: "Modul 1" },
    { id: M2, ordinal: 1, title: "Modul 2" },
  ],
  chapters: [
    { id: C1, moduleId: M1, ordinal: 0 },
    { id: C2, moduleId: M2, ordinal: 1 },
  ],
  contents: [
    {
      id: VIDEO_1,
      chapterId: C1,
      ordinal: 0,
      kind: "video",
      durationSec: 600,
      title: "Inhalt",
      body: null,
      mediaSources: [],
      posterUrl: null,
      captionsUrl: null,
      fileUrl: null,
      mimeType: null,
      fileSize: null,
    },
    {
      id: VIDEO_2,
      chapterId: C2,
      ordinal: 0,
      kind: "video",
      durationSec: 400,
      title: "Inhalt",
      body: null,
      mediaSources: [],
      posterUrl: null,
      captionsUrl: null,
      fileUrl: null,
      mimeType: null,
      fileSize: null,
    },
    {
      id: QUIZ,
      chapterId: C2,
      ordinal: 1,
      kind: "quiz",
      durationSec: null,
      title: "Lernerfolgskontrolle",
      body: null,
      mediaSources: [],
      posterUrl: null,
      captionsUrl: null,
      fileUrl: null,
      mimeType: null,
      fileSize: null,
    },
    {
      id: PDF_1,
      chapterId: C1,
      ordinal: 2,
      kind: "material",
      durationSec: null,
      title: "Patienteninformation (PDF)",
      body: null,
      mediaSources: [],
      posterUrl: null,
      captionsUrl: null,
      fileUrl: "https://cdn.example.org/modul-1.pdf",
      mimeType: "application/pdf",
      fileSize: 1024,
    },
    {
      id: PDF_2,
      chapterId: C2,
      ordinal: 2,
      kind: "material",
      durationSec: null,
      title: "Diagnostik-Leitfaden (PDF)",
      body: null,
      mediaSources: [],
      posterUrl: null,
      captionsUrl: null,
      fileUrl: "https://cdn.example.org/modul-2.pdf",
      mimeType: "application/pdf",
      fileSize: 2048,
    },
  ],
};

// An accredited course: 4 points, which is what makes the EFN a condition of
// completion. A course with no points does not need one — see the point-free
// case below.
const enrolment: EnrolmentRow = {
  id: ENROLMENT_ID,
  courseId: COURSE_ID,
  userId: USER_ID,
  requiredWatchPercent: 100,
  passThresholdPercent: 70,
  maxQuizAttempts: null,
  completedAt: null,
  cmePoints: 4,
};

interface FakeState {
  // Explicitly `| undefined` rather than optional: `exactOptionalPropertyTypes`
  // makes "absent" and "present but undefined" different types, and the
  // not-enrolled cases below pass the latter deliberately.
  enrolment: EnrolmentRow | undefined;
  progress: ProgressRow[];
  efn: boolean;
  evaluation: boolean;
}

function fakeRepository(
  initial: Partial<FakeState> = {},
  overrides: Partial<LearningRepositoryPort> = {},
) {
  const state: FakeState = {
    enrolment: enrolment,
    progress: [],
    efn: false,
    evaluation: false,
    ...initial,
  };

  const created: EnrolmentRow[] = [];
  const written: Array<Record<string, unknown>> = [];

  const base: LearningRepositoryPort = {
    findCourseBySlug: async (slug) => (slug === course.slug ? course : undefined),
    findEnrolment: async () => state.enrolment,
    createEnrolment: async (input) => {
      const row: EnrolmentRow = {
        id: ENROLMENT_ID,
        courseId: input.courseId,
        userId: input.userId,
        requiredWatchPercent: input.course.requiredWatchPercent,
        passThresholdPercent: input.course.passThresholdPercent,
        maxQuizAttempts: input.course.maxQuizAttempts,
        completedAt: null,
        // Copied off the course, as the real repository does: the enrolment
        // records what the course was worth when it was taken, so re-pricing a
        // course later cannot rewrite a completed record.
        cmePoints: input.course.cmePoints,
      };
      created.push(row);
      state.enrolment = row;
      return row;
    },
    findCourseTree: async () => tree,
    findProgress: async () => state.progress,
    upsertProgress: async (input) => {
      written.push({ ...input });
    },
    hasEfn: async () => state.efn,
    hasEvaluationResponse: async () => state.evaluation,
    markCompleted: async () => undefined,
    ...overrides,
  };

  return { repository: base, created, written, state };
}

function progressRow(over: Partial<ProgressRow> & { contentId: string }): ProgressRow {
  return {
    status: "completed",
    watchedPercent: 100,
    watchedSegments: [],
    lastPositionSec: 0,
    scorePercent: null,
    updatedAt: new Date("2026-07-01T10:00:00Z"),
    ...over,
  };
}

describe("enrol", () => {
  it("snapshots the course's settings onto a new enrolment", async () => {
    // The settings must be copied, not referenced: a later edit to the course
    // cannot retroactively change what this learner signed up to (P3-01).
    const { repository, created } = fakeRepository({ enrolment: undefined });

    await new LearningService(repository).enrol(course.slug, learner);

    expect(created).toHaveLength(1);
    expect(created[0]?.requiredWatchPercent).toBe(100);
    expect(created[0]?.passThresholdPercent).toBe(70);
  });

  it("is idempotent — a second call creates nothing", async () => {
    const { repository, created } = fakeRepository();

    await new LearningService(repository).enrol(course.slug, learner);

    expect(created).toHaveLength(0);
  });

  it("returns a contract-valid state", async () => {
    const state = await new LearningService(fakeRepository().repository).enrol(
      course.slug,
      learner,
    );

    expect(() => enrolmentStateSchema.parse(state)).not.toThrow();
  });

  it("404s a course the tenant cannot see rather than disclosing it exists", async () => {
    const service = new LearningService(fakeRepository().repository);

    const error = await service.enrol("someone-elses-course", learner).catch((e) => e);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).kind).toBe("not_found");
  });
});

describe("getState — the progress ring and the module tree", () => {
  it("reports nothing done on a fresh enrolment", async () => {
    const state = await new LearningService(fakeRepository().repository).getState(
      course.slug,
      learner,
    );

    expect(state.achievedWatchPercent).toBe(0);
    expect(state.moduleCompletion).toEqual({ completed: 0, total: 2 });
    expect(state.complete).toBe(false);
  });

  it("locks the second module until the first chapter is complete", async () => {
    const state = await new LearningService(fakeRepository().repository).getState(
      course.slug,
      learner,
    );

    expect(state.modules[0]?.gate).toBe("available");
    expect(state.modules[1]?.gate).toBe("locked");
    // The widget can name the blocker rather than only showing a padlock.
    expect(state.modules[1]?.chapters[0]?.blockedBy).toBe(C1);
  });

  it("unlocks the next module once the previous chapter completes", async () => {
    const { repository } = fakeRepository({
      progress: [progressRow({ contentId: VIDEO_1 })],
    });

    const state = await new LearningService(repository).getState(course.slug, learner);

    expect(state.modules[0]?.gate).toBe("completed");
    expect(state.modules[1]?.gate).toBe("available");
    expect(state.moduleCompletion).toEqual({ completed: 1, total: 2 });
  });

  it("weights watch coverage by duration across the whole course", async () => {
    // VIDEO_1 is 600 s of the course's 1000 s, so finishing only it is 60 %.
    const { repository } = fakeRepository({
      progress: [
        progressRow({
          contentId: VIDEO_1,
          watchedSegments: [{ startSec: 0, endSec: 600 }],
        }),
      ],
    });

    const state = await new LearningService(repository).getState(course.slug, learner);

    expect(state.achievedWatchPercent).toBe(60);
  });

  it("points the resume button at the first unfinished reachable content", async () => {
    const { repository } = fakeRepository({
      progress: [progressRow({ contentId: VIDEO_1 })],
    });

    const state = await new LearningService(repository).getState(course.slug, learner);

    expect(state.resumeContentId).toBe(VIDEO_2);
  });

  it("returns a null resume target when nothing is left", async () => {
    const { repository } = fakeRepository({
      progress: [
        progressRow({ contentId: VIDEO_1 }),
        progressRow({ contentId: VIDEO_2 }),
        progressRow({ contentId: QUIZ, scorePercent: 80 }),
      ],
    });

    const state = await new LearningService(repository).getState(course.slug, learner);

    expect(state.resumeContentId).toBeNull();
  });

  it("never points the resume button into a locked chapter", async () => {
    const state = await new LearningService(fakeRepository().repository).getState(
      course.slug,
      learner,
    );

    expect(state.resumeContentId).toBe(VIDEO_1);
  });

  it("404s when the learner is not enrolled", async () => {
    const { repository } = fakeRepository({ enrolment: undefined });
    const service = new LearningService(repository);

    const error = await service.getState(course.slug, learner).catch((e) => e);

    expect((error as AppError).kind).toBe("not_found");
  });
});

describe("getState — the completion verdict", () => {
  it("names every outstanding condition rather than a bare false", async () => {
    const state = await new LearningService(fakeRepository().repository).getState(
      course.slug,
      learner,
    );

    expect(state.outstanding).toEqual(["watch", "quiz", "evaluation", "efn"]);
  });

  it("is complete only when watch, quiz, evaluation and EFN are all satisfied", async () => {
    const { repository } = fakeRepository({
      progress: [
        progressRow({
          contentId: VIDEO_1,
          watchedSegments: [{ startSec: 0, endSec: 600 }],
        }),
        progressRow({
          contentId: VIDEO_2,
          watchedSegments: [{ startSec: 0, endSec: 400 }],
        }),
        progressRow({ contentId: QUIZ, scorePercent: 80 }),
      ],
      efn: true,
      evaluation: true,
    });

    const state = await new LearningService(repository).getState(course.slug, learner);

    expect(state.achievedWatchPercent).toBe(100);
    expect(state.quizPassed).toBe(true);
    expect(state.outstanding).toEqual([]);
    expect(state.complete).toBe(true);
  });

  it("does not count a quiz scored below the threshold as passed", async () => {
    const { repository } = fakeRepository({
      progress: [progressRow({ contentId: QUIZ, scorePercent: 69 })],
    });

    const state = await new LearningService(repository).getState(course.slug, learner);

    expect(state.quizPassed).toBe(false);
    expect(state.outstanding).toContain("quiz");
  });

  it("does not ask a point-free course for an EFN", async () => {
    // An educational course carrying no CME points reports nothing to
    // EIV-FOBI, so there is nothing an EFN would identify. Demanding one would
    // collect personal data with no purpose (ADR-0004), and would leave the
    // course permanently incomplete for anybody without an EFN at all.
    const { repository } = fakeRepository({
      enrolment: { ...enrolment, cmePoints: null },
      progress: [
        progressRow({
          contentId: VIDEO_1,
          watchedSegments: [{ startSec: 0, endSec: 600 }],
        }),
        progressRow({
          contentId: VIDEO_2,
          watchedSegments: [{ startSec: 0, endSec: 400 }],
        }),
        progressRow({ contentId: QUIZ, scorePercent: 80 }),
      ],
      evaluation: true,
    });

    const state = await new LearningService(repository).getState(course.slug, learner);

    expect(state.efnPresent).toBe(false);
    expect(state.outstanding).toEqual([]);
    expect(state.complete).toBe(true);
  });

  it("never returns the EFN itself, only whether one is on file", async () => {
    // ADR-0004: the EFN is personal data with one purpose. Nothing reads it
    // back out through this surface.
    const { repository } = fakeRepository({ efn: true });

    const state = await new LearningService(repository).getState(course.slug, learner);

    expect(state.efnPresent).toBe(true);
    expect(JSON.stringify(state)).not.toMatch(/\d{15}/);
  });
});

describe("recordProgress", () => {
  const now = new Date("2026-07-01T12:00:00Z");

  it("stores the union of intervals and recomputes the percentage server-side", async () => {
    const { repository, written } = fakeRepository();

    const result = await new LearningService(repository).recordProgress(
      course.slug,
      VIDEO_1,
      {
        segments: [
          { startSec: 0, endSec: 100 },
          { startSec: 50, endSec: 200 },
        ],
      },
      learner,
      now,
    );

    // 0–200 merged out of 600 s = 33 %, computed here, not sent by the client.
    expect(result.watchedPercent).toBe(33);
    expect(written[0]?.["watchedSegments"]).toEqual([{ startSec: 0, endSec: 200 }]);
  });

  it("ignores any percentage the client might try to assert", async () => {
    const { repository } = fakeRepository();

    const result = await new LearningService(repository).recordProgress(
      course.slug,
      VIDEO_1,
      // Extra fields are not in the schema and reach nothing.
      { segments: [{ startSec: 0, endSec: 60 }] },
      learner,
      now,
    );

    expect(result.watchedPercent).toBe(10);
  });

  it("merges new intervals into previously stored ones", async () => {
    const { repository, written } = fakeRepository({
      progress: [
        progressRow({
          contentId: VIDEO_1,
          status: "in_progress",
          watchedPercent: 50,
          watchedSegments: [{ startSec: 0, endSec: 300 }],
          updatedAt: new Date("2026-07-01T11:00:00Z"),
        }),
      ],
    });

    const result = await new LearningService(repository).recordProgress(
      course.slug,
      VIDEO_1,
      { segments: [{ startSec: 300, endSec: 600 }] },
      learner,
      now,
    );

    expect(result.watchedPercent).toBe(100);
    expect(result.status).toBe("completed");
    expect(written[0]?.["watchedSegments"]).toEqual([{ startSec: 0, endSec: 600 }]);
  });

  it("rejects a segment claiming more playback than wall-clock time allows", async () => {
    // One hour of "playback" reported one minute after the last write is not
    // playback. Rejecting it is what stops a scripted client from completing a
    // 25-minute video instantly.
    const { repository } = fakeRepository({
      progress: [
        progressRow({
          contentId: VIDEO_1,
          status: "in_progress",
          watchedPercent: 0,
          watchedSegments: [],
          updatedAt: new Date("2026-07-01T11:59:00Z"),
        }),
      ],
    });

    const result = await new LearningService(repository).recordProgress(
      course.slug,
      VIDEO_1,
      { segments: [{ startSec: 0, endSec: 600 }] },
      learner,
      now,
    );

    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.reason).toBe("faster_than_wallclock");
    expect(result.watchedPercent).toBe(0);
  });

  it("names rejected segments rather than dropping them silently", async () => {
    const { repository } = fakeRepository();

    const result = await new LearningService(repository).recordProgress(
      course.slug,
      VIDEO_1,
      {
        segments: [
          { startSec: 0, endSec: 60 },
          { startSec: 500, endSec: 400 },
          { startSec: 0, endSec: 9_000 },
        ],
      },
      learner,
      now,
    );

    expect(result.accepted).toBe(1);
    expect(result.rejected.map((entry) => entry.reason)).toEqual([
      "zero_or_reversed",
      "beyond_duration",
    ]);
    expect(() => progressResultSchema.parse(result)).not.toThrow();
  });

  it("refuses progress against a locked chapter", async () => {
    // The gate has to hold at the API, not only in the UI: posting straight to
    // a later module must not walk around the sequence.
    const service = new LearningService(fakeRepository().repository);

    const error = await service
      .recordProgress(course.slug, VIDEO_2, { segments: [] }, learner, now)
      .catch((e) => e);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).kind).toBe("gate_locked");
  });

  it("allows progress once the blocking chapter is complete", async () => {
    const { repository } = fakeRepository({
      progress: [progressRow({ contentId: VIDEO_1 })],
    });

    const result = await new LearningService(repository).recordProgress(
      course.slug,
      VIDEO_2,
      { segments: [{ startSec: 0, endSec: 200 }] },
      learner,
      now,
    );

    expect(result.watchedPercent).toBe(50);
  });

  it("refuses to record watch progress against a quiz", async () => {
    const { repository } = fakeRepository({
      progress: [progressRow({ contentId: VIDEO_1 })],
    });
    const service = new LearningService(repository);

    const error = await service
      .recordProgress(course.slug, QUIZ, { segments: [] }, learner, now)
      .catch((e) => e);

    expect((error as AppError).kind).toBe("validation");
  });

  it("404s content that belongs to another course", async () => {
    const service = new LearningService(fakeRepository().repository);

    const error = await service
      .recordProgress(
        course.slug,
        "dddddddd-0000-4000-8000-000000000009",
        { segments: [] },
        learner,
        now,
      )
      .catch((e) => e);

    expect((error as AppError).kind).toBe("not_found");
  });

  it("survives a malformed stored segments column rather than trapping the learner", async () => {
    const { repository } = fakeRepository({
      progress: [
        progressRow({
          contentId: VIDEO_1,
          watchedSegments: { nonsense: true },
          updatedAt: new Date("2026-07-01T11:00:00Z"),
        }),
      ],
    });

    const result = await new LearningService(repository).recordProgress(
      course.slug,
      VIDEO_1,
      { segments: [{ startSec: 0, endSec: 300 }] },
      learner,
      now,
    );

    expect(result.watchedPercent).toBe(50);
  });
});

describe("getMaterials — the Mediathek", () => {
  it("returns a contract-valid library grouped by module", async () => {
    const library = await new LearningService(fakeRepository().repository).getMaterials(
      course.slug,
      learner,
      NOW,
    );

    expect(() => materialLibrarySchema.parse(library)).not.toThrow();
    expect(library.groups).toHaveLength(2);
    expect(library.groups[0]?.moduleTitle).toBe("Modul 1");
  });

  it("locks every module's material while nothing is complete", async () => {
    const library = await new LearningService(fakeRepository().repository).getMaterials(
      course.slug,
      learner,
      NOW,
    );

    expect(library.groups.every((group) => group.locked)).toBe(true);
  });

  it("withholds the download URL while locked — the absent URL is the gate", async () => {
    // Returning the URL next to `locked: true` and trusting the client to hide
    // it would not be a gate: the JSON is readable by anyone with the token.
    const library = await new LearningService(fakeRepository().repository).getMaterials(
      course.slug,
      learner,
      NOW,
    );

    const urls = library.groups.flatMap((group) =>
      group.materials.map((material) => material.fileUrl),
    );
    expect(urls.every((url) => url === null)).toBe(true);
    expect(JSON.stringify(library)).not.toContain("cdn.example.org");
  });

  it("unlocks a module's material once that module is complete", async () => {
    // Per module, not per course: waiting for the whole course would make the
    // Mediathek useless until the very end.
    const { repository } = fakeRepository({
      // Only the video: a download is not a step, so finishing the video is
      // what completes module 1.
      progress: [progressRow({ contentId: VIDEO_1 })],
    });

    const library = await new LearningService(repository).getMaterials(
      course.slug,
      learner,
      NOW,
    );

    expect(library.groups[0]?.locked).toBe(false);
    expect(library.groups[0]?.materials[0]?.fileUrl).toBe(
      "https://cdn.example.org/modul-1.pdf",
    );
    // Module 2 is still unfinished, so its material stays padlocked.
    expect(library.groups[1]?.locked).toBe(true);
    expect(library.groups[1]?.materials[0]?.fileUrl).toBeNull();
  });

  it("keeps the title and size visible while locked, so the padlock has a label", async () => {
    const library = await new LearningService(fakeRepository().repository).getMaterials(
      course.slug,
      learner,
      NOW,
    );

    const material = library.groups[0]?.materials[0];
    expect(material?.title).toBe("Patienteninformation (PDF)");
    expect(material?.fileSize).toBe(1024);
    expect(material?.locked).toBe(true);
  });

  it("omits modules with nothing to download rather than showing empty sections", async () => {
    const { repository } = fakeRepository(
      {},
      {
        findCourseTree: async () => ({
          ...tree,
          contents: tree.contents.filter((content) => content.kind !== "material"),
        }),
      },
    );

    const library = await new LearningService(repository).getMaterials(
      course.slug,
      learner,
      NOW,
    );

    expect(library.groups).toEqual([]);
  });

  it("404s when the learner is not enrolled", async () => {
    const { repository } = fakeRepository({ enrolment: undefined });

    const error = await new LearningService(repository)
      .getMaterials(course.slug, learner, NOW)
      .catch((e) => e);

    expect((error as AppError).kind).toBe("not_found");
  });
});

describe("getLesson — the media the player is handed", () => {
  /**
   * The security property of `resolveSources`, and the reason it loops.
   *
   * The single `video_url` it replaced was resolved once, so the tenant check on
   * an `s3://` key covered the only URL there was. A list makes it possible to
   * resolve the first and pass the rest through — which would hand a learner an
   * unsigned key belonging to another customer, with the three correctly-signed
   * siblings beside it making the response look right.
   *
   * Added after a deliberate probe: replacing the loop body with a
   * pass-through broke nothing in this suite.
   */
  // The first video in the tree — reachable with no prior progress, so these
  // assertions are about the media and not about the gate.
  const VIDEO_ID = VIDEO_1;

  function courseWithSources(
    sources: ReadonlyArray<{ url: string; mimeType: string; label: string | null }>,
  ): CourseTree {
    return {
      ...tree,
      contents: tree.contents.map((content) =>
        content.id === VIDEO_ID ? { ...content, mediaSources: sources } : content,
      ),
    };
  }

  /** Signs anything under the learner's own prefix; refuses everything else. */
  const tenantResolver: MediaResolver = {
    resolve: (stored) => {
      if (stored === null || stored === "") return null;
      if (!stored.startsWith("s3://")) return stored;
      return stored.startsWith(`s3://${CUSTOMER_ID}/`) ? `${stored}?signed` : null;
    },
  };

  it("resolves every rendition, not merely the first", async () => {
    const { repository } = fakeRepository();
    const service = new LearningService(
      {
        ...repository,
        findCourseTree: async () =>
          courseWithSources([
            { url: `s3://${CUSTOMER_ID}/a.mp4`, mimeType: "video/mp4", label: "720p" },
            { url: `s3://${CUSTOMER_ID}/b.mp4`, mimeType: "video/mp4", label: "360p" },
          ]),
      },
      tenantResolver,
    );

    const lesson = await service.getLesson(course.slug, VIDEO_ID, learner, NOW);

    expect(lesson.sources.map((source) => source.url)).toEqual([
      `s3://${CUSTOMER_ID}/a.mp4?signed`,
      `s3://${CUSTOMER_ID}/b.mp4?signed`,
    ]);
  });

  it("drops a rendition belonging to another customer and keeps the rest", async () => {
    // The bucket has no RLS to fall back on: this check is the only thing
    // between a mis-seeded row and a cross-tenant read.
    const { repository } = fakeRepository();
    const service = new LearningService(
      {
        ...repository,
        findCourseTree: async () =>
          courseWithSources([
            {
              url: "s3://11111111-1111-4111-8111-111111111111/other.mp4",
              mimeType: "video/mp4",
              label: null,
            },
            { url: `s3://${CUSTOMER_ID}/mine.mp4`, mimeType: "video/mp4", label: null },
          ]),
      },
      tenantResolver,
    );

    const lesson = await service.getLesson(course.slug, VIDEO_ID, learner, NOW);

    expect(lesson.sources).toEqual([
      { url: `s3://${CUSTOMER_ID}/mine.mp4?signed`, mimeType: "video/mp4", label: null },
    ]);
  });

  it("emits no source at all rather than one with a null URL", async () => {
    // A <source> with no `src` is one the browser tries and fails on, which is
    // worse than one that was never offered.
    const { repository } = fakeRepository();
    const service = new LearningService(
      {
        ...repository,
        findCourseTree: async () =>
          courseWithSources([
            {
              url: "s3://11111111-1111-4111-8111-111111111111/other.mp4",
              mimeType: "video/mp4",
              label: null,
            },
          ]),
      },
      tenantResolver,
    );

    const lesson = await service.getLesson(course.slug, VIDEO_ID, learner, NOW);
    expect(lesson.sources).toEqual([]);
  });

  it("orders adaptive streams ahead of progressive files, server-side", async () => {
    // Done here rather than in the client so every host — widget, portal, and
    // whatever comes next — negotiates formats the same way.
    const { repository } = fakeRepository();
    const service = new LearningService(
      {
        ...repository,
        findCourseTree: async () =>
          courseWithSources([
            { url: "https://cdn/x.mp4", mimeType: "video/mp4", label: "720p" },
            {
              url: "https://cdn/x.m3u8",
              mimeType: "application/vnd.apple.mpegurl",
              label: null,
            },
          ]),
      },
      tenantResolver,
    );

    const lesson = await service.getLesson(course.slug, VIDEO_ID, learner, NOW);
    expect(lesson.sources.map((source) => source.mimeType)).toEqual([
      "application/vnd.apple.mpegurl",
      "video/mp4",
    ]);
  });

  it("hands back the merged segments the percentage was computed from", async () => {
    // The player's coverage bar draws these. Sending the number alone would
    // leave the bar to accumulate its own, and it would then shade passages the
    // server rejected as implausible.
    const { repository } = fakeRepository({
      progress: [
        progressRow({
          contentId: VIDEO_ID,
          status: "in_progress",
          watchedPercent: 50,
          watchedSegments: [
            { startSec: 0, endSec: 100 },
            { startSec: 50, endSec: 200 },
          ],
        }),
      ],
    });
    const service = new LearningService(
      {
        ...repository,
        findCourseTree: async () =>
          courseWithSources([
            { url: "https://cdn/x.mp4", mimeType: "video/mp4", label: null },
          ]),
      },
      tenantResolver,
    );

    const lesson = await service.getLesson(course.slug, VIDEO_ID, learner, NOW);
    expect(lesson.watchedPercent).toBe(50);
    expect(lesson.watchedSegments).toEqual([
      { startSec: 0, endSec: 100 },
      { startSec: 50, endSec: 200 },
    ]);
  });
});
