/**
 * The Lernerfolgskontrolle — layout pages 08 to 12 (#61).
 *
 * ## What this screen cannot do
 *
 * It cannot mark an answer right or wrong, because the data to do so never
 * arrives: `QuizQuestion` has no correctness field, by construction (P4-01).
 * The learner picks options, the server scores, and the result comes back as a
 * percentage and a verdict. That is why the answer key cannot leak through the
 * widget — not because the widget is careful, but because it never holds one.
 *
 * `perQuestion` exists in the contract for courses that set
 * `revealCorrectAnswers`. A CME-certified course does not, so this screen says
 * so plainly rather than leaving the learner wondering which one they got wrong.
 *
 * ## Four phases, one submission
 *
 * The layout draws an intro (08), one question at a time (09–10), and two
 * results (11, 12). It used to be a single scrolling list of every question with
 * one **Antworten absenden** at the bottom.
 *
 * One question at a time changes nothing about *when* the answers are sent: the
 * whole set still leaves in one `POST`, at the end. That matters and is worth
 * stating, because the obvious implementation of a paged quiz is to submit each
 * page — which would put a partially-scored attempt in the database, give a
 * learner a way to abandon between questions and leave one there, and make
 * "unanswered counts as wrong" (`scoreQuiz`) mean something different from what
 * it means today.
 *
 * ## Why a learner may go back but not skip
 *
 * **Zurück** returns to a question already answered; **Weiter** is disabled
 * until the current one has an answer. That is the layout's own arrangement and
 * it also keeps the submission dense: `scoreQuiz` treats an unanswered question
 * as wrong, so a learner who could skip forwards would be silently lowering
 * their own score.
 */

import { useEffect, useRef, useState } from "react";
import { minimumCorrectAnswers } from "@ds/domain";
import type { ApiClient, Quiz, QuizAttemptResult } from "@ds/sdk";
import { de } from "../locale/de.js";
import { Button, ErrorNotice } from "./primitives.js";

type Phase =
  | { kind: "intro" }
  | { kind: "question"; index: number }
  | { kind: "result"; attempt: QuizAttemptResult };

