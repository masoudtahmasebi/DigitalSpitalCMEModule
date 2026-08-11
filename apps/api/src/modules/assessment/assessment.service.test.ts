import { describe, expect, it } from "vitest";
import { AssessmentService } from "./assessment.service.js";
import { quizAttemptResultSchema, quizSchema } from "./assessment.dto.js";
import { AppError } from "../../shared/problem-details.js";
import { LearningService } from "../learning/learning.service.js";
import type {
  AssessmentRepositoryPort,
  AnswerKeyRow,
  LearnerOptionRow,
  LearnerQuestionRow,
} from "./assessment.repository.js";
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

const Q1 = "dddddddd-0000-4000-8000-000000000001";
const Q2 = "dddddddd-0000-4000-8000-000000000002";
const Q1_RIGHT = "eeeeeeee-0000-4000-8000-000000000001";
const Q1_WRONG = "eeeeeeee-0000-4000-8000-000000000002";
const Q2_RIGHT = "eeeeeeee-0000-4000-8000-000000000003";
const Q2_WRONG = "eeeeeeee-0000-4000-8000-000000000004";

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
  status: "published" as const,
  validFrom: null,
  validTo: null,
};

/** Video then quiz in the same chapter, so the quiz is reachable from the start. */
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
      chapterId: C1,
      ordinal: 1,
      kind: "quiz",
      durationSec: null,
      title: "Inhalt",
      body: null,
      mediaSources: [],
      posterUrl: null,
      captionsUrl: null,
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
  /** A day before `NOW` — see the note in `learning.service.test.ts` (P55-01). */
  createdAt: new Date("2026-07-27T10:00:00Z"),
  completedAt: null,
  courseCompletedAt: null,
  cmePoints: 4,
};

const questions: LearnerQuestionRow[] = [
  { id: Q1, ordinal: 0, kind: "single", prompt: "Welche Aussage trifft zu?" },
  { id: Q2, ordinal: 1, kind: "single", prompt: "Welche Dosierung ist korrekt?" },
];

const options: LearnerOptionRow[] = [
  { id: Q1_RIGHT, questionId: Q1, ordinal: 0, label: "Richtige Antwort" },
  { id: Q1_WRONG, questionId: Q1, ordinal: 1, label: "Falsche Antwort" },
  { id: Q2_RIGHT, questionId: Q2, ordinal: 0, label: "Richtige Antwort" },
  { id: Q2_WRONG, questionId: Q2, ordinal: 1, label: "Falsche Antwort" },
];

const answerKey: AnswerKeyRow[] = [
  { questionId: Q1, kind: "single", correctOptionIds: [Q1_RIGHT] },
  { questionId: Q2, kind: "single", correctOptionIds: [Q2_RIGHT] },
];

function build(
  options_: {
    attempts?: number;
    bestScore?: number | null;
    courseOverrides?: Partial<CourseComplianceRow>;
    enrolmentOverrides?: Partial<EnrolmentRow>;
    progress?: ProgressRow[];
  } = {},
) {
  const recorded: Array<Record<string, unknown>> = [];
  const progressWrites: Array<Record<string, unknown>> = [];
  let attempts = options_.attempts ?? 0;

  const learningRepo: LearningRepositoryPort = {
    findCourseBySlug: async (slug) =>
      slug === course.slug ? { ...course, ...options_.courseOverrides } : undefined,
    findEnrolment: async () => ({ ...enrolment, ...options_.enrolmentOverrides }),
    createEnrolment: async () => enrolment,
    findCourseTree: async () => tree,
    findProgress: async () => options_.progress ?? [],
    upsertProgress: async () => undefined,
    hasEfn: async () => false,
    hasEvaluationResponse: async () => false,
    markCompleted: async () => undefined,
    markCourseCompleted: async () => undefined,
  };

  const assessmentRepo: AssessmentRepositoryPort = {
    findQuestionsForLearner: async () => ({ questions, options }),
    findAnswerKey: async () => answerKey,
    countAttempts: async () => attempts,
    recordAttempt: async (input) => {
      recorded.push({ ...input });
      attempts += 1;
    },
    bestScorePercent: async () =>
      options_.bestScore === undefined
        ? ((recorded.at(-1)?.["scorePercent"] as number | undefined) ?? null)
        : options_.bestScore,
    upsertQuizProgress: async (input) => {
      progressWrites.push({ ...input });
    },
  };

  const service = new AssessmentService(
    assessmentRepo,
    new LearningService(learningRepo),
  );

  return { service, recorded, progressWrites };
}

