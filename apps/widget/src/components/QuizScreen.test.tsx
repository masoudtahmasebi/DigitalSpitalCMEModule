/**
 * The Lernerfolgskontrolle, pages 08 to 12 (#61).
 *
 * The behaviours worth pinning are the ones a paged quiz gets wrong:
 *
 * - **one submission, at the end.** The obvious way to build a
 *   question-at-a-time quiz is to send each page, and that would put partially
 *   scored attempts in the database and change what "unanswered counts as
 *   wrong" means. The count of calls is the assertion.
 * - **no skipping forward**, because `scoreQuiz` scores an unanswered question
 *   as wrong and a learner who could skip would be lowering their own score
 *   without being told.
 * - **the passed screen leads to the points**, which is the whole point of #60:
 *   the EFN form used to sit on the Zertifizierung tab and is now behind this.
 */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient, Quiz, QuizAttemptResult } from "@ds/sdk";
import { QuizScreen } from "./QuizScreen.js";
import { de } from "../locale/de.js";

afterEach(cleanup);

const QUIZ: Quiz = {
  contentId: "content-1",
  passThresholdPercent: 70,
  attemptsUsed: 0,
  maxAttempts: null,
  questions: Array.from({ length: 11 }, (_, index) => ({
    id: `q${String(index + 1)}`,
    ordinal: index,
    kind: "single" as const,
    prompt: `Frage Nummer ${String(index + 1)}?`,
    options: [
      { id: `q${String(index + 1)}-a`, ordinal: 0, label: "Antwort A" },
      { id: `q${String(index + 1)}-b`, ordinal: 1, label: "Antwort B" },
    ],
  })),
};

function attempt(overrides: Partial<QuizAttemptResult>): QuizAttemptResult {
  return {
    attemptNumber: 1,
    correctCount: 10,
    totalCount: 11,
    scorePercent: 91,
    passed: true,
    passThresholdPercent: 70,
    ...overrides,
  } as QuizAttemptResult;
}

/**
 * The exam's own name, as the catalogue tree gives it (P87-02).
 *
 * Deliberately not "Abschlussprüfung": a fixture using the fallback word would
 * pass against a screen that ignores the prop entirely, which is the whole
 * property these assertions are about.
 */
const EXAM_TITLE = "Lernerfolgskontrolle Modul 2";

function clientReturning(result: QuizAttemptResult) {
  const submitQuiz = vi.fn(async () => result);
  return { client: { submitQuiz } as unknown as ApiClient, submitQuiz };
}

function renderQuiz(
  result: QuizAttemptResult,
  handlers: Partial<{
    /**
     * `null` means "the course is not complete" — the prop is
     * `(() => void) | undefined`, and `undefined` here cannot express that
     * because it is also what "the caller did not override this" looks like.
     */
    onClaimPoints: (() => void) | null;
    onBack: () => void;
    onNext: { title: string; open: () => void };
    /** The best score already on file — `undefined` is a first sitting. */
    passedScorePercent: number;
  }> = {},
) {
  const { client, submitQuiz } = clientReturning(result);
  const claim =
    handlers.onClaimPoints === undefined
      ? () => undefined
      : (handlers.onClaimPoints ?? undefined);
  render(
    <QuizScreen
      client={client}
      courseSlug="adhs-akademie-adult"
      quiz={QUIZ}
      examTitle={EXAM_TITLE}
      passedScorePercent={handlers.passedScorePercent}
      onPassed={() => undefined}
      onBack={handlers.onBack ?? (() => undefined)}
      onClaimPoints={claim}
      onNext={handlers.onNext}
    />,
  );
  return { submitQuiz };
}

/** Start, then answer every question with its first option. */
async function answerEverything(): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: `${EXAM_TITLE} starten` }));

  for (let index = 0; index < QUIZ.questions.length; index += 1) {
    fireEvent.click(screen.getAllByRole("radio")[0] as HTMLElement);
    const last = index === QUIZ.questions.length - 1;
    fireEvent.click(screen.getByRole("button", { name: last ? /absenden/ : /Weiter/ }));
    // Let the submission's promise and the state updates behind it settle.
    if (last) await act(async () => undefined);
  }
}