export function QuizScreen(props: {
  client: ApiClient;
  courseSlug: string;
  quiz: Quiz;
  onPassed: () => void;
  onBack: () => void;
  /**
   * The passed screen's **CME-Punkte geltend machen** (layout 12.3), or
   * `undefined` when the course is not finished yet (P82-01).
   *
   * The parent decides where that leads — the evaluation if it is still
   * outstanding, otherwise the Punktemeldung. This screen knows the learner
   * asked; it does not know what else the course still wants, and `App` reads
   * that from `EnrolmentState`, which is the server's.
   *
   * **`undefined` is the case that was missing.** The button used to be drawn
   * on every passed quiz, and a course can hold more than one — so passing a
   * quiz two modules in led to the EFN form and a 409 naming the modules still
   * unwatched. The parent now passes a callback only when `courseComplete`
   * says the API would accept it (CLAUDE.md §9.2).
   */
  onClaimPoints: (() => void) | undefined;
  /**
   * The next section the server has open, when the course is not finished.
   *
   * Without it the passed screen has nothing to offer but "back to the
   * overview", which is how a learner ends up hunting for their place in a
   * five-module course by hand.
   */
  onNext: { readonly title: string; readonly open: () => void } | undefined;
}) {
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [phase, setPhase] = useState<Phase>({ kind: "intro" });
  const [submitting, setSubmitting] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();

  const { client, courseSlug, quiz } = props;

  function toggle(question: Quiz["questions"][number], optionId: string): void {
    setSelected((previous) => {
      const current = previous[question.id] ?? [];
      if (question.kind === "single") return { ...previous, [question.id]: [optionId] };
      return {
        ...previous,
        [question.id]: current.includes(optionId)
          ? current.filter((id) => id !== optionId)
          : [...current, optionId],
      };
    });
  }

  async function submit(): Promise<void> {
    setSubmitting(true);
    setProblem(undefined);
    try {
      const attempt = await client.submitQuiz(courseSlug, quiz.contentId, {
        answers: quiz.questions.map((question) => ({
          questionId: question.id,
          selectedOptionIds: selected[question.id] ?? [],
        })),
      });
      setPhase({ kind: "result", attempt });
      // The parent reloads the enrolment state either way: a pass changes what
      // is unlocked, and only the server knows that.
      if (attempt.passed) props.onPassed();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : de.error.generic);
    } finally {
      setSubmitting(false);
    }
  }

  if (phase.kind === "intro") {
    return (
      <QuizIntro
        quiz={quiz}
        onStart={() => setPhase({ kind: "question", index: 0 })}
        onBack={props.onBack}
      />
    );
  }

  if (phase.kind === "result") {
    return (
      <QuizResult
        attempt={phase.attempt}
        onRetry={() => {
          setSelected({});
          setPhase({ kind: "intro" });
        }}
        onBack={props.onBack}
        onClaimPoints={props.onClaimPoints}
        onNext={props.onNext}
      />
    );
  }

  const question = quiz.questions[phase.index];
  if (question === undefined) {
    // Only reachable if the quiz arrived empty, which the authoring rules
    // refuse. Sending the learner back beats rendering a blank card.
    return (
      <ErrorNotice
        title={de.error.title}
        message={de.error.generic}
        retryLabel={de.content.back}
        onRetry={props.onBack}
      />
    );
  }

  const answered = (selected[question.id] ?? []).length > 0;
  const last = phase.index === quiz.questions.length - 1;

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-baseline justify-between gap-4">
          <p className="text-sm font-semibold text-brand-700">{de.quiz.exam}</p>
          <p className="text-sm text-gray-500">
            {de.quiz.questionOf(phase.index + 1, quiz.questions.length)}
          </p>
        </div>

        <div
          className="mt-2 h-2 w-full overflow-hidden rounded-full bg-gray-200"
          role="progressbar"
          aria-valuenow={phase.index + 1}
          aria-valuemin={1}
          aria-valuemax={quiz.questions.length}
          aria-label={de.quiz.questionOf(phase.index + 1, quiz.questions.length)}
        >
          <div
            className="h-full rounded-full bg-brand-600"
            style={{
              width: `${String(((phase.index + 1) / quiz.questions.length) * 100)}%`,
            }}
          />
        </div>
      </div>

      <fieldset>
        <legend className="w-full">
          <span className="block text-sm font-semibold text-brand-700">
            {de.quiz.questionLabel(phase.index + 1)}
          </span>
          <span className="mt-1 block text-lg font-bold leading-snug text-gray-900">
            {question.prompt}
          </span>
        </legend>

        <p className="mt-1 text-xs text-gray-500">
          {question.kind === "single" ? de.quiz.singleHint : de.quiz.multiHint}
        </p>

        <OptionList
          // Remounted per question, so the scroll box starts at the top and its
          // overflow is measured against the options actually in it.
          key={question.id}
          question={question}
          selected={selected[question.id] ?? []}
          onToggle={(optionId) => toggle(question, optionId)}
        />
      </fieldset>

      {problem === undefined ? null : (
        <ErrorNotice title={de.error.title} message={problem} />
      )}

      {answered ? null : <p className="text-sm text-gray-500">{de.quiz.unanswered}</p>}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          variant="secondary"
          onClick={() => {
            // Back out of the first question to the intro rather than to the
            // course: the learner has answers in hand that leaving would drop.
            if (phase.index === 0) setPhase({ kind: "intro" });
            else setPhase({ kind: "question", index: phase.index - 1 });
          }}
        >
          <span aria-hidden="true">←</span>
          {de.quiz.previous}
        </Button>

        <Button
          variant="cta"
          disabled={!answered || submitting}
          onClick={() => {
            if (last) void submit();
            else setPhase({ kind: "question", index: phase.index + 1 });
          }}
        >
          {last ? (submitting ? de.quiz.submitting : de.quiz.submit) : de.quiz.next}
          <span aria-hidden="true">→</span>
        </Button>
      </div>
    </div>
  );
}

/**
 * Page 08 — what the learner is told before starting.
 *
 * The three stat cards are the accreditation conditions in the form a physician
 * can check at a glance, and every figure in them is the course's own.
 */
