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

import type { QuestionKind } from "./assessment.js";
import { mediaSourceProblems, type MediaSourceDraft } from "./media.js";

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
  /**
   * Playable renditions, in the author's order.
   *
   * A list rather than a URL because a browser picks the first `<source>` type
   * it can play — see `media.ts`. A video needs at least one; every other kind
   * ignores this.
   */
  readonly sources?: readonly MediaSourceDraft[];
  readonly posterUrl?: string | null;
  /**
   * WebVTT captions.
   *
   * Carried but **not required**: WCAG 1.2.2 is Level A and every video with
   * speech owes captions, but a slide-only recording with no speech legitimately
   * has none, and this function cannot tell the two apart. Refusing every
   * uncaptioned video would block valid content; the console asks for it and
   * says why instead.
   */
  readonly captionsUrl?: string | null;
  readonly durationSec?: number | null;
  readonly fileUrl?: string | null;
  readonly mimeType?: string | null;
}

/** Field names, so a form can mark the right input rather than shout globally. */
export type ContentProblem =
  "title" | "sources" | "sourceMimeType" | "durationSec" | "fileUrl" | "body";

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
    case "video": {
      // A video with no source is unplayable, and the watch gate would then
      // record the learner as having watched none of it — a CME failure caused
      // by an authoring mistake rather than by anything they did.
      const sourceProblems = mediaSourceProblems(draft.sources ?? []);
      if (sourceProblems.includes("empty") || sourceProblems.includes("blank_url")) {
        problems.push("sources");
      }
      // A `type` no browser recognises makes the source silently skipped, so
      // the video refuses to play with nothing in the console to explain it.
      // Its own problem code, because the fix is a different field.
      if (sourceProblems.includes("unknown_mime_type")) problems.push("sourceMimeType");
      if (sourceProblems.includes("duplicate_url")) problems.push("sources");

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
    }

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
// Quiz questions
// ---------------------------------------------------------------------------

/**
 * `QuestionKind` comes from `assessment.ts` rather than being declared again:
 * the kind an author picks and the kind the scorer branches on are the same
 * thing. Two identical unions would compile happily and then drift the day a
 * third kind is added to one of them.
 */
export interface QuestionDraft {
  readonly kind: QuestionKind;
  readonly prompt: string;
  readonly options: ReadonlyArray<{
    readonly label: string;
    readonly isCorrect: boolean;
  }>;
}

/**
 * Why a question cannot be used.
 *
 * `no_correct_option` and `too_many_correct_options` are the two that make a
 * quiz *unpassable* rather than merely untidy, which is why they are named
 * separately from the rest.
 */
export type QuestionProblem =
  | "empty_prompt"
  | "too_few_options"
  | "empty_option"
  | "no_correct_option"
  | "too_many_correct_options";

/** Fewer than this and there is nothing to choose between. */
export const MIN_QUIZ_OPTIONS = 2;

/**
 * What is wrong with one quiz question, if anything.
 *
 * Lives here — not in the API service and not in the console — because both
 * need it and a second copy would eventually disagree with the first. The
 * server refuses on it and the console marks the offending question with it, so
 * an author sees *which* of eleven questions is wrong before submitting rather
 * than one sentence about the document afterwards.
 *
 * The two rules that matter are not stylistic:
 *
 * - **No correct option** means the question cannot be answered correctly by
 *   anybody, including a physician who knows the material. Every future attempt
 *   is capped below the accredited 70 % by an authoring slip.
 * - **A `single` question with two correct options** is the same defect wearing
 *   a different hat. Scoring is exact-set (`assessment.ts`): the submitted set
 *   must equal the correct set, and a learner picking one option can never
 *   submit a set of two.
 *
 * Returned in a fixed order so a caller rendering them gets a stable list, and
 * so a test can compare arrays rather than sets.
 */
