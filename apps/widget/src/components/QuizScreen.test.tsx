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
    /** The enrolment is certified (P169-01). Defaults to false, as it was. */
    certified: boolean;
    /** Every module behind the learner (P190-03). Defaults to true. */
    allModulesDone: boolean;
    /** The certificate already exists — `completedAt !== null` (P195-03). */
    onDownloadCertificate: () => void;
    certificateDownloading: boolean;
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
      certified={handlers.certified ?? false}
      onPassed={() => undefined}
      onBack={handlers.onBack ?? (() => undefined)}
      onClaimPoints={claim}
      onNext={handlers.onNext}
      onDownloadCertificate={handlers.onDownloadCertificate}
      certificateDownloading={handlers.certificateDownloading}
      allModulesDone={handlers.allModulesDone ?? true}
    />,
  );
  return { submitQuiz };
}

/** Start, then answer every question with its first option. */
async function answerEverything(): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: "Prüfung starten" }));

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
    expect(
      screen.getByText("Mind. 8 von 11 Fragen müssen richtig beantwortet sein"),
    ).toBeTruthy();
    // The answer format lost its own card to the 01.09.2026 layout, which draws
    // two; the sentence it carried moved under the question count, because a
    // physician about to sit a mixed exam still has to know it.
    expect(screen.getByText("Eine Antwort pro Frage")).toBeTruthy();
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

  it("says the sitting is over rather than inviting another (P170-01)", () => {
    /*
     * This case used to assert the opposite — "gewertet wird immer Ihr bestes
     * Ergebnis, ein weiterer Versuch kann Ihr Bestehen also nicht aufheben" —
     * which was a true and useful sentence while a repeat was offered. The
     * client closed the repeat, so the sentence became an invitation to hunt
     * for a control that is not there.
     */
    renderQuiz(attempt({}), { passedScorePercent: 81 });

    expect(screen.getByText(/nicht erneut abgelegt werden/u)).toBeTruthy();
    expect(screen.queryByText(/bestes Ergebnis/u)).toBeNull();
  });

  it("offers no sitting at all, because the API refuses one (P170-01)", () => {
    renderQuiz(attempt({}), { passedScorePercent: 81 });

    expect(screen.queryByRole("button", { name: de.quiz.start })).toBeNull();
  });

  it("is the ordinary start screen on a first sitting", () => {
    // The guard: this must not turn every intro into a congratulation.
    renderQuiz(attempt({}));

    expect(screen.queryByText(/bereits mit/u)).toBeNull();
    expect(screen.getByRole("button", { name: de.quiz.start })).toBeTruthy();
  });
});

/*
 * P169-01. Passed **and** certified is a third state, not a louder second one.
 *
 * The client: *"we shouldn't let the user fill the exam again, when he has
 * cleared the exam already and certificate is issued."* `submit` refuses such
 * an attempt now, so a repeat button here could only produce an error — which
 * is §9.2, and the reason the sentence beside it has to explain the absence
 * (§9.4).
 */
/*
 * P170-02. A passed exam is not a dead end.
 *
 * The client, in the same breath as closing the retake: *"although the user is
 * not able to do the exam, if they match the criteria to do the point
 * declaration, they can see the button of `CME-Punkte geltend machen`. For the
 * users who have done the lernerfolgskontrolle, we can show either the next
 * steps or if done button of CME-Punkte geltend machen."*
 *
 * The passed **result** screen already did this. The **intro** — where a
 * learner lands when they return to an exam they finished last week — said what
 * had happened and offered nothing to do about it.
 */
describe("returning to a passed exam", () => {
  it("offers the Punktemeldung when the course is finished", () => {
    const claim = vi.fn();
    renderQuiz(attempt({}), { passedScorePercent: 81, onClaimPoints: claim });

    fireEvent.click(screen.getByRole("button", { name: /CME-Punkte geltend machen/u }));

    expect(claim).toHaveBeenCalledTimes(1);
  });

  it("offers the next section when it is not", () => {
    // `onClaimPoints: null` is this file's way of saying the course is *not*
    // complete — see the note on `handlers`.
    const open = vi.fn();
    renderQuiz(attempt({}), {
      passedScorePercent: 81,
      onClaimPoints: null,
      onNext: { title: "Modul 3", open },
    });

    fireEvent.click(screen.getByRole("button", { name: /Modul 3/u }));

    expect(open).toHaveBeenCalledTimes(1);
  });

  it("does not offer both at once", () => {
    // Two teal buttons proposing different directions is a screen asking the
    // learner to decide something the server has already decided.
    renderQuiz(attempt({}), {
      passedScorePercent: 81,
      onClaimPoints: () => undefined,
      onNext: { title: "Modul 3", open: () => undefined },
    });

    expect(screen.queryByRole("button", { name: /Modul 3/u })).toBeNull();
  });

  it("still shows the way back when there is nothing else to offer", () => {
    renderQuiz(attempt({}), { passedScorePercent: 81, onClaimPoints: null });

    expect(screen.getByRole("button", { name: de.player.back })).toBeTruthy();
  });

  it("offers neither on an exam nobody has passed", () => {
    // The guard: the intro of an unsat exam is a start button, not a shortcut
    // past it.
    renderQuiz(attempt({}), { onClaimPoints: () => undefined });

    expect(screen.getByRole("button", { name: de.quiz.start })).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /CME-Punkte geltend machen/u }),
    ).toBeNull();
  });
});