function QuizIntro(props: { quiz: Quiz; onStart: () => void; onBack: () => void }) {
  const { quiz } = props;
  const total = quiz.questions.length;
  const needed = minimumCorrectAnswers(total, quiz.passThresholdPercent);

  // Derived, not assumed. A course whose author wrote a multiple-choice question
  // and whose intro promised "Eine Antwort pro Frage" would be telling a
  // physician the wrong thing about how to pass.
  const allSingle = quiz.questions.every((question) => question.kind === "single");

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-semibold text-brand-700">{de.quiz.title}</p>
        <h2 className="text-2xl font-bold text-gray-900">{de.quiz.exam}</h2>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label={de.quiz.statQuestions}
          value={String(total)}
          caption={de.quiz.statQuestionsCaption}
        />
        <StatCard
          label={de.quiz.statFormat}
          value={allSingle ? de.quiz.formatSingle : de.quiz.formatMixed}
          caption={allSingle ? de.quiz.formatSingleCaption : de.quiz.formatMixedCaption}
        />
        <StatCard
          label={de.quiz.statPass}
          value={de.quiz.statPassValue(quiz.passThresholdPercent)}
          caption={needed === null ? "" : de.quiz.statPassCaption(needed, total)}
        />
      </div>

      <hr className="border-gray-200" />

      <div className="flex gap-4 rounded-xl border border-brand-500 bg-brand-50 p-4">
        <span
          aria-hidden="true"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-brand-contrast"
        >
          i
        </span>
        <p className="text-sm leading-relaxed text-gray-800">{de.quiz.banner}</p>
      </div>

      <p className="text-xs text-gray-500">
        {quiz.maxAttempts === null
          ? de.quiz.attemptsUnlimited
          : de.quiz.attemptsUsed(quiz.attemptsUsed)}
      </p>

      <div className="flex flex-wrap gap-3">
        <Button variant="cta" onClick={props.onStart}>
          {de.quiz.start}
        </Button>
        <Button variant="secondary" onClick={props.onBack}>
          {de.player.back}
        </Button>
      </div>
    </div>
  );
}

function StatCard(props: { label: string; value: string; caption: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-sm font-bold text-gray-900">{props.label}</p>
      <p className="mt-1 text-2xl font-bold text-brand-600">{props.value}</p>
      {props.caption === "" ? null : (
        <p className="mt-1 text-xs text-gray-500">{props.caption}</p>
      )}
    </div>
  );
}

/**
 * The options, and the layout's scroll affordance (row 9.3).
 *
 * A question with long options overflows the card, and the layout draws
 * "Weitere Antworten durch Scrollen sichtbar ⌄" under it so a learner does not
 * choose from the four they can see. The hint is **measured**, not guessed from
 * an option count: whether five options overflow depends on how long they are
 * and how wide the widget is, and a hint that appears when nothing is hidden is
 * the same class of lie as one that never appears.
 */
function OptionList(props: {
  question: Quiz["questions"][number];
  selected: readonly string[];
  onToggle: (optionId: string) => void;
}) {
  const box = useRef<HTMLDivElement | null>(null);
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    const element = box.current;
    if (element === null) return;

    const measure = () => {
      setOverflowing(element.scrollHeight > element.clientHeight + 1);
    };
    measure();

    // A widget in a WordPress column is resized by the theme, by the reader's
    // zoom and by rotating a phone. `ResizeObserver` exists everywhere the
    // supported browsers do; the guard is for jsdom, which does not have it.
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [props.question.id]);

  return (
    <div className="mt-4">
      <div ref={box} className="max-h-[26rem] space-y-3 overflow-y-auto">
        {props.question.options.map((option) => {
          const checked = props.selected.includes(option.id);
          return (
            <label
              key={option.id}
              className={`flex cursor-pointer items-start gap-3 rounded-full border px-5 py-3 text-sm leading-snug ${
                checked
                  ? "border-brand-600 bg-brand-50 text-gray-900"
                  : "border-gray-200 bg-white text-gray-800 hover:border-brand-500"
              }`}
            >
              <input
                type={props.question.kind === "single" ? "radio" : "checkbox"}
                name={props.question.id}
                checked={checked}
                onChange={() => props.onToggle(option.id)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600"
              />
              <span>{option.label}</span>
            </label>
          );
        })}
      </div>

      {overflowing ? (
        <p className="mt-2 text-center text-xs text-gray-500">
          {de.quiz.scrollHint} <span aria-hidden="true">⌄</span>
        </p>
      ) : null}
    </div>
  );
}

