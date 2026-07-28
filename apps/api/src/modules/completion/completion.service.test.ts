import { describe, expect, it } from "vitest";
import { CompletionService } from "./completion.service.js";
import { evaluationSchema } from "./completion.dto.js";
import { AppError } from "../../shared/problem-details.js";
import { LearningService } from "../learning/learning.service.js";
import type {
  CompletionRepositoryPort,
  EvaluationQuestionRow,
} from "./completion.repository.js";
import type {
  CourseComplianceRow,
  CourseTree,
  EnrolmentRow,
  LearningRepositoryPort,
  ProgressRow,
} from "../learning/learning.repository.js";

const COURSE_ID = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
const ENROLMENT_ID = "a1b2c3d4-0000-4000-8000-000000000001";
const USER_ID = "11111111-0000-4000-8000-000000000001";
const CUSTOMER_ID = "22222222-0000-4000-8000-000000000001";

const M1 = "aaaaaaaa-0000-4000-8000-000000000001";
const C1 = "bbbbbbbb-0000-4000-8000-000000000001";
const VIDEO = "cccccccc-0000-4000-8000-000000000001";
const QUIZ = "cccccccc-0000-4000-8000-000000000002";
const EVAL_1 = "dddddddd-0000-4000-8000-000000000001";
const EVAL_2 = "dddddddd-0000-4000-8000-000000000002";

const EFN = "123456789012345";
const learner = { customerId: CUSTOMER_ID, userId: USER_ID };
const NOW = new Date("2026-07-28T10:00:00Z");

const course: CourseComplianceRow = {
  id: COURSE_ID,
  slug: "adhs-akademie-adult",
  requiredWatchPercent: 100,
  passThresholdPercent: 70,
  maxQuizAttempts: null,
  revealCorrectAnswers: false,
  cmePoints: 4,
  cmeCategory: "D",
  vnr: "2760552025919300018",
};

const tree: CourseTree = {
  modules: [{ id: M1, ordinal: 0, title: "Modul 1" }],
  chapters: [{ id: C1, moduleId: M1, ordinal: 0 }],
  contents: [
    {
      id: VIDEO,
      chapterId: C1,
      ordinal: 0,
      kind: "video",
      durationSec: 600,
      title: "Inhalt",
      fileUrl: null,
      mimeType: null,
      fileSize: null,
    },
    {
      id: QUIZ,
      chapterId: C1,
      ordinal: 1,
      kind: "quiz",
      durationSec: null,
      title: "Inhalt",
      fileUrl: null,
      mimeType: null,
      fileSize: null,
    },
  ],
};

const enrolment: EnrolmentRow = {
  id: ENROLMENT_ID,
  courseId: COURSE_ID,
  userId: USER_ID,
  requiredWatchPercent: 100,
  passThresholdPercent: 70,
  maxQuizAttempts: null,
  completedAt: null,
};

const questions: EvaluationQuestionRow[] = [
  {
    id: EVAL_1,
    ordinal: 0,
    kind: "scale",
    prompt: "Wie bewerten Sie die Fortbildung?",
    required: true,
    options: ["1", "2", "3", "4", "5"],
  },
  {
    id: EVAL_2,
    ordinal: 1,
    kind: "text",
    prompt: "Anmerkungen",
    required: false,
    options: [],
  },
];

/** Everything watched and passed — the state a learner reaches before completing. */
const satisfiedProgress: ProgressRow[] = [
  {
    contentId: VIDEO,
    status: "completed",
    watchedPercent: 100,
    watchedSegments: [{ startSec: 0, endSec: 600 }],
    lastPositionSec: 600,
    scorePercent: null,
    updatedAt: NOW,
  },
  {
    contentId: QUIZ,
    status: "completed",
    watchedPercent: 0,
    watchedSegments: [],
    lastPositionSec: 0,
    scorePercent: 100,
    updatedAt: NOW,
  },
];

