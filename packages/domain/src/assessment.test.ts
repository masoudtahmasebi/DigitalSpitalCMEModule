import { describe, expect, it } from "vitest";
import {
  minimumCorrectAnswers,
  scoreQuiz,
  UnknownQuestionError,
  type Question,
} from "./assessment.js";

const single = (id: string, correct: string): Question => ({
  id,
  kind: "single",
  correctOptionIds: [correct],
});

/** The MEDICE configuration: 11 single-choice questions, pass at 70 %. */
const mediceQuiz: Question[] = Array.from({ length: 11 }, (_, i) =>
  single(`q${i + 1}`, `q${i + 1}-a`),
);

const answerCorrectly = (count: number) =>
  mediceQuiz.slice(0, count).map((q) => ({
    questionId: q.id,
    selectedOptionIds: [`${q.id}-a`],
  }));

describe("MEDICE configuration", () => {
  it("passes at 8 of 11 and fails at 7", () => {
    const eight = scoreQuiz(mediceQuiz, answerCorrectly(8), 70);
    const seven = scoreQuiz(mediceQuiz, answerCorrectly(7), 70);

    expect(eight.scorePercent).toBe(72);
    expect(eight.passed).toBe(true);

    expect(seven.scorePercent).toBe(63);
    expect(seven.passed).toBe(false);
  });

  it("reports 6 of 11 as 54 %, matching the result copy in the design", () => {
    // The design specifies "6 out of 11 questions answered correctly. That is
    // 54% - Not passed." 6/11 is 54.54..., so the percentage floors.
    const result = scoreQuiz(mediceQuiz, answerCorrectly(6), 70);

    expect(result.correctCount).toBe(6);
    expect(result.totalCount).toBe(11);
    expect(result.scorePercent).toBe(54);
    expect(result.passed).toBe(false);
  });

  it("treats an unanswered question as wrong", () => {
    const result = scoreQuiz(mediceQuiz, answerCorrectly(11).slice(0, 5), 70);
    expect(result.correctCount).toBe(5);
    expect(result.totalCount).toBe(11);
  });
});

describe("threshold boundary", () => {
  const ten = Array.from({ length: 10 }, (_, i) => single(`q${i + 1}`, `q${i + 1}-a`));
  const correct = (count: number) =>
    ten.slice(0, count).map((q) => ({
      questionId: q.id,
      selectedOptionIds: [`${q.id}-a`],
    }));

  it("passes exactly at the threshold", () => {
    expect(scoreQuiz(ten, correct(7), 70).passed).toBe(true);
  });

  it("fails one mark below the threshold", () => {
    expect(scoreQuiz(ten, correct(6), 70).passed).toBe(false);
  });

  it("honours a 100 % threshold", () => {
    expect(scoreQuiz(ten, correct(9), 100).passed).toBe(false);
    expect(scoreQuiz(ten, correct(10), 100).passed).toBe(true);
  });
});

describe("multi-choice is an exact set match", () => {
  const multi: Question[] = [
    { id: "q1", kind: "multi", correctOptionIds: ["a", "b", "c"] },
  ];

  it("accepts the exact set regardless of order", () => {
    expect(
      scoreQuiz(multi, [{ questionId: "q1", selectedOptionIds: ["c", "a", "b"] }], 70)
        .passed,
    ).toBe(true);
  });

  it("scores a strict subset as zero, with no partial credit", () => {
    const result = scoreQuiz(
      multi,
      [{ questionId: "q1", selectedOptionIds: ["a", "b"] }],
      70,
    );
    expect(result.correctCount).toBe(0);
    expect(result.passed).toBe(false);
  });

  it("scores a superset as zero", () => {
    const result = scoreQuiz(
      multi,
      [{ questionId: "q1", selectedOptionIds: ["a", "b", "c", "d"] }],
      70,
    );
    expect(result.correctCount).toBe(0);
  });

  it("ignores duplicate selections rather than treating them as a size mismatch", () => {
    const result = scoreQuiz(
      multi,
      [{ questionId: "q1", selectedOptionIds: ["a", "a", "b", "c"] }],
      70,
    );
    expect(result.correctCount).toBe(1);
  });

  it("scores an empty selection as zero", () => {
    expect(
      scoreQuiz(multi, [{ questionId: "q1", selectedOptionIds: [] }], 70).correctCount,
    ).toBe(0);
  });
});

describe("rejection of foreign submissions", () => {
  it("throws when an answer names a question outside this quiz", () => {
    // How a submission crafted against another course is rejected.
    expect(() =>
      scoreQuiz(
        mediceQuiz,
        [{ questionId: "other-course-q1", selectedOptionIds: ["a"] }],
        70,
      ),
    ).toThrow(UnknownQuestionError);
  });
});

describe("degenerate quizzes", () => {
  it("passes nobody when there are no questions", () => {
    const result = scoreQuiz([], [], 70);
    expect(result.scorePercent).toBe(0);
    expect(result.passed).toBe(false);
    expect(Number.isNaN(result.scorePercent)).toBe(false);
  });
});

describe("determinism", () => {
  it("returns the same result for the same arguments", () => {
    const answers = answerCorrectly(8);
    expect(scoreQuiz(mediceQuiz, answers, 70)).toEqual(
      scoreQuiz(mediceQuiz, answers, 70),
    );
  });
});

describe("minimumCorrectAnswers", () => {
  it("agrees with scoreQuiz on the MEDICE course", () => {
    // The number the layout prints on page 08: 11 questions, 70 %, eight right.
    expect(minimumCorrectAnswers(11, 70)).toBe(8);
  });

  it("never disagrees with scoreQuiz, over every shape a course could have", () => {
    // The point of the function. `Math.ceil(total * threshold / 100)` matches on
    // 8 of 11 and is wrong elsewhere, and "elsewhere" is every course that is
    // not MEDICE's — which is the whole rest of this platform's life.
    for (let total = 1; total <= 40; total += 1) {
      for (let threshold = 0; threshold <= 100; threshold += 1) {
        const needed = minimumCorrectAnswers(total, threshold);
        if (needed === null) {
          // Nothing passes: no count of correct answers reaches the threshold.
          expect(Math.floor((total / total) * 100) >= threshold).toBe(false);
          continue;
        }

        expect(Math.floor((needed / total) * 100) >= threshold).toBe(true);
        if (needed > 0) {
          expect(Math.floor(((needed - 1) / total) * 100) >= threshold).toBe(false);
        }
      }
    }
  });

  it("is zero when the threshold is zero", () => {
    // Degenerate but real: `scoreQuiz` passes a 0 % threshold with nothing
    // right, so the screen must not claim one answer is needed.
    expect(minimumCorrectAnswers(11, 0)).toBe(0);
  });

  it("has no answer for a quiz with no questions", () => {
    // An authoring state. `scoreQuiz` passes nobody on it, and "Mind. 1 von 0
    // richtig" is not a sentence.
    expect(minimumCorrectAnswers(0, 70)).toBeNull();
  });

  it("has no answer for a threshold nothing can reach", () => {
    expect(minimumCorrectAnswers(11, 101)).toBeNull();
  });
});
