import { describe, expect, it } from "vitest";
import { isCourseComplete, type CompletionInput } from "./completion.js";

const complete: CompletionInput = {
  requiredWatchPercent: 100,
  achievedWatchPercent: 100,
  quizPassed: true,
  evaluationSubmitted: true,
  efnPresent: true,
};

describe("isCourseComplete", () => {
  it("completes only when all four conditions hold", () => {
    expect(isCourseComplete(complete)).toEqual({ complete: true, outstanding: [] });
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
      evaluationSubmitted: false,
      efnPresent: false,
    });

    expect(result.outstanding).toEqual(["watch", "quiz", "evaluation", "efn"]);
  });

  it("completes only for the one combination where nothing is outstanding", () => {
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
 * A course that awards no points.
 *
 * There will be educational courses with no accreditation behind them. They
 * have no Punktemeldung to file, so asking for a Fortbildungsnummer collects
 * personal data for no purpose — and then refuses to let the learner finish
 * until they supply it, which is the part that matters.
 */
describe("a course with no CME points", () => {
  const done = {
    requiredWatchPercent: 100,
    achievedWatchPercent: 100,
    quizPassed: true,
    evaluationSubmitted: true,
    efnPresent: false,
  };

  it("completes without an EFN", () => {
    expect(isCourseComplete({ ...done, awardsCmePoints: false })).toEqual({
      complete: true,
      outstanding: [],
    });
  });

  it("still requires the watching, the quiz and the evaluation", () => {
    // Not accredited is not the same as not a course.
    expect(
      isCourseComplete({
        requiredWatchPercent: 100,
        achievedWatchPercent: 40,
        quizPassed: false,
        evaluationSubmitted: false,
        efnPresent: false,
        awardsCmePoints: false,
      }),
    ).toEqual({
      complete: false,
      outstanding: ["watch", "quiz", "evaluation"],
    });
  });

  it("asks for the EFN when the flag is absent", () => {
    // A caller that has not been updated must over-collect rather than
    // silently stop: over-collecting is a bug, a missing Punktemeldung is a
    // compliance incident.
    expect(isCourseComplete(done)).toEqual({
      complete: false,
      outstanding: ["efn"],
    });
  });

  it("asks for it when the course does award points", () => {
    expect(isCourseComplete({ ...done, awardsCmePoints: true })).toEqual({
      complete: false,
      outstanding: ["efn"],
    });
  });
});
