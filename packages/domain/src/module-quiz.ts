/**
 * A module's Lernerfolgskontrolle opens when that module's videos are watched
 * (P87-04).
 *
 * ## What was wrong, and why nothing showed it
 *
 * Gating is evaluated at **chapter** granularity, and a content item inherits
 * its chapter's gate — stated in `buildModuleStates` as *"a content item is
 * exactly as reachable as the chapter containing it"*. That is right for two
 * videos in one chapter and wrong for the one shape every author actually
 * builds: a chapter holding a video **and** the quiz that examines it. Both
 * inherit the same gate, so the exam was open at nought per cent watched, from
 * the moment the physician enrolled.
 *
 * It was invisible from every direction at once. The API was consistent with
 * itself; the widget rendered the gate it was given; and the browser journey
 * did not assert on the control it saw, because the assertion it does make sits
 * three acts later. It surfaced only when the journey started asking *which* of
 * the two buttons was under the player, and then it was immediate.
 *
 * ## The rule, in the client's words
 *
 * > *"each module part, can have quiz or not … when all of the module parts are
 * > done, videos watched and lernerfolg done, the efn screen comes"*
 *
 * So: within a module, the videos come first and the Lernerfolgskontrolle is
 * the last thing. Passing it is what completes the module — and because the
 * chapter sequence already requires every content in a chapter to be complete
 * before the next chapter opens, that half needs no new code. This is the other
 * half: the quiz does not open **early**.
 *
 * ## Why only videos count as the precondition
 *
 * `text` and `details` are in the compliance tree and have no completion event
 * — `POST contents/:id/progress` accepts `video` alone. A rule that waited for
 * them would produce a Lernerfolgskontrolle that never unlocks, which is the
 * defect this file exists to remove, one kind over. That is a real gap and it
 * is fixed separately (P87-08); this function is written so that fixing it does
 * not change what this decides, because a completed text lesson is simply not
 * something this rule asks about.
 *
 * A module with no video at all — an all-text module with an exam — therefore
 * has nothing to wait for and its quiz is as reachable as its chapter. That is
 * the right answer rather than a shortcut: refusing to open an exam whose
 * precondition is the empty set would lock it forever.
 *
 * ## Pure, and told everything it needs
 *
 * No clock, no I/O, no course lookup. The chapter gates come from
 * `evaluateSequence` and the completed set from the rollup, both computed by
 * the caller — so this decides one question and cannot disagree with the
 * sequence gate about the other.
 */

import type { GateResult } from "./gating.js";
import type { ModuleNode } from "./types.js";

/**
 * Every content's gate, with each module's quiz held back until its videos are
 * done.
 *
 * Keyed by content id. A content whose chapter has no gate is treated as
 * `available` — the same fallback `buildModuleStates` already applies, kept
 * here so the two cannot drift.
 */
export function contentGates(input: {
  readonly modules: readonly ModuleNode[];
  /** From `evaluateSequence(courseChapterSequence(…))`, keyed by chapter id. */
  readonly chapterGates: ReadonlyMap<string, GateResult>;
  /** Content ids whose progress status is `completed`. */
  readonly completed: ReadonlySet<string>;
}): ReadonlyMap<string, GateResult> {
  const gates = new Map<string, GateResult>();

  for (const module of input.modules) {
    /*
     * The first video in this module that is not finished, in authoring order.
     *
     * Named rather than counted, because it becomes `blockedBy` — a learner who
     * finds the exam locked can be told which section is still open, which is
     * the whole reason `GateResult` carries the field.
     */
    const outstanding = orderedContents(module).find(
      (content) => content.kind === "video" && !input.completed.has(content.id),
    );

    for (const chapter of module.chapters) {
      const inherited: GateResult = input.chapterGates.get(chapter.id) ?? {
        status: "available",
        reason: "first_item",
      };

      for (const content of chapter.contents) {
        if (content.kind !== "quiz") {
          gates.set(content.id, inherited);
          continue;
        }

        /*
         * A quiz already passed stays open, whatever else is true.
         *
         * Re-locking an exam somebody has sat would withdraw a result they can
         * see on their own progress list — and it is reachable: a module whose
         * videos were re-authored after the quiz was passed has an outstanding
         * video and a completed exam at the same time.
         */
        if (input.completed.has(content.id)) {
          gates.set(content.id, { status: "completed", reason: "already_completed" });
          continue;
        }

        // The chapter gate is still the stronger word: a module the learner has
        // not reached at all does not get a differently-worded padlock on its
        // exam.
        if (inherited.status !== "available" || outstanding === undefined) {
          gates.set(content.id, inherited);
          continue;
        }

        gates.set(content.id, {
          status: "locked",
          reason: "module_incomplete",
          blockedBy: outstanding.id,
        });
      }
    }
  }

  return gates;
}

/** A module's contents in authoring order: chapters by ordinal, then as given. */
function orderedContents(module: ModuleNode) {
  return [...module.chapters]
    .sort((a, b) => a.ordinal - b.ordinal)
    .flatMap((chapter) => chapter.contents);
}
