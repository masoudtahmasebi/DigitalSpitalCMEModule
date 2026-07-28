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

export const contentKindSchema = z.enum(["video", "text", "quiz", "details", "material"]);

/**
 * A lesson, served only through the sequence gate.
 *
 * This is the one shape that carries `videoUrl` and `body`, and it exists
 * precisely so those never appear on a browse endpoint. `CourseDetail` lists
 * what a course contains — titles, kinds, durations — because a learner
 * choosing whether to enrol may see that. What is *inside* a lesson is behind
 * `requireReachableContent`, so a locked chapter's video URL is not reachable
 * by reading a catalog response and guessing an id.
 */
export const lessonContentSchema = z.object({
  id: z.uuid(),
  kind: contentKindSchema,
  title: z.string(),
  durationSec: z.number().int().positive().nullable(),
  videoUrl: z.string().nullable(),
  body: z.string().nullable(),
  /** Where the learner left off, so the player can resume. */
  lastPositionSec: z.number().int().nonnegative(),
  watchedPercent: z.number().int().min(0).max(100),
});

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
export type ContentKind = z.infer<typeof contentKindSchema>;
export type LessonContent = z.infer<typeof lessonContentSchema>;

/**
 * Mediathek (P5). The layout groups downloads under "Materialien zu Modul N",
 * with later modules padlocked until their content is complete.
 *
 * `fileUrl` is nullable and is **null whenever `locked`** — the gate is the
 * absent URL. A `locked: true` that the client is merely trusted to honour is
 * not a gate; anyone can read the JSON.
 */
export const materialSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  locked: z.boolean(),
  fileUrl: z.string().nullable(),
  mimeType: z.string().nullable(),
  fileSize: z.number().int().nullable(),
});

export const materialGroupSchema = z.object({
  moduleId: z.uuid(),
  moduleTitle: z.string(),
  ordinal: z.number().int(),
  locked: z.boolean(),
  materials: z.array(materialSchema),
});

export const materialLibrarySchema = z.object({
  courseSlug: z.string(),
  groups: z.array(materialGroupSchema),
});

export type Material = z.infer<typeof materialSchema>;
export type MaterialLibrary = z.infer<typeof materialLibrarySchema>;