function build(
  options: {
    progress?: ProgressRow[];
    efn?: string | undefined;
    evaluationSubmitted?: boolean;
    completedAt?: Date | null;
    hasEiv?: boolean;
    vnr?: string | null;
  } = {},
) {
  const queued: Array<Record<string, unknown>> = [];
  const savedEfn: string[] = [];
  const savedResponses: Array<Record<string, unknown>> = [];
  const completedCalls: Array<{ id: string; at: Date; attestedName: string | null }> = [];
  const efn = "efn" in options ? options.efn : undefined;

  const learningRepo: LearningRepositoryPort = {
    findCourseBySlug: async (slug) =>
      slug === course.slug
        ? { ...course, ...("vnr" in options ? { vnr: options.vnr ?? null } : {}) }
        : undefined,
    findEnrolment: async () => ({
      ...enrolment,
      completedAt: options.completedAt ?? null,
    }),
    createEnrolment: async () => enrolment,
    findCourseTree: async () => tree,
    findProgress: async () => options.progress ?? [],
    upsertProgress: async () => undefined,
    hasEfn: async () => efn !== undefined,
    hasEvaluationResponse: async () => options.evaluationSubmitted ?? false,
    markCompleted: async (id, at, attestedName) => {
      completedCalls.push({ id, at, attestedName });
    },
  };

  const completionRepo: CompletionRepositoryPort = {
    findEvaluationQuestions: async () => questions,
    hasEvaluationResponse: async () => options.evaluationSubmitted ?? false,
    saveEvaluationResponses: async (input) => {
      savedResponses.push({ ...input });
    },
    saveEfn: async (_userId, value) => {
      savedEfn.push(value);
    },
    findEfn: async () => efn,
    hasEivSubmission: async () => options.hasEiv ?? false,
    queueEivSubmission: async (input) => {
      queued.push({ ...input });
    },
  };

  const service = new CompletionService(
    completionRepo,
    new LearningService(learningRepo),
  );

  return { service, queued, savedEfn, savedResponses, completedCalls };
}

describe("getEvaluation", () => {
  it("returns a contract-valid questionnaire", async () => {
    const evaluation = await build().service.getEvaluation(course.slug, learner);

    expect(() => evaluationSchema.parse(evaluation)).not.toThrow();
    expect(evaluation.questions).toHaveLength(2);
    expect(evaluation.submitted).toBe(false);
  });

  it("reports when it has already been submitted", async () => {
    const evaluation = await build({ evaluationSubmitted: true }).service.getEvaluation(
      course.slug,
      learner,
    );

    expect(evaluation.submitted).toBe(true);
  });
});

describe("submitEvaluation", () => {
  const valid = { answers: [{ evaluationId: EVAL_1, answer: 5 }] };

  it("stores the answers and returns the updated state", async () => {
    const { service, savedResponses } = build();

    const state = await service.submitEvaluation(course.slug, valid, learner);

    expect(savedResponses).toHaveLength(1);
    expect(state.courseSlug).toBe(course.slug);
  });

  it("refuses a second submission rather than overwriting the first", async () => {
    const error = await build({ evaluationSubmitted: true })
      .service.submitEvaluation(course.slug, valid, learner)
      .catch((e) => e);

    expect((error as AppError).kind).toBe("conflict");
  });

  it("rejects an answer referencing another course's question", async () => {
    const error = await build()
      .service.submitEvaluation(
        course.slug,
        {
          answers: [{ evaluationId: "99999999-0000-4000-8000-000000000001", answer: 1 }],
        },
        learner,
      )
      .catch((e) => e);

    expect((error as AppError).kind).toBe("validation");
  });

  it("refuses when a required question is unanswered", async () => {
    const error = await build()
      .service.submitEvaluation(
        course.slug,
        { answers: [{ evaluationId: EVAL_2, answer: "nur eine Anmerkung" }] },
        learner,
      )
      .catch((e) => e);

    expect((error as AppError).kind).toBe("validation");
  });

  it("accepts an optional question being omitted", async () => {
    const { service, savedResponses } = build();

    await service.submitEvaluation(course.slug, valid, learner);

    expect(savedResponses).toHaveLength(1);
  });

  it("keeps free-text answers out of the error surface", async () => {
    // An evaluation answer is personal data (ADR-0004); it must not travel in
    // an error message that will end up in a log.
    const secret = "Ich fand die Fortbildung wegen meiner Diagnose relevant";
    const error = (await build()
      .service.submitEvaluation(
        course.slug,
        { answers: [{ evaluationId: EVAL_2, answer: secret }] },
        learner,
      )
      .catch((e) => e)) as AppError;

    expect(error.reason).not.toContain(secret);
    expect(error.clientDetail ?? "").not.toContain(secret);
  });
});

