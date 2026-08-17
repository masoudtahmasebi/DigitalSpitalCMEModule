import { describe, expect, it } from "vitest";
import { contentGates } from "./module-quiz.js";
import type { GateResult } from "./gating.js";
import type { ModuleNode } from "./types.js";

/**
 * Every case here was watched to fail against the behaviour this replaces —
 * content inheriting its chapter's gate unconditionally — before the rule was
 * written. The two that could not fail are named as such below, because a test
 * that was green on the broken system is evidence of nothing (CLAUDE.md §9.1).
 */

const open: GateResult = { status: "available", reason: "first_item" };
const shut: GateResult = {
  status: "locked",
  reason: "previous_incomplete",
  blockedBy: "c1",
};
const done: GateResult = { status: "completed", reason: "already_completed" };

/** One module, one chapter, a video and the exam that follows it. */
function moduleWithQuiz(): ModuleNode {
  return {
    id: "m1",
    ordinal: 0,
    chapters: [
      {
        id: "c1",
        ordinal: 0,
        contents: [
          { id: "video", kind: "video" },
          { id: "quiz", kind: "quiz" },
        ],
      },
    ],
  };
}

describe("contentGates", () => {
  it("holds a module's Lernerfolgskontrolle shut until its video is watched", () => {
    const gates = contentGates({
      modules: [moduleWithQuiz()],
      chapterGates: new Map([["c1", open]]),
      completed: new Set(),
    });

    expect(gates.get("quiz")).toEqual({
      status: "locked",
      reason: "module_incomplete",
      blockedBy: "video",
    });
  });

  it("opens it once that video is complete", () => {
    const gates = contentGates({
      modules: [moduleWithQuiz()],
      chapterGates: new Map([["c1", open]]),
      completed: new Set(["video"]),
    });

    expect(gates.get("quiz")).toEqual(open);
  });

  it("leaves every other kind on its chapter's gate", () => {
    const gates = contentGates({
      modules: [moduleWithQuiz()],
      chapterGates: new Map([["c1", open]]),
      completed: new Set(),
    });

    expect(gates.get("video")).toEqual(open);
  });

  it("names the first unwatched video, not the last", () => {
    const module: ModuleNode = {
      id: "m1",
      ordinal: 0,
      chapters: [
        {
          id: "c1",
          ordinal: 0,
          contents: [
            { id: "a", kind: "video" },
            { id: "b", kind: "video" },
            { id: "quiz", kind: "quiz" },
          ],
        },
      ],
    };

    const gates = contentGates({
      modules: [module],
      chapterGates: new Map([["c1", open]]),
      completed: new Set(["b"]),
    });

    expect(gates.get("quiz")).toEqual({
      status: "locked",
      reason: "module_incomplete",
      blockedBy: "a",
    });
  });

  it("counts videos in every chapter of the module, not only the quiz's own", () => {
    const module: ModuleNode = {
      id: "m1",
      ordinal: 0,
      chapters: [
        { id: "c1", ordinal: 0, contents: [{ id: "video", kind: "video" }] },
        { id: "c2", ordinal: 1, contents: [{ id: "quiz", kind: "quiz" }] },
      ],
    };

    const gates = contentGates({
      modules: [module],
      // The exam's own chapter is reachable — the sequence gate is satisfied —
      // and the module is still not watched. Without the module scope this
      // answers `available`, which is the defect.
      chapterGates: new Map([
        ["c1", open],
        ["c2", open],
      ]),
      completed: new Set(),
    });

    expect(gates.get("quiz")).toEqual({
      status: "locked",
      reason: "module_incomplete",
      blockedBy: "video",
    });
  });

  it("orders chapters by ordinal when naming the blocker", () => {
    const module: ModuleNode = {
      id: "m1",
      ordinal: 0,
      chapters: [
        { id: "late", ordinal: 1, contents: [{ id: "second", kind: "video" }] },
        { id: "early", ordinal: 0, contents: [{ id: "first", kind: "video" }] },
        { id: "exam", ordinal: 2, contents: [{ id: "quiz", kind: "quiz" }] },
      ],
    };

    const gates = contentGates({
      modules: [module],
      chapterGates: new Map([
        ["early", open],
        ["late", open],
        ["exam", open],
      ]),
      completed: new Set(),
    });

    expect(gates.get("quiz")?.blockedBy).toBe("first");
  });

  it("never reaches into another module", () => {
    const modules: readonly ModuleNode[] = [
      {
        id: "m1",
        ordinal: 0,
        chapters: [{ id: "c1", ordinal: 0, contents: [{ id: "v1", kind: "video" }] }],
      },
      {
        id: "m2",
        ordinal: 1,
        chapters: [
          {
            id: "c2",
            ordinal: 0,
            contents: [
              { id: "v2", kind: "video" },
              { id: "quiz2", kind: "quiz" },
            ],
          },
        ],
      },
    ];

    const gates = contentGates({
      modules,
      chapterGates: new Map([
        ["c1", done],
        ["c2", open],
      ]),
      // Module 1's video is deliberately *not* complete. Module 2's exam waits
      // for module 2's video and nothing else — the chapter sequence is what
      // enforces the order between modules, and duplicating it here would make
      // two rules that can disagree.
      completed: new Set(["v2"]),
    });

    expect(gates.get("quiz2")).toEqual(open);
  });

  it("keeps a locked chapter's padlock rather than rewording it", () => {
    const gates = contentGates({
      modules: [moduleWithQuiz()],
      chapterGates: new Map([["c1", shut]]),
      completed: new Set(),
    });

    // A learner who cannot reach the module at all is told what a learner who
    // cannot reach the module is told. `module_incomplete` here would send them
    // to a video they also cannot open.
    expect(gates.get("quiz")).toEqual(shut);
  });

  it("does not re-lock an exam that has already been passed", () => {
    const gates = contentGates({
      modules: [moduleWithQuiz()],
      chapterGates: new Map([["c1", open]]),
      // Reachable in practice: the videos were re-authored after the physician
      // sat the exam, so the module has an outstanding video and a passed quiz.
      completed: new Set(["quiz"]),
    });

    expect(gates.get("quiz")).toEqual(done);
  });

  it("opens the exam of a module that has no video to wait for", () => {
    const module: ModuleNode = {
      id: "m1",
      ordinal: 0,
      chapters: [
        {
          id: "c1",
          ordinal: 0,
          contents: [
            { id: "reading", kind: "text" },
            { id: "quiz", kind: "quiz" },
          ],
        },
      ],
    };

    const gates = contentGates({
      modules: [module],
      chapterGates: new Map([["c1", open]]),
      completed: new Set(),
    });

    // Not a shortcut: `text` carries no completion event today (P87-08), so a
    // rule that waited for it would produce an exam nobody can ever open.
    expect(gates.get("quiz")).toEqual(open);
  });

  it("treats a chapter with no gate as reachable, like the caller does", () => {
    const gates = contentGates({
      modules: [moduleWithQuiz()],
      chapterGates: new Map(),
      completed: new Set(["video"]),
    });

    expect(gates.get("quiz")?.status).toBe("available");
  });

  it("answers for every content in the course", () => {
    /*
     * Green before the change as well as after — it pins the *shape*, not the
     * rule, and it is here because the caller replaces its own inherited-gate
     * loop with this map. A content missing from the result would silently
     * become `available` at the call site.
     */
    const modules: readonly ModuleNode[] = [
      {
        id: "m1",
        ordinal: 0,
        chapters: [
          {
            id: "c1",
            ordinal: 0,
            contents: [
              { id: "v1", kind: "video" },
              { id: "t1", kind: "text" },
              { id: "d1", kind: "details" },
              { id: "q1", kind: "quiz" },
            ],
          },
        ],
      },
    ];

    const gates = contentGates({
      modules,
      chapterGates: new Map([["c1", open]]),
      completed: new Set(),
    });

    expect([...gates.keys()].sort()).toEqual(["d1", "q1", "t1", "v1"]);
  });

  it("is empty for a course with no modules", () => {
    // Also green before. An author creates exactly this every time they press
    // "Neue Fortbildung", so the answer must be a map and not a throw.
    expect(
      contentGates({ modules: [], chapterGates: new Map(), completed: new Set() }).size,
    ).toBe(0);
  });
});
