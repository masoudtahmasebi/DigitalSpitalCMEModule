/**
 * Assessment DTOs (P4) — the interface layer's contract.
 *
 * The property that matters most here is an absence: **no learner-facing shape
 * below has anywhere to put a correctness marker.** `QuizOption` carries an id,
 * an ordinal and a label, and that is all. P4-01 is not enforced by remembering
 * to strip a field — it is enforced by the field not existing, which is the only
 * version of that guarantee that survives a future edit by someone who has not
 * read this comment.
 */

import { z } from "zod";

export const quizOptionSchema = z.object({
  id: z.uuid(),
  ordinal: z.number().int(),
  label: z.string(),
});

export const quizQuestionSchema = z.object({
  id: z.uuid(),
  ordinal: z.number().int(),
  kind: z.enum(["single", "multi"]),
  prompt: z.string(),
  options: z.array(quizOptionSchema),
});

export const quizSchema = z.object({
  contentId: z.uuid(),
  passThresholdPercent: z.number().int().min(0).max(100),
  attemptsUsed: z.number().int().nonnegative(),
  /** Null means unlimited, which is the MEDICE configuration. */
  maxAttempts: z.number().int().positive().nullable(),
  questions: z.array(quizQuestionSchema),
});

export const quizAnswerSchema = z.object({
  questionId: z.uuid(),
  selectedOptionIds: z.array(z.uuid()),
});

export const quizSubmissionSchema = z.object({
  answers: z.array(quizAnswerSchema),
});

export const quizAttemptResultSchema = z.object({
  attemptNumber: z.number().int().positive(),
  correctCount: z.number().int().nonnegative(),
  totalCount: z.number().int().nonnegative(),
  scorePercent: z.number().int().min(0).max(100),
  passed: z.boolean(),
  passThresholdPercent: z.number().int().min(0).max(100),
  /**
   * Present only when the course sets `revealCorrectAnswers`. A CME-certified
   * course never does — revealing which questions were right turns unlimited
   * retries into a way to read the answer key out one attempt at a time.
   */
  perQuestion: z.record(z.string(), z.boolean()).optional(),
});

export type Quiz = z.infer<typeof quizSchema>;
export type QuizSubmission = z.infer<typeof quizSubmissionSchema>;
export type QuizAttemptResult = z.infer<typeof quizAttemptResultSchema>;