describe("before starting (page 08)", () => {
  it("states the pass rule in the same terms the server scores with", () => {
    // 11 questions at 70 % is eight right — `minimumCorrectAnswers`, not a
    // rounding this component invented.
    renderQuiz(attempt({}));

    expect(screen.getByText("Anzahl Fragen")).toBeTruthy();
    expect(screen.getByText("Mind. 8 von 11 richtig")).toBeTruthy();
    expect(screen.getByText("Single Choice")).toBeTruthy();
  });

  it("asks no questions until the learner starts", () => {
    renderQuiz(attempt({}));

    expect(screen.queryByText("Frage Nummer 1?")).toBeNull();
  });
});

describe("an exam the learner has already passed (P164-04)", () => {
  /*
   * The client, from the running system: *"when the doctor finished the course,
   * cleared the exam and got the certificate — I can still see the option to
   * take the exam again."*
   *
   * The intro offered a bare **Lernerfolgskontrolle beginnen** whatever had
   * happened before, which on a finished course reads as an outstanding task.
   * Nothing was broken underneath — `upsertQuizProgress` stores the best score
   * across attempts, so a repeat cannot undo a pass — and nothing said so
   * either, which is the whole defect (§9.4).
   */
  it("says the exam is already passed, and with what score", () => {
    renderQuiz(attempt({}), { passedScorePercent: 81 });

    expect(screen.getByText(/bereits mit 81 % bestanden/u)).toBeTruthy();
  });

  it("promises what the stored rule actually does — the best attempt counts", () => {
    // Not a reassurance invented for the screen: it is `Math.max` over the
    // attempts, in assessment.repository.ts.
    renderQuiz(attempt({}), { passedScorePercent: 81 });

    expect(screen.getByText(/bestes Ergebnis/u)).toBeTruthy();
    expect(screen.getByText(/kann Ihr Bestehen also nicht aufheben/u)).toBeTruthy();
  });

  it("offers a repeat rather than a start, and stops shouting about it", () => {
    renderQuiz(attempt({}), { passedScorePercent: 81 });

    expect(screen.getByRole("button", { name: de.quiz.repeat })).toBeTruthy();
    expect(screen.queryByText(de.quiz.start(EXAM_TITLE))).toBeNull();
  });

  it("is the ordinary start screen on a first sitting", () => {
    // The guard: this must not turn every intro into a congratulation.
    renderQuiz(attempt({}));

    expect(screen.queryByText(/bereits mit/u)).toBeNull();
    expect(screen.getByRole("button", { name: de.quiz.start(EXAM_TITLE) })).toBeTruthy();
  });
});

describe("answering (pages 09–10)", () => {
  it("shows one question at a time", () => {
    renderQuiz(attempt({}));
    fireEvent.click(screen.getByRole("button", { name: `${EXAM_TITLE} starten` }));

    expect(screen.getByText("Frage Nummer 1?")).toBeTruthy();
    expect(screen.queryByText("Frage Nummer 2?")).toBeNull();
    expect(screen.getByText("Frage 1 von 11")).toBeTruthy();
  });

  it("refuses to move on until the question has an answer", () => {
    renderQuiz(attempt({}));
    fireEvent.click(screen.getByRole("button", { name: `${EXAM_TITLE} starten` }));

    const next = screen.getByRole("button", { name: /Weiter/ });
    expect(next.hasAttribute("disabled")).toBe(true);

    fireEvent.click(screen.getAllByRole("radio")[0] as HTMLElement);

    expect(screen.getByRole("button", { name: /Weiter/ }).hasAttribute("disabled")).toBe(
      false,
    );
  });

  it("lets the learner go back and keeps the answer they gave", () => {
    renderQuiz(attempt({}));
    fireEvent.click(screen.getByRole("button", { name: `${EXAM_TITLE} starten` }));
    fireEvent.click(screen.getAllByRole("radio")[0] as HTMLElement);
    fireEvent.click(screen.getByRole("button", { name: /Weiter/ }));

    fireEvent.click(screen.getByRole("button", { name: /Zurück/ }));

    expect(screen.getByText("Frage Nummer 1?")).toBeTruthy();
    expect((screen.getAllByRole("radio")[0] as HTMLInputElement).checked).toBe(true);
  });
});

