/**
 * Shared types for the pure compliance core.
 *
 * These mirror the schema in `db/migrations/0001_init.sql` but deliberately
 * carry only the fields the compliance rules actually read. Anything a rule
 * does not need does not belong here — a smaller surface is a smaller set of
 * things a generated caller can get wrong.
 */

export type ContentKind = "video" | "text" | "quiz" | "details";

export type ContentStatus = "not_started" | "in_progress" | "completed";

export interface ContentNode {
  readonly id: string;
  readonly kind: ContentKind;
  /** Required for video content — the watch gate cannot be evaluated without it. */
  readonly durationSec?: number;
}

export interface ChapterNode {
  readonly id: string;
  readonly ordinal: number;
  readonly contents: readonly ContentNode[];
}

export interface ModuleNode {
  readonly id: string;
  readonly ordinal: number;
  readonly chapters: readonly ChapterNode[];
}

export interface CourseNode {
  readonly id: string;
  readonly modules: readonly ModuleNode[];
}

/**
 * The compliance settings in force for one learner on one course.
 *
 * Snapshotted onto the enrolment at creation (P3-01) so that a later change to
 * the course record cannot retroactively invalidate work already done.
 */
export interface EnrolmentSnapshot {
  /** Integer 0–100. MEDICE ships at 100. */
  readonly requiredWatchPercent: number;
  /** Integer 0–100. MEDICE ships at 70. */
  readonly passThresholdPercent: number;
}

export interface ContentProgressRecord {
  readonly contentId: string;
  readonly status: ContentStatus;
  /** Integer 0–100, server-computed from watched segments. Video content only. */
  readonly watchedPercent?: number;
  /** Integer 0–100 from the best scored attempt. Quiz content only. */
  readonly scorePercent?: number;
}