export function questionProblems(draft: QuestionDraft): readonly QuestionProblem[] {
  const problems: QuestionProblem[] = [];
  const correct = draft.options.filter((option) => option.isCorrect).length;

  if (draft.prompt.trim() === "") problems.push("empty_prompt");
  if (draft.options.length < MIN_QUIZ_OPTIONS) problems.push("too_few_options");
  if (draft.options.some((option) => option.label.trim() === "")) {
    problems.push("empty_option");
  }
  if (correct === 0) problems.push("no_correct_option");
  if (draft.kind === "single" && correct > 1) problems.push("too_many_correct_options");

  return problems;
}

/** How many options a question marks correct. Reported in refusals. */
export function correctOptionCount(draft: QuestionDraft): number {
  return draft.options.filter((option) => option.isCorrect).length;
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

/** A level of `Customer → Department → Project → Course → Modul → Kapitel → Inhalt`. */
export type HierarchyLevel =
  "customer" | "department" | "project" | "course" | "module" | "chapter" | "content";

/** How many of each level sit beneath the thing somebody wants to delete. */
export type ChildCensus = Partial<Readonly<Record<HierarchyLevel, number>>>;

export type DeletionVerdict =
  | { readonly ok: true }
  /** Evidence behind a CME point points at this. Never deletable. */
  | {
      readonly ok: false;
      readonly reason: "learner_records";
      readonly learnerRecords: number;
    }
  /** Structurally non-empty. Deletable once emptied, so the counts are named. */
  | {
      readonly ok: false;
      readonly reason: "has_children";
      readonly children: readonly {
        readonly level: HierarchyLevel;
        readonly count: number;
      }[];
    };

/**
 * Whether a level of the hierarchy may be deleted, and if not, precisely why.
 *
 * `canDelete` above answers this for a leaf, where the only question is whether
 * learners have touched it. Every level above a leaf has a second question: is
 * anything still inside it?
 *
 * ## Why a non-empty parent is refused rather than cascaded
 *
 * A cascade from a customer would remove that customer's departments, projects,
 * courses, every learner's progress and every certificate, from one click,
 * transactionally, with no way back. The database already refuses it —
 * `ON DELETE RESTRICT` on every `customer_id` foreign key — so a cascade here
 * would additionally mean fighting the schema to do the more dangerous thing.
 *
 * The refusal names the counts because "cannot delete" without them sends
 * somebody hunting through seven levels for the one course they forgot. The
 * counts are what turn a refusal into an instruction.
 *
 * ## Why learner records outrank children
 *
 * They are different kinds of "no". A non-empty parent becomes deletable once
 * emptied; a parent holding learner evidence does not, and telling somebody to
 * go and empty it would send them to delete the evidence one level down —
 * where they would be refused again, having wasted the trip. The permanent
 * reason is the more useful one, so it is reported first.
 */
export function deletionVerdict(input: {
  readonly learnerRecords: number;
  readonly children: ChildCensus;
}): DeletionVerdict {
  if (!canDelete(input.learnerRecords)) {
    return {
      ok: false,
      reason: "learner_records",
      learnerRecords: input.learnerRecords,
    };
  }

  const children = HIERARCHY_ORDER.flatMap((level) => {
    const count = input.children[level] ?? 0;
    // A zero is an absent child, not a reportable one. Reporting it would put
    // "0 Kapitel" in a message whose whole job is to say what is in the way.
    return count > 0 ? [{ level, count }] : [];
  });

  return children.length === 0
    ? { ok: true }
    : { ok: false, reason: "has_children", children };
}

/**
 * Outermost first, so a refusal reads down the hierarchy the way the console
 * draws it rather than in whatever order the counts were gathered.
 */
const HIERARCHY_ORDER: readonly HierarchyLevel[] = [
  "customer",
  "department",
  "project",
  "course",
  "module",
  "chapter",
  "content",
];

function blank(value: string | null | undefined): boolean {
  return value === undefined || value === null || value.trim() === "";
}
