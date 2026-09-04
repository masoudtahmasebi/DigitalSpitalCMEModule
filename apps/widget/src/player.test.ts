/**
 * The player derivations.
 *
 * `itemIcon` gets the bulk of it because its precedence order is the only thing
 * it is, and each rule exists because the alternative tells the learner
 * something false about their own progress. The two that matter most are the
 * ones asserted as "wins over": a locked item never draws a check, and a
 * completed item never reverts to a play arrow.
 */

import { describe, expect, it } from "vitest";
import type { CourseDetail, ProgressSummary } from "@ds/sdk";
import {
  itemIcon,
  locateContent,
  moduleNumber,
  nextAvailableContent,
  passedQuizScore,
  playbackDuration,
} from "./player.js";

function progress(status: ProgressSummary["status"]): Pick<ProgressSummary, "status"> {
  return { status };
}

const course: Pick<CourseDetail, "modules"> = {
  modules: [
    {
      id: "m1",
      ordinal: 0,
      title: "Grundlagen",
      subtitle: null,
      chapters: [
        {
          id: "c1",
          ordinal: 0,
          title: "Epidemiologie",
          contents: [
            {
              id: "x1",
              ordinal: 0,
              kind: "video",
              title: "Video",
              durationSec: 60,
              mimeType: null,
            },
          ],
        },
      ],
    },
    {
      id: "m2",
      ordinal: 1,
      title: "Diagnostik",
      subtitle: null,
      chapters: [
        {
          id: "c2",
          ordinal: 0,
          title: "Anamnese",
          contents: [
            {
              id: "x2",
              ordinal: 0,
              kind: "text",
              title: "Text",
              durationSec: null,
              mimeType: null,
            },
            {
              id: "x3",
              ordinal: 1,
              kind: "quiz",
              title: "LEK",
              durationSec: null,
              mimeType: null,
            },
          ],
        },
      ],
    },
  ],
};

describe("locateContent", () => {
  it("returns the zero-based module index the counter is built from", () => {
    expect(locateContent(course, "x1")).toEqual({
      moduleId: "m1",
      moduleIndex: 0,
      chapterId: "c1",
    });
    // "Modul 2 von 2" — index 1.
    expect(locateContent(course, "x3")?.moduleIndex).toBe(1);
  });

  it("finds a content that is not the first in its chapter", () => {
    expect(locateContent(course, "x3")?.chapterId).toBe("c2");
  });

  it("is undefined for an unknown id rather than defaulting to the first module", () => {
    // A wrong "Modul 1 von 5" is worse than no counter at all.
    expect(locateContent(course, "nope")).toBeUndefined();
  });

  it("is undefined for a course with no modules", () => {
    expect(locateContent({ modules: [] }, "x1")).toBeUndefined();
  });
});

describe("moduleNumber — the sidebar and the heading must agree (P115-01)", () => {
  it("gives a module the same position locateContent gives its content", () => {
    /*
     * The property the client's screenshot broke: the sidebar said
     * "Modul 4 – Psychotherapie & Coaching" and the heading below the video
     * said "Modul 5 – Psychotherapie & Coaching", for the same chapter.
     *
     * The heading numbers from `locateContent`; the sidebar numbered from its
     * own position in a *different* list. This asserts the two answer the same
     * thing for every module in the course.
     */
    for (const [expected, module] of course.modules.entries()) {
      const anyContentId = module.chapters[0]?.contents[0]?.id;
      expect(moduleNumber(course, module.id)).toBe(expected);
      if (anyContentId !== undefined) {
        expect(locateContent(course, anyContentId)?.moduleIndex).toBe(expected);
      }
    }
  });

  it("numbers by the course, not by the order it is asked in", () => {
    // The sidebar walks the enrolment state, which is a separate read and may
    // hold the modules in another order or omit one. Asking out of order must
    // not change the answer — that is the whole point of a single source.
    const reversed = [...course.modules].reverse();
    for (const module of reversed) {
      expect(moduleNumber(course, module.id)).toBe(
        course.modules.findIndex((m) => m.id === module.id),
      );
    }
  });

  it("is undefined for a module the course does not hold", () => {
    // The sidebar falls back to its own position here rather than rendering a
    // module with no number — but it has to be able to tell.
    expect(moduleNumber(course, "not-a-module")).toBeUndefined();
  });
});

