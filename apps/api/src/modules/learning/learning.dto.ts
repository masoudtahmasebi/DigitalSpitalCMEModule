/**
 * Learning DTOs (P3) — the interface layer's contract.
 *
 * Mirrors `contracts/openapi.yaml`; `catalog.contract.test.ts`'s sibling here
 * asserts these stay assignable to the generated SDK types in both directions.
 *
 * Note what is absent: nothing in `EnrolmentState` is client-supplied. Every
 * percentage, every gate status and the completion verdict are computed from
 * stored rows by `@ds/domain`. The request shapes carry only raw observations
 * (which intervals played, which options were chosen) — never a conclusion.
 */

import { z } from "zod";

export const gateStatusSchema = z.enum(["locked", "available", "completed"]);

export const progressSummarySchema = z.object({
  status: z.enum(["not_started", "in_progress", "completed"]),
  completedCount: z.number().int().nonnegative(),
  totalCount: z.number().int().nonnegative(),
  percent: z.number().int().min(0).max(100),
  watchedPercent: z.number().int().min(0).max(100).optional(),
  scorePercent: z.number().int().min(0).max(100).optional(),
});

export const contentStateSchema = z.object({
  id: z.uuid(),
  gate: gateStatusSchema,
  progress: progressSummarySchema,
});

export const chapterStateSchema = z.object({
  id: z.uuid(),
  gate: gateStatusSchema,
  blockedBy: z.uuid().optional(),
  progress: progressSummarySchema,
  contents: z.array(contentStateSchema),
});

export const moduleStateSchema = z.object({
  id: z.uuid(),
  gate: gateStatusSchema,
  progress: progressSummarySchema,
  chapters: z.array(chapterStateSchema),
});

export const completionConditionSchema = z.enum(["watch", "quiz", "evaluation", "efn"]);

export const enrolmentStateSchema = z.object({
  enrolmentId: z.uuid(),
  courseSlug: z.string(),
  requiredWatchPercent: z.number().int().min(0).max(100),
  passThresholdPercent: z.number().int().min(0).max(100),
  achievedWatchPercent: z.number().int().min(0).max(100),
  quizPassed: z.boolean(),
  evaluationSubmitted: z.boolean(),
  /** Whether an EFN is on file. The EFN itself is never returned (ADR-0004). */
  efnPresent: z.boolean(),
  complete: z.boolean(),
  outstanding: z.array(completionConditionSchema),
  completedAt: z.iso.datetime().nullable(),
  progress: progressSummarySchema,
  moduleCompletion: z.object({
    completed: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  }),
  modules: z.array(moduleStateSchema),
  resumeContentId: z.uuid().nullable(),
});

/**
 * A reported playback interval.
 *
 * Seconds are `number`, not integer, because a media element reports
 * fractional currentTime; the *derived* percentage is always an integer
 * (`CLAUDE.md` §5). Bounds are re-checked server-side against the content's
 * real duration — this schema only rejects the structurally impossible.
 */
export const watchedSegmentSchema = z.object({
  startSec: z.number().nonnegative().finite(),
  endSec: z.number().nonnegative().finite(),
});

export const progressReportSchema = z.object({
  // Bounded so a client cannot send an unbounded array; a 25-minute video
  // heartbeating every few seconds produces far fewer than this.
  segments: z.array(watchedSegmentSchema).max(500),
  lastPositionSec: z.number().nonnegative().finite().optional(),
});

export const rejectedSegmentSchema = z.object({
  segment: watchedSegmentSchema,
  // Exactly `SegmentRejectionReason` from @ds/domain — the contract mirrors the
  // domain's own vocabulary rather than inventing a parallel one that drifts.
  reason: z.enum([
    "not_finite",
    "negative",
    "zero_or_reversed",
    "beyond_duration",
    "faster_than_wallclock",
  ]),
});

export const progressResultSchema = z.object({
  contentId: z.uuid(),
  watchedPercent: z.number().int().min(0).max(100),
  status: z.enum(["not_started", "in_progress", "completed"]),
  accepted: z.number().int().nonnegative(),
  rejected: z.array(rejectedSegmentSchema),
});

export type EnrolmentState = z.infer<typeof enrolmentStateSchema>;
export type ProgressReport = z.infer<typeof progressReportSchema>;
export type ProgressResult = z.infer<typeof progressResultSchema>;
export type ModuleState = z.infer<typeof moduleStateSchema>;
export type ChapterState = z.infer<typeof chapterStateSchema>;
export type ContentState = z.infer<typeof contentStateSchema>;
