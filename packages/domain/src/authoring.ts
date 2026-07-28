/**
 * The rules that govern editing a course (P9-04, P9-05).
 *
 * Authoring looks like ordinary CRUD and is not. Three of the things an author
 * can do here change what the platform will later certify:
 *
 * 1. **Ordering defines gating.** A chapter's position decides what a learner
 *    must finish before reaching it (`gating.ts`). Reordering is therefore a
 *    compliance-adjacent operation, and an ordering operation that silently
 *    drops an item removes it from a course somebody is part-way through.
 * 2. **A video without a duration cannot be gated.** The watch requirement is a
 *    percentage of a known length; with no length there is no percentage, and
 *    the content would be skippable while appearing to count.
 * 3. **Deleting content deletes evidence.** A learner's recorded progress, quiz
 *    answers and evaluation responses point at these rows. Removing one after a
 *    physician has been credited a CME point destroys the record of what earned
 *    it.
 *
 * So these are decisions, not validation, and they live here where they are
 * exhaustively testable and cannot be quietly bypassed by a second code path.
 */

/** What kind of thing an author is arranging. Used only in messages. */
export type OrderedKind = "module" | "chapter" | "content" | "question" | "option";

export type ReorderRejection =
  | { readonly reason: "missing"; readonly ids: readonly string[] }
  | { readonly reason: "unknown"; readonly ids: readonly string[] }
  | { readonly reason: "duplicated"; readonly ids: readonly string[] };

export type ReorderResult =
  | { readonly ok: true; readonly ordered: readonly string[] }
  | { readonly ok: false; readonly rejection: ReorderRejection };

/**
 * Check that a proposed ordering is a **permutation** of what exists.
 *
 * Not a subset, not a superset — exactly the same set, rearranged. A drag-and-
 * drop UI that loses an item during a re-render would otherwise send a shorter
 * list, and a naive implementation would obediently delete the missing chapter
 * from a course learners are half-way through. The three rejections are
 * distinguished because they mean different things to whoever is debugging:
 * `missing` is a client that lost something, `unknown` is a stale client acting
 * on a tree that has since changed, `duplicated` is a client bug outright.
 *
 * Order of the returned array is the caller's order; position *is* the new
 * ordinal.
 */
export function validateReorder(
  existing: readonly string[],
  proposed: readonly string[],
): ReorderResult {
  const seen = new Set<string>();
  const duplicated: string[] = [];

  for (const id of proposed) {
    if (seen.has(id)) duplicated.push(id);
    seen.add(id);
  }
  if (duplicated.length > 0) {
    return { ok: false, rejection: { reason: "duplicated", ids: duplicated } };
  }

  const current = new Set(existing);
  const unknown = proposed.filter((id) => !current.has(id));
  if (unknown.length > 0) {
    return { ok: false, rejection: { reason: "unknown", ids: unknown } };
  }

  const missing = existing.filter((id) => !seen.has(id));
  if (missing.length > 0) {
    return { ok: false, rejection: { reason: "missing", ids: missing } };
  }

  return { ok: true, ordered: proposed };
}

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

export type ContentKind = "video" | "text" | "quiz" | "details" | "material";

export interface ContentDraft {
  readonly kind: ContentKind;
  readonly title: string;
  readonly body?: string | null;
  readonly videoUrl?: string | null;
  readonly durationSec?: number | null;
  readonly fileUrl?: string | null;
  readonly mimeType?: string | null;
}

/** Field names, so a form can mark the right input rather than shout globally. */
export type ContentProblem = "title" | "videoUrl" | "durationSec" | "fileUrl" | "body";

/**
 * What is wrong with a content item, if anything.
 *
 * Per kind, because the kinds genuinely differ — and the one that matters is
 * `video`. `duration_sec` has a CHECK constraint behind it too, but a
 * constraint violation surfaces as a 500-shaped database error; an author
 * needs to be told which field and why.
 */
export function contentProblems(draft: ContentDraft): readonly ContentProblem[] {
  const problems: ContentProblem[] = [];

  if (draft.title.trim() === "") problems.push("title");

  switch (draft.kind) {
    case "video":
      if (blank(draft.videoUrl)) problems.push("videoUrl");
      // The watch gate is a percentage of a known length. Without one there is
      // no percentage to reach, and the content would be skippable while
      // appearing to count toward a CME point.
      if (
        draft.durationSec === undefined ||
        draft.durationSec === null ||
        !Number.isInteger(draft.durationSec) ||
        draft.durationSec <= 0
      ) {
        problems.push("durationSec");
      }
      break;

    case "material":
      if (blank(draft.fileUrl)) problems.push("fileUrl");
      break;

    case "text":
    case "details":
      if (blank(draft.body)) problems.push("body");
      break;

    case "quiz":
      // A quiz item carries no body of its own — its questions are separate
      // rows, authored on their own screen.
      break;
  }

  return problems;
}

// ---------------------------------------------------------------------------
// Deletion
// ---------------------------------------------------------------------------

/**
 * Whether something an author wants to delete is still holding evidence.
 *
 * `learnerRecords` is however many rows across progress, attempts, answers and
 * responses point at it. Anything above zero refuses: a learner's recorded
 * progress is the evidence behind a CME point that may already have been
 * reported to an Ärztekammer, and a cascade delete would remove the record of
 * what earned it while leaving the point credited.
 *
 * Deliberately not a soft delete. A course tree with hidden tombstones in it is
 * a tree where ordering, gating and the rollup all have to know about
 * tombstones, and every one of those is a place to get a compliance answer
 * wrong. An author who genuinely needs the item gone after learners have used
 * it needs a conversation, not a button.
 */
export function canDelete(learnerRecords: number): boolean {
  return learnerRecords === 0;
}

function blank(value: string | null | undefined): boolean {
  return value === undefined || value === null || value.trim() === "";
}
