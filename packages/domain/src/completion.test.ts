import { describe, expect, it } from "vitest";
import { isCourseComplete, type CompletionInput } from "./completion.js";

const complete: CompletionInput = {
  requiredWatchPercent: 100,
  achievedWatchPercent: 100,
  quizPassed: true,
  // P167-01 added this condition. These cases predate it and are about the
  // others, so it holds — the state they were written in, said out loud now
  // that it has a name.
  readingAcknowledged: true,
  evaluationSubmitted: true,
  efnPresent: true,
};

describe("isCourseComplete", () => {
  it("certifies only when all four conditions hold", () => {
    expect(isCourseComplete(complete)).toEqual({
      courseComplete: true,
      complete: true,
      outstanding: [],
      outstandingForCourse: [],
    });
  });

  it("names each outstanding condition specifically", () => {
    // The completion screen has to say what is missing. "Not yet complete" at
    // the end of an hour of study is where a learner gives up.
    expect(isCourseComplete({ ...complete, quizPassed: false }).outstanding).toEqual([
      "quiz",
    ]);
    expect(
      isCourseComplete({ ...complete, evaluationSubmitted: false }).outstanding,
    ).toEqual(["evaluation"]);
    expect(isCourseComplete({ ...complete, efnPresent: false }).outstanding).toEqual([
      "efn",
    ]);
    expect(
      isCourseComplete({ ...complete, achievedWatchPercent: 99 }).outstanding,
    ).toEqual(["watch"]);
  });

  it("lists every outstanding condition, not just the first", () => {
    const result = isCourseComplete({
      requiredWatchPercent: 100,
      achievedWatchPercent: 0,
      quizPassed: false,
      readingAcknowledged: true,
      evaluationSubmitted: false,
      efnPresent: false,
    });

    expect(result.outstanding).toEqual(["watch", "quiz", "evaluation", "efn"]);
  });

  it("certifies only for the one combination where nothing is outstanding", () => {
    // All sixteen combinations of the four boolean-ish conditions.
    const flags = [false, true];
    let completeCount = 0;

    for (const watch of flags) {
      for (const quiz of flags) {
        for (const evaluation of flags) {
          for (const efn of flags) {
            const result = isCourseComplete({
              requiredWatchPercent: 100,
              achievedWatchPercent: watch ? 100 : 50,
              quizPassed: quiz,
              readingAcknowledged: true,
              evaluationSubmitted: evaluation,
              efnPresent: efn,
            });

            if (result.complete) completeCount += 1;
            expect(result.complete).toBe(watch && quiz && evaluation && efn);
          }
        }
      }
    }

    expect(completeCount).toBe(1);
  });

  it("honours a configured watch requirement below 100", () => {
    const at80 = { ...complete, requiredWatchPercent: 80 };

    expect(isCourseComplete({ ...at80, achievedWatchPercent: 80 }).complete).toBe(true);
    expect(isCourseComplete({ ...at80, achievedWatchPercent: 79 }).complete).toBe(false);
  });

  it("treats a 0 %% watch requirement as always satisfied", () => {
    expect(
      isCourseComplete({
        ...complete,
        requiredWatchPercent: 0,
        achievedWatchPercent: 0,
      }).complete,
    ).toBe(true);
  });
});

/**
 * The course is finished before the paperwork is (P51-01).
 *
 * This block is the whole content of the change: a physician who has watched
 * the videos and passed the Lernerfolgskontrolle **has done the course**, and
 * every assertion here exists to stop the evaluation or the EFN quietly
 * becoming part of that sentence again.
 */
