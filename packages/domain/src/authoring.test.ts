import { describe, expect, it } from "vitest";
import {
  canDelete,
  contentProblems,
  validateReorder,
  type ContentDraft,
} from "./authoring.js";

describe("validateReorder is a permutation check, not a filter", () => {
  it("accepts a rearrangement and returns the new order", () => {
    const result = validateReorder(["a", "b", "c"], ["c", "a", "b"]);

    expect(result).toEqual({ ok: true, ordered: ["c", "a", "b"] });
  });

  it("accepts an unchanged order", () => {
    expect(validateReorder(["a", "b"], ["a", "b"])).toEqual({
      ok: true,
      ordered: ["a", "b"],
    });
  });

  it("refuses a list that lost an item", () => {
    // The bug this exists for: a drag-and-drop UI drops a row during a
    // re-render and sends a shorter list. Obeying it would delete a chapter
    // from a course learners are half-way through.
    const result = validateReorder(["a", "b", "c"], ["a", "c"]);

    expect(result).toEqual({
      ok: false,
      rejection: { reason: "missing", ids: ["b"] },
    });
  });

  it("refuses a list naming something that is not there", () => {
    // A stale client acting on a tree that has since changed. Distinguished
    // from `missing` because the fix is different: reload, not resend.
    const result = validateReorder(["a", "b"], ["a", "b", "ghost"]);

    expect(result).toEqual({
      ok: false,
      rejection: { reason: "unknown", ids: ["ghost"] },
    });
  });

  it("refuses a repeated id", () => {
    const result = validateReorder(["a", "b"], ["a", "a"]);

    expect(result).toEqual({
      ok: false,
      rejection: { reason: "duplicated", ids: ["a"] },
    });
  });

  it("reports duplication before anything else", () => {
    // A duplicate makes the other two checks lie: `["a","a"]` against
    // `["a","b"]` looks like "b is missing" as well, and telling an author
    // both is telling them neither.
    const result = validateReorder(["a", "b"], ["a", "a"]);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection.reason).toBe("duplicated");
  });

  it("handles the empty tree", () => {
    expect(validateReorder([], [])).toEqual({ ok: true, ordered: [] });
  });
});

describe("contentProblems", () => {
  function draft(over: Partial<ContentDraft> = {}): ContentDraft {
    return { kind: "text", title: "Grundlagen", body: "Inhalt", ...over };
  }

  it("accepts a well-formed item of each kind", () => {
    expect(contentProblems(draft())).toEqual([]);
    expect(
      contentProblems(
        draft({ kind: "video", videoUrl: "https://cdn/x.mp4", durationSec: 600 }),
      ),
    ).toEqual([]);
    expect(
      contentProblems(draft({ kind: "material", fileUrl: "https://cdn/x.pdf" })),
    ).toEqual([]);
    expect(contentProblems(draft({ kind: "quiz" }))).toEqual([]);
  });

  it("refuses a video with no duration", () => {
    // The one that matters. The watch gate is a percentage of a known length;
    // with no length there is no percentage to reach, and the content would be
    // skippable while appearing to count toward a CME point.
    for (const durationSec of [undefined, null, 0, -1, 12.5]) {
      expect(
        contentProblems(
          draft({ kind: "video", videoUrl: "https://cdn/x.mp4", durationSec }),
        ),
      ).toContain("durationSec");
    }
  });

  it("refuses a video with no URL", () => {
    expect(
      contentProblems(draft({ kind: "video", videoUrl: "  ", durationSec: 600 })),
    ).toEqual(["videoUrl"]);
  });

  it("does not demand a duration of anything else", () => {
    // A text chapter has no length to watch. Requiring one everywhere would
    // teach authors to type a number that means nothing.
    expect(contentProblems(draft({ kind: "text", durationSec: null }))).toEqual([]);
    expect(
      contentProblems(draft({ kind: "material", fileUrl: "https://cdn/x.pdf" })),
    ).toEqual([]);
  });

  it("names every problem at once, by field", () => {
    // A form marks inputs; returning only the first would make an author fix
    // one thing per round trip.
    expect(contentProblems(draft({ kind: "video", title: "  " }))).toEqual([
      "title",
      "videoUrl",
      "durationSec",
    ]);
  });

  it("treats whitespace as absent", () => {
    expect(contentProblems(draft({ title: "   " }))).toContain("title");
    expect(contentProblems(draft({ kind: "text", body: "\n  " }))).toContain("body");
  });
});

describe("canDelete", () => {
  it("allows removing something no learner has touched", () => {
    expect(canDelete(0)).toBe(true);
  });

  it("refuses once there is a single recorded row", () => {
    // A learner's progress is the evidence behind a CME point that may already
    // have been reported. Cascading it away would leave the point credited and
    // the record of what earned it gone.
    expect(canDelete(1)).toBe(false);
    expect(canDelete(4000)).toBe(false);
  });
});
