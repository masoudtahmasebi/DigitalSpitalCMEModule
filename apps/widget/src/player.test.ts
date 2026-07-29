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
import { itemIcon, locateContent, playbackDuration } from "./player.js";

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