describe("getQuiz", () => {
  it("returns a contract-valid quiz", async () => {
    const quiz = await build().service.getQuiz(course.slug, QUIZ, learner);

    expect(() => quizSchema.parse(quiz)).not.toThrow();
    expect(quiz.questions).toHaveLength(2);
    expect(quiz.passThresholdPercent).toBe(70);
  });

  it("carries no correctness marker anywhere in the payload", async () => {
    // P4-01. The shape has nowhere to put one, so this asserts the shape.
    const quiz = await build().service.getQuiz(course.slug, QUIZ, learner);
    const serialised = JSON.stringify(quiz);

    expect(serialised).not.toContain("isCorrect");
    expect(serialised).not.toContain("is_correct");
    expect(serialised).not.toContain("correct");
    expect(serialised).not.toContain(Q1_RIGHT.slice(0, 8) + "-CORRECT");
  });

  it("reports attempts used so the widget can show what is left", async () => {
    const quiz = await build({ attempts: 2 }).service.getQuiz(course.slug, QUIZ, learner);

    expect(quiz.attemptsUsed).toBe(2);
    expect(quiz.maxAttempts).toBeNull();
  });

  it("refuses a content id that is not a quiz", async () => {
    const error = await build()
      .service.getQuiz(course.slug, VIDEO, learner)
      .catch((e) => e);

    expect((error as AppError).kind).toBe("validation");
  });

  it("404s a quiz belonging to another course", async () => {
    const error = await build()
      .service.getQuiz(course.slug, "ffffffff-0000-4000-8000-000000000009", learner)
      .catch((e) => e);

    expect((error as AppError).kind).toBe("not_found");
  });
});

