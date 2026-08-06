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
/**
 * A watched interval, as the client observed it.
 *
 * Declared here rather than beside the progress report because `LessonContent`
 * now returns the merged union too, and a `const` schema referenced before its
 * own declaration is a temporal-dead-zone crash at module load — not a type
 * error, so nothing but running it would have caught it.
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

/**
 * One playable rendition.
 *
 * A list rather than a single URL because a browser takes the first `<source>`
 * whose `type` it can play and skips the rest — which is the whole of the
 * platform's format negotiation, and needs an ordered list to express.
 */
export const mediaSourceSchema = z.object({
  url: z.string(),
  mimeType: z.string(),
  label: z.string().nullable(),
});

export const lessonContentSchema = z.object({
  id: z.uuid(),
  kind: contentKindSchema,
  title: z.string(),
  durationSec: z.number().int().positive().nullable(),
  /**
   * Already resolved: signed for our storage, passed through for the
   * customer's own CDN. Empty for anything that is not playable media, and for
   * a video whose renditions all failed the tenant check — a padlock rather
   * than an error, the same degradation the single URL used to have.
   */
  sources: z.array(mediaSourceSchema),
  /**
   * Without a poster the element renders a black rectangle until the first
   * frame decodes, and the layout's centred play button sits on nothing.
   */
  posterUrl: z.string().nullable(),
  /**
   * WebVTT captions, when the author supplied them.
   *
   * Travels with the video rather than being fetched separately: a `<track>`
   * the player has to discover is a `<track>` that is sometimes missing, and
   * captions are a Level A requirement rather than an enhancement.
   */
  captionsUrl: z.string().nullable(),
  body: z.string().nullable(),
  /** Where the learner left off, as last reported and stored. */
  lastPositionSec: z.number().int().nonnegative(),
  /**
   * Where playback should actually start — `lastPositionSec` rewound to the
   * containing minute.
   *
   * A learner who left at 14:35 resumes at 14:00. Decided by the server
   * (`resumePosition` in `@ds/domain`) rather than by the player, so every
   * host rewinds by the same amount and the rule sits with the other rules
   * about what a learner is shown of a course that awards a CME point.
   */
  resumeAtSec: z.number().int().nonnegative(),
  /**
   * The furthest second the player may seek to.
   *
   * Forward seeking is what makes a watch gate decorative, so the scrub bar is
   * clamped to what has actually been watched. Backwards is unrestricted —
   * re-watching is legitimate and, because coverage is a union, free.
   *
   * The client already holds `watchedSegments` and could compute this, but the
   * *rule* about what they permit lives in one place and that place is the
   * server. The API validates every reported segment regardless; this is the
   * courtesy that stops the control offering a position that would then be
   * refused.
   */
  seekCeilingSec: z.number().int().nonnegative(),
  watchedPercent: z.number().int().min(0).max(100),
  /**
   * The merged intervals behind `watchedPercent`, so the scrub bar can shade
   * what has been covered — and still shade it after a reload.
   *
   * Sent rather than left to the client to accumulate for the same reason the
   * percentage is: these are the exact intervals the figure was derived from,
   * so the bar and the number cannot tell different stories. The learner's own
   * data, on an endpoint already behind the sequence gate.
   */
  watchedSegments: z.array(watchedSegmentSchema),
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
  /**
   * The union after this report.
   *
   * The player redraws its coverage bar from this rather than from what it
   * believed it sent, and the difference shows exactly when a segment was
   * rejected: an optimistic local bar would display credit the gate withheld.
   */
  watchedSegments: z.array(watchedSegmentSchema),
  /**
   * The seek ceiling after this report.
   *
   * Returned for the same reason the union is: the player's limit has to
   * advance as the learner watches, and the alternative — the player deriving
   * it from `watchedSegments` itself — would be a second implementation of a
   * rule that decides what counts towards a CME point (CLAUDE.md §4 invariant
   * 6). One computation, on the server, sent to whoever needs it.
   */
  seekCeilingSec: z.number().nonnegative(),
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
