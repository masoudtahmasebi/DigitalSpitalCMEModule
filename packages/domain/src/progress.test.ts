import { describe, expect, it } from "vitest";
import { courseChapterSequence, rollupProgress } from "./progress.js";
import type { ContentProgressRecord, CourseNode } from "./types.js";

/** Mirrors the seeded ADHS course shape: 5 modules, chapters beneath each. */
const course: CourseNode = {
  id: "adhs",
  modules: [
    {
      id: "m1",
      ordinal: 0,
      chapters: [
        {
          id: "m1k1",
          ordinal: 0,
          contents: [{ id: "c1", kind: "video", durationSec: 100 }],
        },
        {
          id: "m1k2",
          ordinal: 1,
          contents: [{ id: "c2", kind: "video", durationSec: 100 }],
        },
      ],
    },
    {
      id: "m2",
      ordinal: 1,
      chapters: [
        {
          id: "m2k1",
          ordinal: 0,
          contents: [{ id: "c3", kind: "video", durationSec: 100 }],
        },
      ],
    },
  ],
};

const done = (id: string): ContentProgressRecord => ({
  contentId: id,
  status: "completed",
});

describe("rollupProgress", () => {
  /**
   * The course agrees with the modules inside it about the word "started"
   * (P68-02).
   *
   * It did not: modules and chapters asked whether any content had left
   * `not_started`, and the course asked whether any had been *completed*. One
   * response therefore carried `course.status === "not_started"` above
   * `modules.m1.status === "in_progress"`, which is CLAUDE.md §4 invariant 6
   * being false inside a single function.
   *
   * A watched-but-unfinished video is the case that separates the two, and it
   * is the ordinary one: a physician who stops half way through the first
   * chapter.
   */
  it("calls a course started when any content has been started, not only completed", () => {
    const rollup = rollupProgress(course, [
      { contentId: "c1", status: "in_progress", watchedPercent: 50 },
    ]);

    expect(rollup.course.status).toBe("in_progress");
    expect(rollup.modules["m1"]?.status).toBe("in_progress");
    expect(rollup.chapters["m1k1"]?.status).toBe("in_progress");
    // And nothing is claimed to be finished on the strength of it.
    expect(rollup.course.completedCount).toBe(0);
    expect(rollup.modules["m2"]?.status).toBe("not_started");
  });

  it("rolls status up through content, chapter, module and course", () => {
    const rollup = rollupProgress(course, [done("c1"), done("c2")]);

    expect(rollup.contents["c1"]?.status).toBe("completed");
    expect(rollup.chapters["m1k1"]?.status).toBe("completed");
    expect(rollup.modules["m1"]?.status).toBe("completed");
    expect(rollup.modules["m2"]?.status).toBe("not_started");
    expect(rollup.course.status).toBe("in_progress");
  });

  it("weights percentages by content, not by averaging child percentages", () => {
    const rollup = rollupProgress(course, [done("c1"), done("c2")]);

    // 2 of 3 content items. Averaging the modules would give 50 %.
    expect(rollup.course.percent).toBe(66);
    expect(rollup.course.completedCount).toBe(2);
    expect(rollup.course.totalCount).toBe(3);
  });

  it("counts modules separately for the 'X von Y Module' ring", () => {
    // The design's progress ring counts modules; course.percent counts content.
    // They legitimately disagree, which is why they are separate fields.
    const rollup = rollupProgress(course, [done("c1"), done("c2")]);

    expect(rollup.moduleCompletion).toEqual({ completed: 1, total: 2 });
    expect(rollup.course.percent).toBe(66);
  });

  it("reports a partially started chapter as in progress", () => {
    const rollup = rollupProgress(course, [
      { contentId: "c1", status: "in_progress", watchedPercent: 40 },
    ]);

    expect(rollup.chapters["m1k1"]?.status).toBe("in_progress");
    expect(rollup.modules["m1"]?.status).toBe("in_progress");
    expect(rollup.contents["c1"]?.watchedPercent).toBe(40);
  });

  it("reports 0 %% for an empty course rather than NaN", () => {
    const empty = rollupProgress({ id: "empty", modules: [] }, []);

    expect(empty.course.percent).toBe(0);
    expect(Number.isNaN(empty.course.percent)).toBe(false);
    expect(empty.course.status).toBe("not_started");
    expect(empty.moduleCompletion).toEqual({ completed: 0, total: 0 });
  });

  it("handles a module with no chapters", () => {
    const rollup = rollupProgress(
      { id: "c", modules: [{ id: "m1", ordinal: 0, chapters: [] }] },
      [],
    );

    expect(rollup.modules["m1"]?.percent).toBe(0);
  });

  it("recomputes rather than stranding a learner above 100 %% when content is added", () => {
    const before = rollupProgress(course, [done("c1"), done("c2"), done("c3")]);
    expect(before.course.percent).toBe(100);

    const extended: CourseNode = {
      ...course,
      modules: [
        ...course.modules,
        {
          id: "m3",
          ordinal: 2,
          chapters: [
            {
              id: "m3k1",
              ordinal: 0,
              contents: [{ id: "c4", kind: "video", durationSec: 60 }],
            },
          ],
        },
      ],
    };

    const after = rollupProgress(extended, [done("c1"), done("c2"), done("c3")]);

    expect(after.course.percent).toBe(75);
    expect(after.course.percent).toBeLessThanOrEqual(100);
    expect(after.course.status).toBe("in_progress");
  });

  it("ignores progress records for content not in the course", () => {
    const rollup = rollupProgress(course, [done("c1"), done("not-in-course")]);
    expect(rollup.course.completedCount).toBe(1);
  });

  it("carries quiz scores through to the content summary", () => {
    const rollup = rollupProgress(course, [
      { contentId: "c1", status: "completed", scorePercent: 72 },
    ]);

    expect(rollup.contents["c1"]?.scorePercent).toBe(72);
  });

  it("produces identical output for the learner and admin call sites", () => {
    // CLAUDE.md section 4 invariant 6: one rollup path. Both views call this
    // function over the same repository method, so identical input must give
    // identical output - there is no second implementation to drift from.
    const progress = [done("c1"), done("c2")];

    expect(rollupProgress(course, progress)).toEqual(rollupProgress(course, progress));
  });
});

describe("courseChapterSequence", () => {
  it("flattens modules and chapters into one ordered gating sequence", () => {
    const rollup = rollupProgress(course, [done("c1")]);
    const sequence = courseChapterSequence(course, rollup);

    expect(sequence.map((item) => item.id)).toEqual(["m1k1", "m1k2", "m2k1"]);
    expect(sequence.map((item) => item.ordinal)).toEqual([0, 1, 2]);
  });

  it("gates sequentially across module boundaries, not restarting per module", () => {
    const rollup = rollupProgress(course, []);
    const sequence = courseChapterSequence(course, rollup);

    expect(sequence.map((item) => item.completed)).toEqual([false, false, false]);
  });

  it("respects ordinals over declaration order", () => {
    const reversed: CourseNode = {
      id: "c",
      modules: [
        {
          id: "m2",
          ordinal: 1,
          chapters: [{ id: "m2k1", ordinal: 0, contents: [] }],
        },
        {
          id: "m1",
          ordinal: 0,
          chapters: [{ id: "m1k1", ordinal: 0, contents: [] }],
        },
      ],
    };

    const sequence = courseChapterSequence(reversed, rollupProgress(reversed, []));
    expect(sequence.map((item) => item.id)).toEqual(["m1k1", "m2k1"]);
  });
});
