/**
 * Sequential gating (P3-03).
 *
 * Gating is a compliance rule, not a UI affordance. It has to hold against a
 * direct API call, not merely against a disabled button — so this function is
 * consulted on every content-access path, not only when rendering a list.
 *
 * The reason codes are part of the contract: the widget renders the correct
 * German lock copy from them rather than inferring a cause from the status.
 */

export type GateStatus = "locked" | "available" | "completed";

export type GateReason =
  /** Nothing precedes it. */
  | "first_item"
  /** Everything before it is complete. */
  | "previous_completed"
  /** Something before it is not complete. */
  | "previous_incomplete"
  /** Already finished; still reachable for review. */
  | "already_completed"
  /** The identifier is not part of this sequence. */
  | "unknown_item";

export interface GateResult {
  readonly status: GateStatus;
  readonly reason: GateReason;
  /**
   * The first incomplete item blocking this one, when `previous_incomplete`.
   * Lets the widget say which chapter to finish rather than "locked".
   */
  readonly blockedBy?: string;
}

export interface GatingItem {
  readonly id: string;
  readonly ordinal: number;
  readonly completed: boolean;
}

/**
 * Evaluate access to one item in an ordered sequence.
 *
 * Ordinals come from the authoring order (P2-03) and are unique within their
 * parent, which is why reordering content in the admin console is a
 * compliance-adjacent operation rather than a cosmetic one.
 */
export function evaluateGate(items: readonly GatingItem[], targetId: string): GateResult {
  const ordered = [...items].sort((a, b) => a.ordinal - b.ordinal);
  const index = ordered.findIndex((item) => item.id === targetId);

  if (index === -1) {
    return { status: "locked", reason: "unknown_item" };
  }

  // Non-null: `index` came from this array.
  const target = ordered[index]!;

  if (target.completed) {
    return { status: "completed", reason: "already_completed" };
  }

  const blocker = ordered.slice(0, index).find((item) => !item.completed);

  if (blocker !== undefined) {
    return {
      status: "locked",
      reason: "previous_incomplete",
      blockedBy: blocker.id,
    };
  }

  return {
    status: "available",
    reason: index === 0 ? "first_item" : "previous_completed",
  };
}

/**
 * The whole sequence at once, for rendering a sidebar without calling
 * `evaluateGate` per item and paying O(n²).
 */
export function evaluateSequence(
  items: readonly GatingItem[],
): ReadonlyMap<string, GateResult> {
  const ordered = [...items].sort((a, b) => a.ordinal - b.ordinal);
  const results = new Map<string, GateResult>();

  let firstIncomplete: GatingItem | undefined;

  for (const [index, item] of ordered.entries()) {
    if (item.completed) {
      results.set(item.id, { status: "completed", reason: "already_completed" });
      continue;
    }

    if (firstIncomplete === undefined) {
      firstIncomplete = item;
      results.set(item.id, {
        status: "available",
        reason: index === 0 ? "first_item" : "previous_completed",
      });
      continue;
    }

    results.set(item.id, {
      status: "locked",
      reason: "previous_incomplete",
      blockedBy: firstIncomplete.id,
    });
  }

  return results;
}
