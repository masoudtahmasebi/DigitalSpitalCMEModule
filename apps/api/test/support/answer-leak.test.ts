/**
 * That the answer-key matcher can actually fire (QA §3.1, CLAUDE.md §9.1).
 *
 * The six assertions this replaces were `not.toContain("isCorrect")`, and every
 * one of them was green — correctly — while covering exactly one field name.
 * A matcher written to cover the family is worth nothing unless something
 * proves it catches the family, so these are the cases it exists for, and the
 * ones it must *not* fire on.
 */

import { describe, expect, it } from "vitest";
import { expectNoAnswerKey } from "./answer-leak.js";

describe("the shapes a learner must never be sent", () => {
  it.each([
    ["isCorrect", { options: [{ id: "a", isCorrect: true }] }],
    ["is_correct", { options: [{ id: "a", is_correct: false }] }],
    ["correctAnswerIds", { question: { correctAnswerIds: ["a"] } }],
    ["correct_answer", { question: { correct_answer: "a" } }],
    ["answerKey", { answerKey: ["a", "b"] }],
    ["answer_key", { answer_key: ["a"] }],
    ["solution", { solution: "b" }],
    ["isRight", { options: [{ isRight: true }] }],
    ["nested deeply", { a: { b: { c: [{ d: { isCorrect: true } }] } } }],
  ])("is refused: %s", (_name, body) => {
    expect(() => expectNoAnswerKey(body, "test")).toThrow(/correctness marker/u);
  });
});

describe("the shapes it must leave alone", () => {
  /*
   * A plain substring search for "correct" fires on all of these, which is why
   * the matcher looks at JSON *keys*. The EIV correction window is real domain
   * vocabulary on responses a learner does see, and a check that cried wolf on
   * it would be switched off within a week.
   */
  it.each([
    ["the EIV correction window", { correctionWindowUntil: "2026-09-20T00:00:00Z" }],
    ["German copy", { hint: "Bitte korrigieren Sie Ihre Eingabe." }],
    ["prose containing the word", { description: "answered correctly by most" }],
    ["a legitimate score", { scorePercent: 80, passed: true, correctCount: 4 }],
  ])("is allowed: %s", (_name, body) => {
    expect(() => expectNoAnswerKey(body, "test")).not.toThrow();
  });
});