describe("itemIcon", () => {
  it("draws a padlock whatever the progress says", () => {
    // A chapter reordered behind an unfinished one keeps its old progress. The
    // gate is the server's verdict and it wins.
    expect(
      itemIcon({ gate: "locked", progress: progress("completed"), current: false }),
    ).toBe("locked");
    expect(
      itemIcon({ gate: "locked", progress: progress("in_progress"), current: true }),
    ).toBe("locked");
  });

  it("keeps the check when a finished item is reopened", () => {
    expect(
      itemIcon({ gate: "completed", progress: progress("completed"), current: true }),
    ).toBe("completed");
  });

  it("accepts either source of 'completed'", () => {
    expect(
      itemIcon({ gate: "available", progress: progress("completed"), current: false }),
    ).toBe("completed");
    expect(
      itemIcon({ gate: "completed", progress: progress("not_started"), current: false }),
    ).toBe("completed");
  });

  it("separates the item being played from the ones merely started", () => {
    expect(
      itemIcon({ gate: "available", progress: progress("in_progress"), current: true }),
    ).toBe("playing");
    expect(
      itemIcon({ gate: "available", progress: progress("in_progress"), current: false }),
    ).toBe("paused");
  });

  it("does not claim an unopened item is in progress", () => {
    expect(
      itemIcon({ gate: "available", progress: progress("not_started"), current: false }),
    ).toBe("available");
  });

  it("shows the current item as playing even before any progress is recorded", () => {
    expect(
      itemIcon({ gate: "available", progress: progress("not_started"), current: true }),
    ).toBe("playing");
  });
});

describe("playbackDuration", () => {
  it("prefers the authored length the watch gate is computed against", () => {
    expect(playbackDuration(1545, 1540)).toBe(1545);
  });

  it("falls back to the element for content authored without one", () => {
    expect(playbackDuration(null, 1540)).toBe(1540);
    expect(playbackDuration(0, 1540)).toBe(1540);
  });

  it("survives the NaN a media element reports before metadata loads", () => {
    expect(playbackDuration(null, Number.NaN)).toBe(0);
    expect(playbackDuration(null, Number.POSITIVE_INFINITY)).toBe(0);
  });
});

/**
 * The way onward from a finished section (P78-02).
 *
 * Reported as _"although the video is done, i can not go forward"_. The player
 * offered „Fortbildung pausieren" and „Zurück zur Übersicht" and nothing else,
 * so continuing meant returning to the outline and finding the next item by
 * hand.
 *
 * The gate is the server's in every case below — these assert that the widget
 * *renders* that answer and never improves on it (CLAUDE.md §4 invariant 1).
 */
describe("nextAvailableContent", () => {
  function course() {
    return {
      modules: [
        {
          chapters: [
            {
              contents: [
                { id: "v1", kind: "video", title: "Grundlagen" },
                { id: "v2", kind: "video", title: "Vertiefung" },
              ],
            },
          ],
        },
        {
          chapters: [
            {
              contents: [
                { id: "v3", kind: "video", title: "Diagnostik" },
                { id: "quiz", kind: "quiz", title: "Lernerfolgskontrolle" },
              ],
            },
          ],
        },
      ],
    } as unknown as Parameters<typeof nextAvailableContent>[0];
  }

  function state(gates: Record<string, string>) {
    return {
      modules: [
        {
          chapters: [
            {
              contents: [
                { id: "v1", gate: gates["v1"] ?? "available" },
                { id: "v2", gate: gates["v2"] ?? "available" },
              ],
            },
          ],
        },
        {
          chapters: [
            {
              contents: [
                { id: "v3", gate: gates["v3"] ?? "locked" },
                { id: "quiz", gate: gates["quiz"] ?? "locked" },
              ],
            },
          ],
        },
      ],
    } as unknown as Parameters<typeof nextAvailableContent>[1];
  }

  it("offers the next section in course order", () => {
    expect(nextAvailableContent(course(), state({}), "v1")).toEqual({
      id: "v2",
      title: "Vertiefung",
    });
  });

  it("crosses a module boundary when the server has opened it", () => {
    expect(nextAvailableContent(course(), state({ v3: "available" }), "v2")).toEqual({
      id: "v3",
      title: "Diagnostik",
    });
  });

  it("offers nothing while the next module is still locked", () => {
    // The whole point: a control that would be refused is worse than none
    // (§9.2). The learner sees the outline's padlock instead.
    expect(nextAvailableContent(course(), state({}), "v2")).toBeUndefined();
  });

  it("goes on to this module's Lernerfolgskontrolle when the server opens it", () => {
    /*
     * This test asserted the opposite until P87-03 — *"never slides into the
     * Lernerfolgskontrolle"*, on the reasoning that the exam has its own button
     * and arriving in it by pressing „Weiter" would start an assessment the
     * learner did not choose to begin.
     *
     * That reasoning holds for a course with one exam at the end. With one per
     * module it is what makes the course unfinishable: after a module's last
     * video, „Weiter" skipped its exam, looked into a module the server had
     * locked, found nothing, and drew no control at all — the reported *"it
     * does not go to next one"*.
     *
     * The learner is still not dropped into an exam. The button names it, and
     * it opens the quiz's start screen, which is a page with a „… starten"
     * button on it.
     */
    expect(nextAvailableContent(course(), state({ quiz: "available" }), "v3")).toEqual({
      id: "quiz",
      title: "Lernerfolgskontrolle",
    });
  });

  it("does not offer an exam the server still has locked", () => {
    // The gate is the server's, for a quiz exactly as for a video: P87-04 holds
    // a module's Lernerfolgskontrolle shut until its videos are watched, and
    // this renders that answer rather than a second opinion.
    expect(nextAvailableContent(course(), state({}), "v3")).toBeUndefined();
  });

  it("offers nothing after the last section", () => {
    const single = {
      modules: [
        { chapters: [{ contents: [{ id: "only", kind: "video", title: "X" }] }] },
      ],
    } as unknown as Parameters<typeof nextAvailableContent>[0];
    const gates = {
      modules: [{ chapters: [{ contents: [{ id: "only", gate: "available" }] }] }],
    } as unknown as Parameters<typeof nextAvailableContent>[1];

    expect(nextAvailableContent(single, gates, "only")).toBeUndefined();
  });

  it("says nothing about a content the enrolment has never heard of", () => {
    expect(
      nextAvailableContent(course(), state({}), "not-in-this-course"),
    ).toBeUndefined();
  });
});