describe("course completion, separately from certification", () => {
  const watchedAndPassed = {
    requiredWatchPercent: 100,
    achievedWatchPercent: 100,
    quizPassed: true,
    readingAcknowledged: true,
    evaluationSubmitted: false,
    efnPresent: false,
  };

  it("completes the course on the videos and the quiz alone", () => {
    expect(isCourseComplete(watchedAndPassed)).toEqual({
      courseComplete: true,
      complete: false,
      outstanding: ["evaluation", "efn"],
      outstandingForCourse: [],
    });
  });

  it("does not certify it — the point is not earned yet", () => {
    // The direction that matters. A bug here files a Punktemeldung with no EFN
    // to credit it to.
    expect(isCourseComplete(watchedAndPassed).complete).toBe(false);
  });

  it("holds the course open while the watching is short", () => {
    const result = isCourseComplete({ ...watchedAndPassed, achievedWatchPercent: 99 });

    expect(result.courseComplete).toBe(false);
    expect(result.outstandingForCourse).toEqual(["watch"]);
  });

  it("holds the course open while the quiz is unpassed", () => {
    const result = isCourseComplete({ ...watchedAndPassed, quizPassed: false });

    expect(result.courseComplete).toBe(false);
    expect(result.outstandingForCourse).toEqual(["quiz"]);
  });

  it("never reports the course complete while a course condition is outstanding", () => {
    // The property, over all sixteen combinations: `courseComplete` depends on
    // the watching and the quiz and on nothing else. An evaluation or an EFN
    // must not be able to move it in either direction.
    const flags = [false, true];

    for (const watch of flags) {
      for (const quiz of flags) {
        for (const evaluation of flags) {
          for (const efn of flags) {
            const result = isCourseComplete({
              requiredWatchPercent: 100,
              achievedWatchPercent: watch ? 100 : 50,
              quizPassed: quiz,
              readingAcknowledged: true,
              evaluationSubmitted: evaluation,
              efnPresent: efn,
            });

            expect(result.courseComplete).toBe(watch && quiz);
          }
        }
      }
    }
  });

  it("keeps certification implying course completion, never the reverse", () => {
    const flags = [false, true];

    for (const watch of flags) {
      for (const quiz of flags) {
        for (const evaluation of flags) {
          for (const efn of flags) {
            const result = isCourseComplete({
              requiredWatchPercent: 100,
              achievedWatchPercent: watch ? 100 : 50,
              quizPassed: quiz,
              readingAcknowledged: true,
              evaluationSubmitted: evaluation,
              efnPresent: efn,
            });

            if (result.complete) expect(result.courseComplete).toBe(true);
          }
        }
      }
    }
  });

  it("splits outstanding into the half that blocks the course and the half that does not", () => {
    const nothingDone = isCourseComplete({
      requiredWatchPercent: 100,
      achievedWatchPercent: 0,
      quizPassed: false,
      readingAcknowledged: true,
      evaluationSubmitted: false,
      efnPresent: false,
    });

    expect(nothingDone.outstanding).toEqual(["watch", "quiz", "evaluation", "efn"]);
    expect(nothingDone.outstandingForCourse).toEqual(["watch", "quiz"]);
  });
});

/**
 * A course that awards no points.
 *
 * There will be educational courses with no accreditation behind them. They
 * have no Punktemeldung to file, so asking for a Fortbildungsnummer collects
 * personal data for no purpose — and then refuses to certify until they supply
 * it, which is the part that matters.
 */
describe("a course with no CME points", () => {
  const done = {
    requiredWatchPercent: 100,
    achievedWatchPercent: 100,
    quizPassed: true,
    readingAcknowledged: true,
    evaluationSubmitted: true,
    efnPresent: false,
  };

  it("certifies without an EFN", () => {
    expect(isCourseComplete({ ...done, awardsCmePoints: false })).toEqual({
      courseComplete: true,
      complete: true,
      outstanding: [],
      outstandingForCourse: [],
    });
  });

  it("still requires the watching, the quiz and the evaluation", () => {
    // Not accredited is not the same as not a course.
    expect(
      isCourseComplete({
        requiredWatchPercent: 100,
        achievedWatchPercent: 40,
        quizPassed: false,
        readingAcknowledged: true,
        evaluationSubmitted: false,
        efnPresent: false,
        awardsCmePoints: false,
      }),
    ).toEqual({
      courseComplete: false,
      complete: false,
      outstanding: ["watch", "quiz", "evaluation"],
      outstandingForCourse: ["watch", "quiz"],
    });
  });

  it("asks for the EFN when the flag is absent", () => {
    // A caller that has not been updated must over-collect rather than
    // silently stop: over-collecting is a bug, a missing Punktemeldung is a
    // compliance incident.
    expect(isCourseComplete(done)).toEqual({
      courseComplete: true,
      complete: false,
      outstanding: ["efn"],
      outstandingForCourse: [],
    });
  });

  it("asks for it when the course does award points", () => {
    expect(isCourseComplete({ ...done, awardsCmePoints: true })).toEqual({
      courseComplete: true,
      complete: false,
      outstanding: ["efn"],
      outstandingForCourse: [],
    });
  });
});