describe("submitting", () => {
  it("sends every answer in exactly one request, at the end", async () => {
    // The invariant. Eleven questions, one POST — never one per page.
    const { submitQuiz } = renderQuiz(attempt({}));

    await answerEverything();

    expect(submitQuiz).toHaveBeenCalledTimes(1);
    const body = (submitQuiz.mock.calls[0] as unknown as unknown[])[2] as {
      answers: unknown[];
    };
    expect(body.answers).toHaveLength(11);
  });
});

describe("the result", () => {
  it("passed: offers the points, and nothing to retry", async () => {
    // Layout 12.3, and the reason #60 exists: this button is what opens the EFN
    // screen. It used to be a form on the Zertifizierung tab.
    const onClaimPoints = vi.fn();
    renderQuiz(attempt({ passed: true }), { onClaimPoints });

    await answerEverything();

    expect(screen.getByText(`${EXAM_TITLE} bestanden!`)).toBeTruthy();
    expect(screen.getByText("91 %")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /wiederholen/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /CME-Punkte geltend machen/ }));
    expect(onClaimPoints).toHaveBeenCalledTimes(1);
  });

  it("passed but the course is not finished: no claim, the next section instead", async () => {
    /*
     * The 409 (P82-01).
     *
     * A course holds one Lernerfolgskontrolle per the engine, but a learner
     * reaches it with modules still unwatched — and this screen offered
     * **CME-Punkte geltend machen** on every pass regardless. Following it saved
     * an EFN and then took a 409 naming the video still to watch.
     *
     * The parent decides, from the server's `courseComplete`, by passing no
     * callback. What must not happen is the button appearing anyway.
     */
    const open = vi.fn();
    renderQuiz(attempt({ passed: true }), {
      onClaimPoints: null,
      onNext: { title: "Pharmakotherapie", open },
    });

    await answerEverything();

    expect(screen.getByText(`${EXAM_TITLE} bestanden!`)).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /CME-Punkte geltend machen/ }),
    ).toBeNull();

    // And it says so, rather than leaving a passed exam with no explanation of
    // why the points are not on offer (§9.4).
    expect(screen.getByText(/fehlen noch Abschnitte/u)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Weiter: Pharmakotherapie/ }));
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("passed, course unfinished, nothing open: still says why, and offers the way back", async () => {
    // The last section of a course whose gate is not satisfiable leaves no
    // "next". A screen with a passed exam and no sentence at all would read as
    // a broken page.
    renderQuiz(attempt({ passed: true }), { onClaimPoints: null });

    await answerEverything();

    expect(
      screen.queryByRole("button", { name: /CME-Punkte geltend machen/ }),
    ).toBeNull();
    expect(screen.getByText(/fehlen noch Abschnitte/u)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Zurück zur Übersicht/ })).toBeTruthy();
  });

  it("failed: says how many were needed, and offers another attempt", async () => {
    renderQuiz(attempt({ passed: false, correctCount: 3, scorePercent: 27 }));

    await answerEverything();

    expect(screen.getByText("Prüfung nicht bestanden")).toBeTruthy();
    expect(
      screen.getByText("8 von 11 richtige Antworten zum Bestehen erforderlich"),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /CME-Punkte geltend machen/ }),
    ).toBeNull();

    // Retrying returns to the intro with a clean slate — a second attempt that
    // began with the first one's selections would be scored against answers the
    // learner never re-confirmed.
    fireEvent.click(screen.getByRole("button", { name: /wiederholen/ }));
    expect(screen.getByRole("button", { name: `${EXAM_TITLE} starten` })).toBeTruthy();
  });

  it("never claims to show which answers were wrong", async () => {
    // A CME-certified course does not set `revealCorrectAnswers`, so the
    // attempt carries no `perQuestion` and the screen says so rather than
    // leaving a physician looking for a review that does not exist.
    renderQuiz(attempt({ passed: false, correctCount: 3, scorePercent: 27 }));

    await answerEverything();

    expect(screen.getByText(/nicht angezeigt/)).toBeTruthy();
  });
});
