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

function clientReturning(result: QuizAttemptResult) {
  const submitQuiz = vi.fn(async () => result);
  return { client: { submitQuiz } as unknown as ApiClient, submitQuiz };
}

function renderQuiz(
  result: QuizAttemptResult,
  handlers: Partial<{ onClaimPoints: () => void; onBack: () => void }> = {},
) {
  const { client, submitQuiz } = clientReturning(result);
  render(
    <QuizScreen
      client={client}
      courseSlug="adhs-akademie-adult"
      quiz={QUIZ}
      onPassed={() => undefined}
      onBack={handlers.onBack ?? (() => undefined)}
      onClaimPoints={handlers.onClaimPoints ?? (() => undefined)}
    />,
  );
  return { submitQuiz };
}

/** Start, then answer every question with its first option. */
async function answerEverything(): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: /Abschlussprüfung starten/ }));

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

describe("answering (pages 09–10)", () => {
  it("shows one question at a time", () => {
    renderQuiz(attempt({}));
    fireEvent.click(screen.getByRole("button", { name: /Abschlussprüfung starten/ }));

    expect(screen.getByText("Frage Nummer 1?")).toBeTruthy();
    expect(screen.queryByText("Frage Nummer 2?")).toBeNull();
    expect(screen.getByText("Frage 1 von 11")).toBeTruthy();
  });

  it("refuses to move on until the question has an answer", () => {
    renderQuiz(attempt({}));
    fireEvent.click(screen.getByRole("button", { name: /Abschlussprüfung starten/ }));

    const next = screen.getByRole("button", { name: /Weiter/ });
    expect(next.hasAttribute("disabled")).toBe(true);

    fireEvent.click(screen.getAllByRole("radio")[0] as HTMLElement);

    expect(screen.getByRole("button", { name: /Weiter/ }).hasAttribute("disabled")).toBe(
      false,
    );
  });

  it("lets the learner go back and keeps the answer they gave", () => {
    renderQuiz(attempt({}));
    fireEvent.click(screen.getByRole("button", { name: /Abschlussprüfung starten/ }));
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

    expect(screen.getByText("Abschlussprüfung bestanden!")).toBeTruthy();
    expect(screen.getByText("91 %")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /wiederholen/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /CME-Punkte geltend machen/ }));
    expect(onClaimPoints).toHaveBeenCalledTimes(1);
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
    expect(screen.getByRole("button", { name: /Abschlussprüfung starten/ })).toBeTruthy();
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
