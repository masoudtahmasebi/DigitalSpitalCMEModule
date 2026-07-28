/**
 * The reorder arithmetic (P9-04).
 *
 * Worth testing rather than eyeballing because every function here produces the
 * body of a request that rearranges a course learners are part-way through, and
 * the failure mode is silent: an off-by-one in `swap` moves the wrong chapter,
 * and a `moveChapter` that forgot to remove the source leaves a duplicate id
 * the server rejects as `duplicated` — a message nobody would connect to a
 * dropdown.
 */

import { describe, expect, it } from "vitest";
import type { AuthoringChapter, AuthoringContent, AuthoringModule } from "@ds/sdk";
import {
  moveChapter,
  recordsUnderModule,
  toOrder,
  withChapters,
  withContents,
} from "./structure-order.js";
import { swap } from "./drafts.js";

function content(id: string, learnerRecords = 0): AuthoringContent {
  return {
    id,
    kind: "text",
    title: id,
    body: null,
    videoUrl: null,
    durationSec: null,
    fileUrl: null,
    fileSize: null,
    mimeType: null,
    learnerRecords,
    questionCount: null,
  };
}

function chapter(id: string, contents: AuthoringContent[] = []): AuthoringChapter {
  return { id, title: id, body: null, contents };
}

function module_(id: string, chapters: AuthoringChapter[] = []): AuthoringModule {
  return { id, title: id, subtitle: null, chapters };
}

const tree: AuthoringModule[] = [
  module_("m1", [
    chapter("c1", [content("x1"), content("x2")]),
    chapter("c2", [content("x3")]),
  ]),
  module_("m2", [chapter("c3", [content("x4", 3)])]),
];

describe("toOrder", () => {
  it("carries every id, at every level, in tree order", () => {
    expect(toOrder(tree)).toEqual({
      modules: [
        {
          id: "m1",
          chapters: [
            { id: "c1", contents: ["x1", "x2"] },
            { id: "c2", contents: ["x3"] },
          ],
        },
        { id: "m2", chapters: [{ id: "c3", contents: ["x4"] }] },
      ],
    });
  });

  it("sends no ordinal anywhere", () => {
    // Position in the array *is* the ordinal. A client able to set ordinals
    // directly could set two siblings to the same one, and the UNIQUE
    // constraint would turn an authoring mistake into a 500.
    const serialised = JSON.stringify(toOrder(tree));
    expect(serialised).not.toContain("ordinal");
  });
});

describe("swap", () => {
  it("exchanges two positions and leaves the rest alone", () => {
    expect(swap(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
    expect(swap(["a", "b", "c"], 2, 1)).toEqual(["a", "c", "b"]);
  });

  it("returns an unchanged copy when an index is out of range", () => {
    const input = ["a", "b"];
    expect(swap(input, 0, 5)).toEqual(["a", "b"]);
    expect(swap(input, -1, 0)).toEqual(["a", "b"]);
  });

  it("does not mutate its input", () => {
    const input = ["a", "b"];
    swap(input, 0, 1);
    expect(input).toEqual(["a", "b"]);
  });
});

describe("withChapters", () => {
  it("replaces one module's chapters and leaves siblings untouched", () => {
    const next = withChapters(tree, "m1", [chapter("c2"), chapter("c1")]);
    expect(next[0]?.chapters.map((c) => c.id)).toEqual(["c2", "c1"]);
    expect(next[1]).toEqual(tree[1]);
  });

  it("is a no-op for an unknown module id", () => {
    expect(withChapters(tree, "nope", [])).toEqual(tree);
  });
});

describe("withContents", () => {
  it("finds the chapter without being told its module", () => {
    const next = withContents(tree, "c1", [content("x2"), content("x1")]);
    expect(next[0]?.chapters[0]?.contents.map((c) => c.id)).toEqual(["x2", "x1"]);
    expect(next[0]?.chapters[1]?.contents.map((c) => c.id)).toEqual(["x3"]);
  });
});

describe("moveChapter", () => {
  it("appends the chapter to the target module and removes it from the source", () => {
    const next = moveChapter(tree, "c1", "m2");
    expect(next[0]?.chapters.map((c) => c.id)).toEqual(["c2"]);
    expect(next[1]?.chapters.map((c) => c.id)).toEqual(["c3", "c1"]);
  });

  it("keeps the chapter's contents with it", () => {
    const next = moveChapter(tree, "c1", "m2");
    const moved = next[1]?.chapters.find((c) => c.id === "c1");
    expect(moved?.contents.map((c) => c.id)).toEqual(["x1", "x2"]);
  });

  it("never leaves the id in two places", () => {
    // A duplicate would come back from the server as a `duplicated` rejection,
    // which is a message nobody would connect to having used a dropdown.
    const next = moveChapter(tree, "c1", "m2");
    const ids = next.flatMap((m) => m.chapters.map((c) => c.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("still produces a permutation of the original ids", () => {
    const before = toOrder(tree).modules.flatMap((m) => m.chapters.map((c) => c.id));
    const after = toOrder(moveChapter(tree, "c2", "m2")).modules.flatMap((m) =>
      m.chapters.map((c) => c.id),
    );
    expect([...after].sort()).toEqual([...before].sort());
  });

  it("is a no-op when the chapter is already in the target module", () => {
    const next = moveChapter(tree, "c3", "m2");
    expect(next[1]?.chapters.map((c) => c.id)).toEqual(["c3"]);
    expect(next[0]).toEqual(tree[0]);
  });

  it("is a no-op for an unknown chapter", () => {
    expect(moveChapter(tree, "nope", "m2")).toEqual(tree);
  });
});

describe("recordsUnderModule", () => {
  it("sums learner records across every chapter and content", () => {
    expect(recordsUnderModule(tree[0] as AuthoringModule)).toBe(0);
    expect(recordsUnderModule(tree[1] as AuthoringModule)).toBe(3);
  });

  it("reports zero for a module with nothing in it", () => {
    expect(recordsUnderModule(module_("empty"))).toBe(0);
  });
});
