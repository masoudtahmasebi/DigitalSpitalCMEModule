/**
 * That no learner-facing response can carry an answer key (QA §3.1).
 *
 * ## Why a family and not a field name
 *
 * Six tests already asserted `not.toContain("isCorrect")`, and every one of
 * them would stay green against a response that carried `correctAnswerIds`,
 * `answer_key` or `solution`. That is CLAUDE.md §9.1 in an assertion: a check
 * that covers less than it claims. The contract's own words are "**no
 * correctness marker of any kind**", and this is the version of that sentence
 * a test can fail on.
 *
 * ## Why it matches keys, not the body
 *
 * A plain substring search for "correct" fires on the EIV **correction
 * window**, on the word "correctly" in a description, and on any German copy
 * containing "korrekt" — and a check whose first finding is prose is a check
 * nobody runs twice (the same trap `check-deadlines` fell into). So it matches
 * JSON *keys*: `"…correct…":`, and the named families beside it.
 */

/**
 * The answer-key idioms, named explicitly rather than as `*correct*`.
 *
 * The first draft was `[A-Za-z_]*correct[A-Za-z_]*` and its own tests caught it
 * firing on two **legitimate** learner-facing fields: `correctionWindowUntil`
 * (the EIV correction window, which a learner is told about) and `correctCount`
 * (their own score — the contract returns it at line 4602). A matcher that
 * fails a correct response gets switched off within a week, and then it
 * protects nothing.
 *
 * The trade is stated rather than hidden: an invented field like `rightOption`
 * would slip past this list. That is why it is a list somebody extends, and why
 * the real guarantee is structural — the learner-facing `Quiz` type has no
 * field capable of carrying the flag, so leaking it is a compile error (P4-01).
 * This catches the case where somebody adds one.
 */
const LEAK =
  /"[A-Za-z_]*(isCorrect|is_correct|correctAnswer|correct_answer|answerKey|answer_key|solution|isRight|is_right)[A-Za-z_]*"\s*:/iu;

/**
 * Throws with the offending key when `body` carries one.
 *
 * Takes the already-parsed body and serialises it here, so a caller cannot
 * accidentally check a string that was never the response.
 */
export function expectNoAnswerKey(body: unknown, what: string): void {
  const serialised = JSON.stringify(body);
  const hit = LEAK.exec(serialised);

  if (hit !== null) {
    throw new Error(
      `${what}: the response carries ${hit[0]} — a learner-facing shape must ` +
        `have no correctness marker of any kind (QA §3.1). ` +
        `The only route allowed to answer with one is GET /admin/contents/{id}/quiz.`,
    );
  }
}

/** The matcher itself, for a test that wants to assert it can fire. */
export const ANSWER_KEY_PATTERN = LEAK;
