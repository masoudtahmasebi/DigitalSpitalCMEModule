import { describe, expect, it } from "vitest";
import {
  canDelete,
  deletionVerdict,
  contentProblems,
  correctOptionCount,
  questionProblems,
  validateReorder,
  type ContentDraft,
  type QuestionDraft,
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

  const mp4 = { url: "https://cdn/x.mp4", mimeType: "video/mp4", label: "720p" };

  it("accepts a well-formed item of each kind", () => {
    expect(contentProblems(draft())).toEqual([]);
    expect(
      contentProblems(draft({ kind: "video", sources: [mp4], durationSec: 600 })),
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
        contentProblems(draft({ kind: "video", sources: [mp4], durationSec })),
      ).toContain("durationSec");
    }
  });

  it("refuses a video with no playable source", () => {
    // Unplayable content whose watch gate would nonetheless record the learner
    // as having watched none of it — a CME failure caused by an authoring
    // mistake rather than by anything the physician did.
    expect(contentProblems(draft({ kind: "video", durationSec: 600 }))).toEqual([
      "sources",
    ]);
    expect(
      contentProblems(draft({ kind: "video", sources: [], durationSec: 600 })),
    ).toEqual(["sources"]);
    expect(
      contentProblems(
        draft({
          kind: "video",
          sources: [{ url: "  ", mimeType: "video/mp4" }],
          durationSec: 600,
        }),
      ),
    ).toContain("sources");
  });

  it("refuses a source type no browser would match, as its own field", () => {
    // A browser skips an unrecognised `type` in silence, so this presents as a
    // video that will not play with nothing in the console. Separate from
    // `sources` because the fix is a different input.
    expect(
      contentProblems(
        draft({
          kind: "video",
          sources: [{ url: "https://cdn/x.mp4", mimeType: "mp4" }],
          durationSec: 600,
        }),
      ),
    ).toEqual(["sourceMimeType"]);
  });

  it("refuses the same rendition listed twice", () => {
    expect(
      contentProblems(
        draft({
          kind: "video",
          sources: [mp4, { ...mp4, label: "1080p" }],
          durationSec: 600,
        }),
      ),
    ).toContain("sources");
  });

  it("asks nothing about sources for a kind that has no media", () => {
    expect(contentProblems(draft({ kind: "text", body: "Inhalt" }))).toEqual([]);
    expect(
      contentProblems(draft({ kind: "material", fileUrl: "https://cdn/x.pdf" })),
    ).toEqual([]);
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
      "sources",
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

describe("deletionVerdict", () => {
  it("allows an empty level nobody has touched", () => {
    expect(deletionVerdict({ learnerRecords: 0, children: {} })).toEqual({ ok: true });
  });

  it("refuses a non-empty level and names what is inside it", () => {
    const verdict = deletionVerdict({
      learnerRecords: 0,
      children: { project: 2, course: 5 },
    });

    expect(verdict).toEqual({
      ok: false,
      reason: "has_children",
      children: [
        { level: "project", count: 2 },
        { level: "course", count: 5 },
      ],
    });
  });

  it("reports children outermost first, whatever order they were counted in", () => {
    // The refusal should read down the hierarchy the way the console draws it.
    const verdict = deletionVerdict({
      learnerRecords: 0,
      children: { content: 9, module: 1, chapter: 3 },
    });

    expect(verdict.ok).toBe(false);
    if (verdict.ok || verdict.reason !== "has_children")
      throw new Error("expected children");
    expect(verdict.children.map((c) => c.level)).toEqual([
      "module",
      "chapter",
      "content",
    ]);
  });

  it("does not report a level that has no children", () => {
    // "0 Kapitel" in a message whose job is to say what is in the way is noise.
    const verdict = deletionVerdict({
      learnerRecords: 0,
      children: { chapter: 0, content: 2 },
    });

    if (verdict.ok || verdict.reason !== "has_children")
      throw new Error("expected children");
    expect(verdict.children).toEqual([{ level: "content", count: 2 }]);
  });

  it("reports learner records ahead of children, because only one is permanent", () => {
    // Emptying the level would not make it deletable, so sending somebody to do
    // that wastes the trip — and walks them into deleting the evidence itself.
    const verdict = deletionVerdict({
      learnerRecords: 3,
      children: { course: 1 },
    });

    expect(verdict).toEqual({
      ok: false,
      reason: "learner_records",
      learnerRecords: 3,
    });
  });

  it("refuses on learner records even when the level is empty", () => {
    // A course whose content was already removed still holds the enrolments.
    expect(deletionVerdict({ learnerRecords: 1, children: {} })).toEqual({
      ok: false,
      reason: "learner_records",
      learnerRecords: 1,
    });
  });
});

describe("questionProblems", () => {
  const question = (over: Partial<QuestionDraft> = {}): QuestionDraft => ({
    kind: "single",
    prompt: "Welche Dosierung ist indiziert?",
    options: [
      { label: "10 mg", isCorrect: true },
      { label: "20 mg", isCorrect: false },
    ],
    ...over,
  });

  it("accepts a well-formed single-choice question", () => {
    expect(questionProblems(question())).toEqual([]);
  });

  it("accepts a multi-choice question with several correct options", () => {
    expect(
      questionProblems(
        question({
          kind: "multi",
          options: [
            { label: "a", isCorrect: true },
            { label: "b", isCorrect: true },
            { label: "c", isCorrect: false },
          ],
        }),
      ),
    ).toEqual([]);
  });

  it("refuses a question nobody can answer correctly", () => {
    // Not a tidiness rule. Every future attempt at this quiz is capped below
    // the accredited 70 % by an authoring slip nobody would notice until a
    // physician failed a course they knew the material for.
    expect(
      questionProblems(
        question({
          options: [
            { label: "a", isCorrect: false },
            { label: "b", isCorrect: false },
          ],
        }),
      ),
    ).toContain("no_correct_option");
  });

  it("refuses a single-choice question with two correct options", () => {
    // Scoring is exact-set: the submitted set must equal the correct set, and
    // a learner who can pick one option can never submit a set of two.
    expect(
      questionProblems(
        question({
          kind: "single",
          options: [
            { label: "a", isCorrect: true },
            { label: "b", isCorrect: true },
          ],
        }),
      ),
    ).toContain("too_many_correct_options");
  });

  it("does not apply the single-choice rule to a multi question", () => {
    expect(
      questionProblems(
        question({
          kind: "multi",
          options: [
            { label: "a", isCorrect: true },
            { label: "b", isCorrect: true },
          ],
        }),
      ),
    ).not.toContain("too_many_correct_options");
  });

  it("requires a prompt, two options, and no empty option", () => {
    expect(questionProblems(question({ prompt: "  " }))).toContain("empty_prompt");
    expect(
      questionProblems(question({ options: [{ label: "a", isCorrect: true }] })),
    ).toContain("too_few_options");
    expect(
      questionProblems(
        question({
          options: [
            { label: "a", isCorrect: true },
            { label: "   ", isCorrect: false },
          ],
        }),
      ),
    ).toContain("empty_option");
  });

  it("reports every problem a question has, not only the first", () => {
    const problems = questionProblems({ kind: "single", prompt: "", options: [] });
    expect(problems).toContain("empty_prompt");
    expect(problems).toContain("too_few_options");
    expect(problems).toContain("no_correct_option");
  });
});

describe("correctOptionCount", () => {
  it("counts the options marked correct", () => {
    expect(
      correctOptionCount({
        kind: "multi",
        prompt: "p",
        options: [
          { label: "a", isCorrect: true },
          { label: "b", isCorrect: false },
          { label: "c", isCorrect: true },
        ],
      }),
    ).toBe(2);
  });
});