describe("submit", () => {
  const allCorrect = {
    answers: [
      { questionId: Q1, selectedOptionIds: [Q1_RIGHT] },
      { questionId: Q2, selectedOptionIds: [Q2_RIGHT] },
    ],
  };

  it("scores server-side and passes at or above the threshold", async () => {
    const result = await build().service.submit(course.slug, QUIZ, allCorrect, learner);

    expect(result.scorePercent).toBe(100);
    expect(result.passed).toBe(true);
    expect(result.attemptNumber).toBe(1);
    expect(() => quizAttemptResultSchema.parse(result)).not.toThrow();
  });

  it("fails below the threshold — 50 % against 70 % is not a pass", async () => {
    const result = await build().service.submit(
      course.slug,
      QUIZ,
      {
        answers: [
          { questionId: Q1, selectedOptionIds: [Q1_RIGHT] },
          { questionId: Q2, selectedOptionIds: [Q2_WRONG] },
        ],
      },
      learner,
    );

    expect(result.scorePercent).toBe(50);
    expect(result.passed).toBe(false);
  });

  it("withholds per-question correctness unless the course reveals answers", async () => {
    // With unlimited retries, per-question feedback is the answer key in slow
    // motion — a CME-certified course never sets this.
    const result = await build().service.submit(course.slug, QUIZ, allCorrect, learner);

    expect(result.perQuestion).toBeUndefined();
  });

  it("includes per-question correctness for a course that awards no points", async () => {
    // The case the setting exists for: educational material with no accredited
    // assessment to protect, where immediate feedback is the point of it.
    const result = await build({
      courseOverrides: { revealCorrectAnswers: true, cmePoints: null },
    }).service.submit(course.slug, QUIZ, allCorrect, learner);

    expect(result.perQuestion).toEqual({ [Q1]: true, [Q2]: true });
  });

  it("withholds it for an accredited course even when the column says otherwise", async () => {
    /*
     * P56-01, and the case this file previously asserted the *other* way: the
     * old version of the test above set `revealCorrectAnswers` on a course
     * worth 4 CME points and expected the answer key back, which is what the
     * service did.
     *
     * The database now refuses to store that combination
     * (`courses_no_answer_key_for_points`), so this state is unreachable
     * through the product — which is exactly why it is worth a test here. A
     * constraint added later can be dropped later; the rule is
     * `mayRevealCorrectAnswers`, and this is the assertion that the service
     * asks it rather than reading the column.
     */
    const result = await build({
      courseOverrides: { revealCorrectAnswers: true, cmePoints: 4 },
    }).service.submit(course.slug, QUIZ, allCorrect, learner);

    expect(result.perQuestion).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain(Q1);
  });

  it("never returns the correct option ids, even on a wrong answer", async () => {
    const result = await build().service.submit(
      course.slug,
      QUIZ,
      { answers: [{ questionId: Q1, selectedOptionIds: [Q1_WRONG] }] },
      learner,
    );

    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain(Q1_RIGHT);
    expect(serialised).not.toContain(Q2_RIGHT);
  });

  it("records the attempt with its per-answer evidence", async () => {
    // A score with nothing behind it is not much of a compliance record.
    const { service, recorded } = build();

    await service.submit(course.slug, QUIZ, allCorrect, learner);

    expect(recorded[0]?.["attemptNumber"]).toBe(1);
    expect(recorded[0]?.["answers"]).toHaveLength(2);
  });

  it("numbers attempts consecutively", async () => {
    const { service } = build({ attempts: 2 });

    const result = await service.submit(course.slug, QUIZ, allCorrect, learner);

    expect(result.attemptNumber).toBe(3);
  });

  it("refuses once the attempt limit is exhausted", async () => {
    const { service } = build({
      attempts: 3,
      enrolmentOverrides: { maxQuizAttempts: 3 },
    });

    const error = await service
      .submit(course.slug, QUIZ, allCorrect, learner)
      .catch((e) => e);

    expect((error as AppError).kind).toBe("forbidden");
  });

  it("allows unlimited attempts when the enrolment sets no limit", async () => {
    const { service } = build({ attempts: 99 });

    const result = await service.submit(course.slug, QUIZ, allCorrect, learner);

    expect(result.attemptNumber).toBe(100);
  });

  it("keeps the best score, so a curious retry cannot lose an earned pass", async () => {
    const { service, progressWrites } = build({ attempts: 1, bestScore: 100 });

    await service.submit(
      course.slug,
      QUIZ,
      { answers: [{ questionId: Q1, selectedOptionIds: [Q1_WRONG] }] },
      learner,
    );

    expect(progressWrites[0]?.["scorePercent"]).toBe(100);
    expect(progressWrites[0]?.["passed"]).toBe(true);
  });

  it("rejects answers referencing a question outside this quiz", async () => {
    const error = await build()
      .service.submit(
        course.slug,
        QUIZ,
        {
          answers: [
            { questionId: "99999999-0000-4000-8000-000000000001", selectedOptionIds: [] },
          ],
        },
        learner,
      )
      .catch((e) => e);

    expect((error as AppError).kind).toBe("validation");
  });

  it("treats an unanswered question as wrong rather than skipping it", async () => {
    // Otherwise answering only the questions you know would score 100 %.
    const result = await build().service.submit(
      course.slug,
      QUIZ,
      { answers: [{ questionId: Q1, selectedOptionIds: [Q1_RIGHT] }] },
      learner,
    );

    expect(result.totalCount).toBe(2);
    expect(result.scorePercent).toBe(50);
    expect(result.passed).toBe(false);
  });

  it("refuses submission against a locked chapter", async () => {
    const lockedTree: CourseTree = {
      modules: [
        { id: M1, ordinal: 0, title: "Modul 1" },
        { id: "aaaaaaaa-0000-4000-8000-000000000002", ordinal: 1, title: "Modul 2" },
      ],
      chapters: [
        { id: C1, moduleId: M1, ordinal: 0 },
        {
          id: "bbbbbbbb-0000-4000-8000-000000000002",
          moduleId: "aaaaaaaa-0000-4000-8000-000000000002",
          ordinal: 1,
        },
      ],
      contents: [
        {
          id: VIDEO,
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
          id: QUIZ,
          chapterId: "bbbbbbbb-0000-4000-8000-000000000002",
          ordinal: 0,
          kind: "quiz",
          durationSec: null,
          title: "Quiz",
          body: null,
          mediaSources: [],
          posterUrl: null,
          captionsUrl: null,
          fileUrl: null,
          mimeType: null,
          fileSize: null,
        },
      ],
    };

    const learningRepo: LearningRepositoryPort = {
      findCourseBySlug: async () => course,
      findEnrolment: async () => enrolment,
      createEnrolment: async () => enrolment,
      findCourseTree: async () => lockedTree,
      findProgress: async () => [],
      upsertProgress: async () => undefined,
      hasEfn: async () => false,
      hasEvaluationResponse: async () => false,
      markCompleted: async () => undefined,
      markCourseCompleted: async () => undefined,
    };

    const assessmentRepo: AssessmentRepositoryPort = {
      findQuestionsForLearner: async () => ({ questions, options }),
      findAnswerKey: async () => answerKey,
      countAttempts: async () => 0,
      recordAttempt: async () => undefined,
      bestScorePercent: async () => null,
      upsertQuizProgress: async () => undefined,
    };

    const service = new AssessmentService(
      assessmentRepo,
      new LearningService(learningRepo),
    );

    const error = await service
      .submit(course.slug, QUIZ, allCorrect, learner)
      .catch((e) => e);

    expect((error as AppError).kind).toBe("gate_locked");
  });
});
