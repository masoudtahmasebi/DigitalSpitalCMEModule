import { describe, expect, it } from "vitest";
import { evaluateGate, evaluateSequence, type GatingItem } from "./gating.js";

const sequence: GatingItem[] = [
  { id: "k1", ordinal: 0, completed: true },
  { id: "k2", ordinal: 1, completed: true },
  { id: "k3", ordinal: 2, completed: false },
  { id: "k4", ordinal: 3, completed: false },
];

describe("evaluateGate", () => {
  it("marks a completed item as completed and still reachable for review", () => {
    expect(evaluateGate(sequence, "k1")).toEqual({
      status: "completed",
      reason: "already_completed",
    });
  });

  it("unlocks exactly the next item, not the rest of the course", () => {
    expect(evaluateGate(sequence, "k3")).toEqual({
      status: "available",
      reason: "previous_completed",
    });

    // The design shows Kapitel 4 locked while Kapitel 3 is in progress.
    expect(evaluateGate(sequence, "k4")).toEqual({
      status: "locked",
      reason: "previous_incomplete",
      blockedBy: "k3",
    });
  });

  it("names the blocking item so the widget can say which chapter to finish", () => {
    const result = evaluateGate(sequence, "k4");
    expect(result.blockedBy).toBe("k3");
  });

  it("reports the first item distinctly", () => {
    expect(evaluateGate([{ id: "k1", ordinal: 0, completed: false }], "k1")).toEqual({
      status: "available",
      reason: "first_item",
    });
  });

  it("locks an unknown identifier rather than defaulting to available", () => {
    // Fail closed: a direct API call for an id outside the sequence must not
    // fall through to access.
    expect(evaluateGate(sequence, "not-in-course")).toEqual({
      status: "locked",
      reason: "unknown_item",
    });
  });

  it("orders by ordinal, not by array position", () => {
    const shuffled: GatingItem[] = [
      { id: "k3", ordinal: 2, completed: false },
      { id: "k1", ordinal: 0, completed: true },
      { id: "k2", ordinal: 1, completed: false },
    ];

    expect(evaluateGate(shuffled, "k3")).toEqual({
      status: "locked",
      reason: "previous_incomplete",
      blockedBy: "k2",
    });
  });

  it("blames the earliest incomplete item when several are outstanding", () => {
    const gapped: GatingItem[] = [
      { id: "a", ordinal: 0, completed: false },
      { id: "b", ordinal: 1, completed: false },
      { id: "c", ordinal: 2, completed: false },
    ];

    expect(evaluateGate(gapped, "c").blockedBy).toBe("a");
  });

  it("handles an empty sequence", () => {
    expect(evaluateGate([], "k1").status).toBe("locked");
  });

  it("does not mutate its input", () => {
    const input: GatingItem[] = [
      { id: "b", ordinal: 1, completed: false },
      { id: "a", ordinal: 0, completed: true },
    ];
    const before = [...input];

    evaluateGate(input, "b");

    expect(input).toEqual(before);
  });
});

describe("evaluateSequence", () => {
  it("agrees with evaluateGate for every item", () => {
    const bulk = evaluateSequence(sequence);

    for (const item of sequence) {
      expect(bulk.get(item.id)).toEqual(evaluateGate(sequence, item.id));
    }
  });

  it("leaves a completed item after an incomplete one marked completed", () => {
    // Content authored later can be completed out of order in seeded data.
    // Reporting it as locked would contradict the learner's own record.
    const outOfOrder: GatingItem[] = [
      { id: "a", ordinal: 0, completed: false },
      { id: "b", ordinal: 1, completed: true },
    ];

    expect(evaluateSequence(outOfOrder).get("b")?.status).toBe("completed");
  });

  it("marks only the first incomplete item as available", () => {
    const results = evaluateSequence(sequence);
    const available = [...results.entries()].filter(
      ([, result]) => result.status === "available",
    );

    expect(available).toHaveLength(1);
    expect(available[0]?.[0]).toBe("k3");
  });
});