/** Pages 11 and 12 — the same card, two verdicts. */
function QuizResult(props: {
  attempt: QuizAttemptResult;
  onRetry: () => void;
  onBack: () => void;
  onClaimPoints: (() => void) | undefined;
  onNext: { readonly title: string; readonly open: () => void } | undefined;
}) {
  const { attempt } = props;
  const needed = minimumCorrectAnswers(attempt.totalCount, attempt.passThresholdPercent);

  return (
    <div className="space-y-6 text-center">
      <h2
        className={`text-2xl font-bold ${
          attempt.passed ? "text-brand-600" : "text-red-700"
        }`}
        role="status"
      >
        {attempt.passed ? de.quiz.passedTitle : de.quiz.failedTitle}
      </h2>

      {attempt.passed ? <Rosette /> : null}

      <div className="mx-auto max-w-md rounded-xl border border-gray-200 bg-white p-6">
        <p className="text-gray-900">
          <span className="text-4xl font-bold">{attempt.correctCount}</span>
          <span className="text-xl"> / {attempt.totalCount}</span>
        </p>
        <p className="mt-1 text-xs text-gray-500">{de.quiz.scoreCaption}</p>

        <div
          className="mt-4 h-2 w-full overflow-hidden rounded-full bg-gray-200"
          role="progressbar"
          aria-valuenow={attempt.scorePercent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={de.quiz.scoreCaption}
        >
          <div
            className={`h-full rounded-full ${
              attempt.passed ? "bg-brand-600" : "bg-red-600"
            }`}
            style={{ width: `${String(attempt.scorePercent)}%` }}
          />
        </div>
        <p className="mt-2 text-sm font-bold text-gray-900">{attempt.scorePercent} %</p>

        {needed === null ? null : (
          <p className="mt-2 text-sm text-gray-700">
            {de.quiz.scoreRequirement(needed, attempt.totalCount)}
          </p>
        )}
      </div>

      <p className="mx-auto max-w-xl text-sm font-semibold text-gray-800">
        {attempt.passed
          ? de.quiz.passedSentence(attempt.correctCount, attempt.totalCount)
          : de.quiz.failedSentence(
              attempt.correctCount,
              attempt.totalCount,
              needed ?? attempt.totalCount,
            )}
      </p>

      {attempt.perQuestion === undefined ? (
        <p className="text-xs text-gray-500">{de.quiz.noReveal}</p>
      ) : null}

      {attempt.passed ? (
        /*
         * Passed — and what follows depends on whether the *course* is
         * finished, not on whether this quiz is (P82-01).
         *
         * `onClaimPoints` is defined only when the API would accept a
         * completion. When it is not, offering it anyway is a control that can
         * only produce a 409, so the screen says where the learner actually
         * stands and points at the next section instead.
         */
        <div className="flex flex-wrap items-center justify-center gap-4">
          {props.onClaimPoints === undefined ? (
            <>
              <p className="w-full text-sm text-gray-700">{de.quiz.morePending}</p>
              {props.onNext === undefined ? null : (
                <Button variant="cta" onClick={props.onNext.open}>
                  {de.player.nextSection(props.onNext.title)}
                </Button>
              )}
              <Button variant="secondary" onClick={props.onBack}>
                {de.player.back}
              </Button>
            </>
          ) : (
            <Button variant="cta" onClick={props.onClaimPoints}>
              {de.quiz.claim}
              <span aria-hidden="true">→</span>
            </Button>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-start justify-center gap-4">
          <Button variant="cta" onClick={props.onRetry}>
            <span aria-hidden="true">⟳</span>
            {de.quiz.retry}
          </Button>
          <div className="text-center">
            <Button variant="secondary" onClick={props.onBack}>
              {de.quiz.pause}
            </Button>
            <p className="mt-1 text-xs text-brand-700">{de.quiz.pauseHint}</p>
          </div>
        </div>
      )}
    </div>
  );
}

/** The teal rosette above the passed heading (layout 12.1). Decorative. */
function Rosette() {
  return (
    <svg
      viewBox="0 0 32 32"
      aria-hidden="true"
      className="mx-auto h-9 w-9 text-brand-600"
      fill="currentColor"
    >
      <path d="M16 1.5 19 4l3.6-.7 1.4 3.4 3.4 1.4L26.7 12l2.5 3-2.5 3 .7 3.6-3.4 1.4-1.4 3.4L19 25.6 16 28.1l-3-2.5-3.6.7-1.4-3.4L4.6 21.5 5.3 18l-2.5-3 2.5-3-.7-3.6 3.4-1.4L9.4 3.3 13 4l3-2.5Z" />
      <path
        d="m14.6 19.2-3.3-3.3 1.5-1.5 1.8 1.8 4.6-4.6 1.5 1.5-6.1 6.1Z"
        className="text-brand-contrast"
        fill="#fff"
      />
    </svg>
  );
}