/*
 * P167-01. A text section is part of the Fortbildung.
 *
 * `docs/show-stoppers.md` §S33, answered by the client: *"maybe one course is
 * just texts, we should have a frontend checkbox that says i have read the
 * text, and then the next button which is disabled becomes enabled and that
 * counts as that part as done."*
 *
 * Until now the gate was watch coverage plus quizzes, and `courseWatchCoverage`
 * counts videos only — so a course of two text sections, one video and one exam
 * completed with both texts never opened, while the rollup beside it read 50 %.
 * A course of nothing but text completed the moment somebody enrolled.
 */
describe("reading, as a condition of finishing the course", () => {
  const base = {
    requiredWatchPercent: 100,
    achievedWatchPercent: 100,
    quizPassed: true,
    readingAcknowledged: true,
    evaluationSubmitted: true,
    efnPresent: true,
    alreadyCompleted: false,
  };

  it("holds the course back until every text section is acknowledged", () => {
    const result = isCourseComplete({ ...base, readingAcknowledged: false });

    expect(result.courseComplete).toBe(false);
    expect(result.outstandingForCourse).toContain("reading");
  });

  it("completes a course made only of text once it is acknowledged", () => {
    // No video at all: `courseWatchCoverage` calls that vacuously 100 %, which
    // is right, and used to mean such a course was complete on enrolment.
    const result = isCourseComplete({ ...base, achievedWatchPercent: 100 });

    expect(result.courseComplete).toBe(true);
    expect(result.complete).toBe(true);
  });

  it("never un-finishes an enrolment that was already completed", () => {
    /*
     * The half that stops this being a retroactive rule change. A physician who
     * finished under the old gate holds a Teilnahmebescheinigung and may have a
     * Punktemeldung filed; a new condition must not reopen that. Same principle
     * as the enrolment's snapshot columns, for a condition that has no snapshot
     * because it did not exist when they enrolled.
     *
     * It also covers the ordinary case of an author adding a text section to a
     * published course after somebody has finished it.
     */
    const result = isCourseComplete({
      ...base,
      readingAcknowledged: false,
      alreadyCompleted: true,
    });

    expect(result.courseComplete).toBe(true);
    expect(result.outstandingForCourse).toEqual([]);
  });

  it("holds it complete when a raised threshold would otherwise reopen it", () => {
    /*
     * P174-01 gave this guard a second, larger job.
     *
     * The gate's thresholds are the course's now, live, on the client's
     * decision — so an operator raising `required_watch_percent` from 80 to 100
     * changes the rule under everybody at once. For work still in progress that
     * is what was asked for. For a Fortbildung somebody finished last week it
     * would be the platform withdrawing a completion it had already recorded,
     * and this is the line that refuses to.
     *
     * Both directions in one case: 90 % achieved against a 100 % requirement is
     * short, and the quiz is unpassed because the pass mark moved too.
     */
    const result = isCourseComplete({
      ...base,
      requiredWatchPercent: 100,
      achievedWatchPercent: 90,
      quizPassed: false,
      alreadyCompleted: true,
    });

    expect(result.courseComplete).toBe(true);
    expect(result.outstandingForCourse).toEqual([]);
  });

  it("applies the raised threshold to somebody still working", () => {
    // The other half, and the reason the guard is narrow: an unfinished
    // enrolment is held to what the course says today.
    const result = isCourseComplete({
      ...base,
      requiredWatchPercent: 100,
      achievedWatchPercent: 90,
      alreadyCompleted: false,
    });

    expect(result.courseComplete).toBe(false);
    expect(result.outstandingForCourse).toEqual(["watch"]);
  });

  it("still reports what a half-finished course is waiting for, in order", () => {
    const result = isCourseComplete({
      ...base,
      achievedWatchPercent: 40,
      quizPassed: false,
      readingAcknowledged: false,
    });

    expect(result.outstandingForCourse).toEqual(["watch", "quiz", "reading"]);
  });
});