describe("an exam behind an issued certificate", () => {
  it("offers no sitting at all", () => {
    renderQuiz(attempt({}), { passedScorePercent: 81, certified: true });

    expect(screen.queryByRole("button", { name: de.quiz.start })).toBeNull();
  });

  it("says why, where the button was", () => {
    renderQuiz(attempt({}), { passedScorePercent: 81, certified: true });

    expect(screen.getByText(de.quiz.certifiedNoRetry)).toBeTruthy();
  });

  it("names the Bescheid rather than the score", () => {
    // The only thing certification still changes on this screen: which of two
    // true sentences a physician is shown.
    renderQuiz(attempt({}), { passedScorePercent: 81, certified: true });

    expect(screen.getByText(de.quiz.certifiedNoRetry)).toBeTruthy();
    expect(screen.queryByText(/bereits mit 81 %/u)).toBeNull();
  });

  it("keeps the way back out of the screen", () => {
    // An intro with no controls at all is a dead end, and this one is reachable
    // from the sidebar of a finished course.
    renderQuiz(attempt({}), { passedScorePercent: 81, certified: true });

    expect(screen.getByRole("button", { name: de.player.back })).toBeTruthy();
  });
});

describe("answering (pages 09–10)", () => {
  it("shows one question at a time", () => {
    renderQuiz(attempt({}));
    fireEvent.click(screen.getByRole("button", { name: "Prüfung starten" }));

    expect(screen.getByText("Frage Nummer 1?")).toBeTruthy();
    expect(screen.queryByText("Frage Nummer 2?")).toBeNull();
    expect(screen.getByText("Frage 1 von 11")).toBeTruthy();
  });

  it("refuses to move on until the question has an answer", () => {
    renderQuiz(attempt({}));
    fireEvent.click(screen.getByRole("button", { name: "Prüfung starten" }));

    const next = screen.getByRole("button", { name: /Weiter/ });
    expect(next.hasAttribute("disabled")).toBe(true);

    fireEvent.click(screen.getAllByRole("radio")[0] as HTMLElement);

    expect(screen.getByRole("button", { name: /Weiter/ }).hasAttribute("disabled")).toBe(
      false,
    );
  });

  it("lets the learner go back and keeps the answer they gave", () => {
    renderQuiz(attempt({}));
    fireEvent.click(screen.getByRole("button", { name: "Prüfung starten" }));
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

  /*
   * The third state (P195-03).
   *
   * `onClaimPoints === undefined` covers two opposite situations — the course
   * is not finished yet, and it was finished long ago — and this screen told
   * both of them the first one: "Für die CME-Punkte fehlen noch Abschnitte der
   * Fortbildung", to a physician holding a certificate for the whole thing.
   *
   * Two assertions, and the second is the one that matters: it is not enough
   * that the right sentence appears, the wrong one has to stop.
   */
  it("passed and already certified: the certificate, not a list of what is missing", async () => {
    const onDownloadCertificate = vi.fn();
    renderQuiz(attempt({ passed: true }), {
      onClaimPoints: null,
      onDownloadCertificate,
    });

    await answerEverything();

    expect(
      screen.getByText(
        "Diese Fortbildung ist abgeschlossen. Ihre Teilnahmebescheinigung steht zum Download bereit.",
      ),
    ).toBeTruthy();
    expect(
      screen.queryByText(/Für die CME-Punkte fehlen noch Abschnitte/u),
      "a finished physician was told sections of the course were still missing",
    ).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: /Teilnahmebescheinigung herunterladen/u }),
    );
    expect(onDownloadCertificate).toHaveBeenCalledTimes(1);
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
    expect(screen.getByRole("button", { name: "Prüfung starten" })).toBeTruthy();
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
