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

/**
 * Video then quiz in the same chapter — the shape every author builds.
 *
 * The quiz is **not** reachable from the start any more (P87-04): a module's
 * Lernerfolgskontrolle waits for that module's videos. This file is about the
 * quiz engine rather than about the gate, so `build` credits the video by
 * default and `WATCHED` says so out loud; the gate has its own test at the
 * bottom, and it is the one that would go red if the rule were removed.
 */
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

/**
 * The module's video, watched end to end — the precondition for opening its
 * Lernerfolgskontrolle (P87-04).
 *
 * Every test below that reaches the quiz starts from here, because reaching the
 * quiz is now something a learner earns rather than the default state. Passing
 * `progress: []` restores the unwatched case, which is what the gate test does.
 */
const WATCHED: readonly ProgressRow[] = [
  {
    contentId: VIDEO,
    status: "completed",
    watchedPercent: 100,
    watchedSegments: [{ startSec: 0, endSec: 600 }],
    lastPositionSec: 600,
    scorePercent: null,
    updatedAt: new Date("2026-07-28T09:00:00Z"),
  },
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
    findProgress: async () => options_.progress ?? [...WATCHED],
    upsertProgress: async () => undefined,
    findSubmissionState: async () => undefined,
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

  /*
   * P169-01. A certified enrolment sits no more exams.
   *
   * The client: *"we shouldn't let the user fill the exam again, when he has
   * cleared the exam already and certificate is issued."*
   *
   * The pass was never at risk — `bestScorePercent` is best-of — which is
   * precisely why nothing complained for nine phases: what changes is the
   * assessment record behind a Teilnahmebescheinigung that has already been
   * issued and a Punktemeldung that has already been filed.
   */
  it("refuses an attempt once the certificate has been issued", async () => {
    const { service, recorded } = build({
      enrolmentOverrides: { completedAt: new Date("2026-08-01T09:00:00Z") },
    });

    const error = await service
      .submit(course.slug, QUIZ, allCorrect, learner)
      .catch((e) => e);

    expect((error as AppError).kind).toBe("conflict");
    // And nothing was written. A refusal that still records the attempt would
    // be the defect with an error message on top.
    expect(recorded).toEqual([]);
  });

  /*
   * P170-01. The line is the pass, not the certificate.
   *
   * The client, the day after P169-01 shipped: *"if someone has passed a
   * lernerfolgskontrolle, we shouldn't let that user fill the
   * lernerfolgskontrolle again, when he has cleared the exam already."*
   */
  it("refuses an attempt once this exam has been passed", async () => {
    const { service, recorded } = build({ attempts: 1, bestScore: 100 });

    const error = await service
      .submit(course.slug, QUIZ, allCorrect, learner)
      .catch((e) => e);

    expect((error as AppError).kind).toBe("conflict");
    expect(recorded).toEqual([]);
  });

  it("refuses it at the threshold exactly, not only above it", async () => {
    // 70 % against a 70 % threshold is a pass, and `upsertQuizProgress` uses
    // the same `>=`. An exam that reopened at exactly the pass mark would be
    // open for every learner who scraped through.
    const { service } = build({ attempts: 1, bestScore: 70 });

    const error = await service
      .submit(course.slug, QUIZ, allCorrect, learner)
      .catch((e) => e);

    expect((error as AppError).kind).toBe("conflict");
  });

  it("still allows a retry after a failed attempt", async () => {
    // The half that must not move: an exam is closed by passing it, not by
    // having been sat. 60 % against 70 % leaves it open.
    const { service } = build({ attempts: 1, bestScore: 60 });

    const result = await service.submit(course.slug, QUIZ, allCorrect, learner);

    expect(result.attemptNumber).toBe(2);
    expect(result.passed).toBe(true);
  });

  it("measures against the enrolment's threshold, not the course's current one", async () => {
    /*
     * The enrolment snapshots `passThresholdPercent`. A course later tightened
     * to 90 % must not reopen an exam somebody passed at 80 under the rule they
     * enrolled on — that would be a retroactive change to a completed
     * assessment, which is the thing enrolment snapshots exist to prevent.
     */
    const { service } = build({
      attempts: 1,
      bestScore: 80,
      courseOverrides: { passThresholdPercent: 90 },
      enrolmentOverrides: { passThresholdPercent: 70 },
    });

    const error = await service
      .submit(course.slug, QUIZ, allCorrect, learner)
      .catch((e) => e);

    expect((error as AppError).kind).toBe("conflict");
  });

  it("still allows a retry before certification", async () => {
    // The half that keeps this from being "passed once, closed for ever". A
    // physician improving their score before claiming the point is doing
    // something the platform has always allowed, and `courseCompletedAt` — the
    // course being finished — is not what closes it.
    const { service } = build({
      attempts: 1,
      enrolmentOverrides: {
        completedAt: null,
        courseCompletedAt: new Date("2026-08-01T09:00:00Z"),
      },
    });

    const result = await service.submit(course.slug, QUIZ, allCorrect, learner);

    expect(result.attemptNumber).toBe(2);
  });

  it("allows unlimited attempts when the enrolment sets no limit", async () => {
    const { service } = build({ attempts: 99 });

    const result = await service.submit(course.slug, QUIZ, allCorrect, learner);

    expect(result.attemptNumber).toBe(100);
  });

  /*
   * This case used to be "keeps the best score, so a curious retry cannot lose
   * an earned pass", with a stored best of 100 and a fresh attempt of 0.
   *
   * P170-01 removed the situation it described: a curious retry after a pass is
   * refused, so there is no longer a way to submit an attempt while a passing
   * score is on file. The rule underneath survives and still matters between
   * *failing* attempts — a learner who scores 60 then 20 keeps the 60 — so the
   * case is rewritten to the half that is still reachable rather than deleted
   * along with the behaviour it was guarding.
   */
  it("keeps the best of several failing attempts", async () => {
    const { service, progressWrites } = build({ attempts: 1, bestScore: 60 });

    await service.submit(
      course.slug,
      QUIZ,
      { answers: [{ questionId: Q1, selectedOptionIds: [Q1_WRONG] }] },
      learner,
    );

    expect(progressWrites[0]?.["scorePercent"]).toBe(60);
    // 60 is under the enrolment's 70 % threshold, so the exam stays open.
    expect(progressWrites[0]?.["passed"]).toBe(false);
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
      findSubmissionState: async () => undefined,
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

describe("the module's own gate", () => {
  const allCorrect = {
    answers: [
      { questionId: Q1, selectedOptionIds: [Q1_RIGHT] },
      { questionId: Q2, selectedOptionIds: [Q2_RIGHT] },
    ],
  };

  /*
   * P87-04, at the endpoint rather than on the screen.
   *
   * The widget stops drawing „Lernerfolgskontrolle beginnen" until the module's
   * videos are watched, and that is a rendering decision. This is the rule: a
   * physician who posts straight to the quiz — or opens it from a stale tab, or
   * from a link a colleague sent — gets the same answer as the one who looked
   * at the screen. Otherwise the watch requirement is a decoration
   * (CLAUDE.md §4 invariant 1).
   *
   * `progress: []` is the whole fixture change: the same course, the same
   * enrolment, the same quiz, with the module's video unwatched.
   */
  it("refuses the quiz until this module's video is watched", async () => {
    const { service } = build({ progress: [] });

    const error = await service.getQuiz(course.slug, QUIZ, learner).catch((e) => e);

    expect((error as AppError).kind).toBe("gate_locked");
    // Names the field, never a value, and tells the learner what to do next
    // (§9.4): "finish the videos", not "locked".
    expect((error as AppError).clientDetail).toContain("Videos dieses Moduls");
  });

  it("refuses a submission to it as well, not only the read", async () => {
    // Two entry points, one rule. The read being gated and the write not is how
    // a gate becomes advisory.
    const { service } = build({ progress: [] });

    const error = await service
      .submit(course.slug, QUIZ, allCorrect, learner)
      .catch((e) => e);

    expect((error as AppError).kind).toBe("gate_locked");
  });

  it("opens once it is watched — the control for both refusals above", async () => {
    // Without this the two assertions would pass on a service that refuses
    // every quiz for every reason (§9.1).
    const { service } = build();

    await expect(service.getQuiz(course.slug, QUIZ, learner)).resolves.toBeDefined();
  });
});