/**
 * A score is not a pass (P191-01).
 *
 * ## The report
 *
 * A course with `pass_threshold_percent = 85`. The learner scored **60 %**, and
 * the exam screen answered:
 *
 * > Sie haben diese Lernerfolgskontrolle bereits mit 60 % bestanden. Sie kann
 * > nicht erneut abgelegt werden.
 *
 * — three lines under its own panel reading **Bestehen 85 %**. The screen
 * contradicted itself on one page, and it took away the retry the API would
 * have accepted.
 *
 * ## The cause, which is §4 invariant 6
 *
 * Two readers of "has this been passed", and they disagreed.
 * `PlayerScreen` compared the recorded score against
 * `state.passThresholdPercent`; `App.tsx` passed `recordedQuizScore` straight
 * into a prop named `passedScorePercent` and compared nothing at all. The
 * presence of a score *was* the pass.
 *
 * The accessor was honest about what it returned — the best score, graded or
 * not. The prop it fed was not, and a name that claims more than its value is
 * how the two came apart.
 *
 * So the comparison lives in one function now, and both screens call it.
 */
describe("passedQuizScore", () => {
  function withScore(scorePercent: number | undefined) {
    return {
      passThresholdPercent: 85,
      modules: [
        {
          chapters: [
            {
              contents: [
                {
                  id: "exam",
                  progress:
                    scorePercent === undefined
                      ? { status: "in_progress" }
                      : { scorePercent },
                },
              ],
            },
          ],
        },
      ],
    } as unknown as Parameters<typeof passedQuizScore>[0];
  }

  // The reported case, at the exact numbers it was reported with.
  it("is undefined for a score below the course's threshold", () => {
    expect(passedQuizScore(withScore(60), "exam")).toBeUndefined();
  });

  it("is the score when it reaches the threshold", () => {
    expect(passedQuizScore(withScore(85), "exam")).toBe(85);
  });

  it("is the score when it clears the threshold", () => {
    expect(passedQuizScore(withScore(100), "exam")).toBe(100);
  });

  // The boundary, named: `>=`, not `>`. 84 fails and 85 passes, and a course
  // set to 85 that refused an 85 would be the off-by-one nobody reports because
  // it looks like a strict examiner.
  it("treats the threshold as inclusive", () => {
    expect(passedQuizScore(withScore(84), "exam")).toBeUndefined();
    expect(passedQuizScore(withScore(85), "exam")).toBe(85);
  });

  it("is undefined for an exam nobody has sat", () => {
    expect(passedQuizScore(withScore(undefined), "exam")).toBeUndefined();
  });

  it("is undefined for content that is not there", () => {
    expect(passedQuizScore(withScore(90), "missing")).toBeUndefined();
  });

  /*
   * Zero is a score, not an absence. `scorePercent ?? undefined` would be right
   * and `scorePercent || undefined` would not — and with a threshold of 0 the
   * difference is a learner told they passed versus told nothing.
   */
  it("handles a zero score without confusing it for an unsat exam", () => {
    expect(passedQuizScore(withScore(0), "exam")).toBeUndefined();

    const everyonePasses = {
      passThresholdPercent: 0,
      modules: [
        { chapters: [{ contents: [{ id: "exam", progress: { scorePercent: 0 } }] }] },
      ],
    } as unknown as Parameters<typeof passedQuizScore>[0];
    expect(passedQuizScore(everyonePasses, "exam")).toBe(0);
  });
});
