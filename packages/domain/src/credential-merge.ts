/**
 * Merging two credentials onto one person (P21-05).
 *
 * ## Why this exists at all
 *
 * ADR-0013 splits person, credential and membership, and P21-01 made linking a
 * second credential to an existing person **impossible on every authentication
 * path**: `provision_learner` resolves a credential or creates a person, and has
 * no branch that attaches a credential to somebody who already exists. That is
 * the right default — a guard that merges records on its own would eventually
 * merge two physicians who share a name.
 *
 * So it is a deliberate act by an operator, and this is the rule that decides
 * whether the act is safe to perform.
 *
 * ## Why the rule is here and not in the service
 *
 * A merge moves a physician's participation records — the things a CME point is
 * awarded against — from one person to another, and it cannot be undone in any
 * way a physician would accept. It is a compliance decision, so it lives in the
 * pure core and is tested exhaustively (CLAUDE.md §4 invariant 4).
 *
 * ## What it refuses, and why each refusal is a question rather than a rule
 *
 * The three refusals below are all the same shape: the merge would have to
 * *choose* something, and there is no correct choice this platform can make on
 * a physician's behalf.
 *
 * - **Two different EFNs.** Both sides are already reporting points to an
 *   Ärztekammer under different numbers. Picking one silently re-attributes the
 *   other's points; picking neither loses a report. Named in P21-05's own
 *   acceptance criteria.
 * - **Both enrolled on the same course.** Two watch histories, two quiz-attempt
 *   sets and possibly two completions on one course. Whichever survives, a
 *   physician loses progress they earned — and if both completed, one
 *   Punktemeldung has already gone out under each identity.
 * - **A person merged into themselves.** Not dangerous, but it is never what
 *   the operator meant, and an operation that silently does nothing is one
 *   somebody repeats while looking for the effect.
 *
 * A refusal names what is in the way, because "cannot merge" tells an operator
 * nothing they can act on.
 */

export interface MergeSide {
  readonly personId: string;
  /**
   * Whether this person has an EFN on file — **not** the EFN itself.
   *
   * No endpoint returns an EFN (ADR-0004) and nothing here needs one: the
   * question is whether two *different* numbers exist, and that is answered by
   * a hash comparison the caller does. Passing the digits through the domain to
   * compare them would put a physician's EFN somewhere it has no reason to be.
   */
  readonly efnFingerprint: string | null;
  /** Course slugs this person is enrolled on, in any state. */
  readonly enrolledCourseSlugs: readonly string[];
}

export type MergeRefusal =
  | { readonly reason: "same_person" }
  | { readonly reason: "conflicting_efn" }
  | { readonly reason: "overlapping_courses"; readonly courseSlugs: readonly string[] };

export type MergePlan =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly refusal: MergeRefusal };

/**
 * Decide whether `source` may be merged into `target`.
 *
 * Direction matters for what survives — the target's person id is the one that
 * remains — but not for this verdict: every refusal below is symmetric, which
 * is deliberate. An operator who reverses the arguments to get past a refusal
 * has not resolved anything.
 */
export function planCredentialMerge(source: MergeSide, target: MergeSide): MergePlan {
  if (source.personId === target.personId) {
    return { allowed: false, refusal: { reason: "same_person" } };
  }

  if (
    source.efnFingerprint !== null &&
    target.efnFingerprint !== null &&
    source.efnFingerprint !== target.efnFingerprint
  ) {
    return { allowed: false, refusal: { reason: "conflicting_efn" } };
  }

  const targetCourses = new Set(target.enrolledCourseSlugs);
  const overlapping = [...new Set(source.enrolledCourseSlugs)]
    .filter((slug) => targetCourses.has(slug))
    .sort();

  if (overlapping.length > 0) {
    return {
      allowed: false,
      refusal: { reason: "overlapping_courses", courseSlugs: overlapping },
    };
  }

  return { allowed: true };
}