describe("setEfn", () => {
  it("stores a valid 15-digit EFN", async () => {
    const { service, savedEfn } = build();

    await service.setEfn(EFN, learner);

    expect(savedEfn).toEqual([EFN]);
  });

  it("rejects anything that is not 15 digits", async () => {
    const { service, savedEfn } = build();

    for (const bad of ["1234", "12345678901234a", "1234567890123456", ""]) {
      const error = await service.setEfn(bad, learner).catch((e) => e);
      expect((error as AppError).kind).toBe("validation");
    }

    expect(savedEfn).toEqual([]);
  });

  it("never echoes the rejected EFN back in the error", async () => {
    const bad = "999999999999999999";
    const error = (await build()
      .service.setEfn(bad, learner)
      .catch((e) => e)) as AppError;

    expect(error.reason).not.toContain(bad);
    expect(error.clientDetail ?? "").not.toContain(bad);
  });
});

describe("complete", () => {
  const ready = {
    progress: satisfiedProgress,
    efn: EFN,
    evaluationSubmitted: true,
  };

  it("refuses while any condition is outstanding, and names them", async () => {
    const error = (await build()
      .service.complete(course.slug, {}, learner, NOW)
      .catch((e) => e)) as AppError;

    expect(error.kind).toBe("conflict");
    expect(error.reason).toContain("watch");
    expect(error.reason).toContain("quiz");
  });

  it("does not queue a submission when it refuses", async () => {
    const { service, queued, completedCalls } = build();

    await service.complete(course.slug, {}, learner, NOW).catch(() => undefined);

    expect(queued).toEqual([]);
    expect(completedCalls).toEqual([]);
  });

  it("refuses with only the EFN missing, even though everything else is done", async () => {
    // Watching, passing and evaluating are not enough: without an EFN there is
    // nobody to credit the points to.
    const error = (await build({
      progress: satisfiedProgress,
      evaluationSubmitted: true,
    })
      .service.complete(course.slug, {}, learner, NOW)
      .catch((e) => e)) as AppError;

    expect(error.kind).toBe("conflict");
    expect(error.reason).toContain("efn");
  });

  it("completes and queues the Punktemeldung when every condition is met", async () => {
    const { service, queued, completedCalls } = build(ready);

    const state = await service.complete(course.slug, {}, learner, NOW);

    expect(state.completedAt).toBe(NOW.toISOString());
    expect(completedCalls).toEqual([{ id: ENROLMENT_ID, at: NOW, attestedName: null }]);
    expect(queued).toHaveLength(1);
    expect(queued[0]?.["vnr"]).toBe(course.vnr);
    expect(queued[0]?.["efn"]).toBe(EFN);
  });

  it("sets the reporting deadline 8 days out from completion", async () => {
    const { service, queued } = build(ready);

    await service.complete(course.slug, {}, learner, NOW);

    const due = queued[0]?.["reportDueAt"] as Date;
    const days = (due.getTime() - NOW.getTime()) / 86_400_000;
    // End of the 8th Berlin day, so between 8 and 9 days out depending on the
    // time of day the learner finished.
    expect(days).toBeGreaterThan(8);
    expect(days).toBeLessThan(9);
  });

  it("is idempotent — a second call does not re-queue or restart the clock", async () => {
    const { service, queued, completedCalls } = build({
      ...ready,
      completedAt: new Date("2026-07-20T09:00:00Z"),
    });

    const state = await service.complete(course.slug, {}, learner, NOW);

    expect(queued).toEqual([]);
    expect(completedCalls).toEqual([]);
    expect(state.completedAt).toBe("2026-07-20T09:00:00.000Z");
  });

  it("does not queue twice if a submission already exists", async () => {
    const { service, queued } = build({ ...ready, hasEiv: true });

    await service.complete(course.slug, {}, learner, NOW);

    expect(queued).toEqual([]);
  });

  it("still completes when the course has no VNR, rather than failing the learner", async () => {
    // A missing VNR is an authoring gap and an admin alert (P7-07), not a
    // reason to withhold a completion the learner has genuinely earned.
    const { service, queued, completedCalls } = build({ ...ready, vnr: null });

    const state = await service.complete(course.slug, {}, learner, NOW);

    expect(state.completedAt).toBe(NOW.toISOString());
    expect(completedCalls).toHaveLength(1);
    expect(queued).toEqual([]);
  });

  it("stores the name the learner attested to for the certificate", async () => {
    const { service, completedCalls } = build(ready);

    await service.complete(course.slug, { attestedName: "Dr. med. Anna Müller" }, learner, NOW);

    expect(completedCalls[0]?.attestedName).toBe("Dr. med. Anna Müller");
  });

  it("never returns the EFN in the completed state", async () => {
    const { service } = build(ready);

    const state = await service.complete(course.slug, {}, learner, NOW);

    expect(JSON.stringify(state)).not.toContain(EFN);
    expect(state.efnPresent).toBe(true);
  });
});
