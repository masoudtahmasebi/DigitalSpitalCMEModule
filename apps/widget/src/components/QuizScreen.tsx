/**
 * The Lernerfolgskontrolle (P4-04).
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
 * so plainly rather than leaving the learner wondering why they cannot see
 * which one they got wrong.
 */

import { useState } from "react";
import type { ApiClient, Quiz, QuizAttemptResult } from "@ds/sdk";
import { de } from "../locale/de.js";
import { Button, ErrorNotice } from "./primitives.js";

export function QuizScreen(props: {
  client: ApiClient;
  courseSlug: string;
  quiz: Quiz;
  onPassed: () => void;
  onBack: () => void;
}) {
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [result, setResult] = useState<QuizAttemptResult | undefined>();
  const [submitting, setSubmitting] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();

  const { client, courseSlug, quiz } = props;

  const answered = quiz.questions.every(
    (question) => (selected[question.id] ?? []).length > 0,
  );

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
      setResult(attempt);
      // The parent reloads the enrolment state either way: a pass changes what
      // is unlocked, and only the server knows that.
      if (attempt.passed) props.onPassed();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : de.error.generic);
    } finally {
      setSubmitting(false);
    }
  }

  if (result !== undefined) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">{de.quiz.title}</h2>
        <div
          className={`rounded-md p-4 text-sm ${
            result.passed
              ? "bg-green-50 text-status-completed"
              : "bg-amber-50 text-status-inProgress"
          }`}
          role="status"
        >
          {result.passed
            ? de.quiz.passed(result.scorePercent)
            : de.quiz.failed(result.scorePercent, result.passThresholdPercent)}
        </div>

        {result.perQuestion === undefined ? (
          <p className="text-xs text-gray-500">{de.quiz.noReveal}</p>
        ) : null}

        <div className="flex gap-2">
          {result.passed ? null : (
            <Button
              onClick={() => {
                setResult(undefined);
                setSelected({});
              }}
            >
              {de.quiz.retry}
            </Button>
          )}
          <Button variant="secondary" onClick={props.onBack}>
            {de.content.back}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">{de.quiz.title}</h2>
        <p className="mt-1 text-sm text-gray-600">
          {de.quiz.intro(quiz.passThresholdPercent)}
        </p>
        <p className="mt-1 text-xs text-gray-500">
          {quiz.maxAttempts === null
            ? de.quiz.attemptsUnlimited
            : de.quiz.attemptsUsed(quiz.attemptsUsed)}
        </p>
      </div>

      <ol className="space-y-5">
        {quiz.questions.map((question, index) => (
          <li key={question.id}>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-gray-900">
                {index + 1}. {question.prompt}
              </legend>
              <p className="text-xs text-gray-500">
                {question.kind === "single" ? de.quiz.singleHint : de.quiz.multiHint}
              </p>

              {question.options.map((option) => {
                const checked = (selected[question.id] ?? []).includes(option.id);
                return (
                  <label
                    key={option.id}
                    className="flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 text-sm hover:bg-brand-50"
                  >
                    <input
                      type={question.kind === "single" ? "radio" : "checkbox"}
                      name={question.id}
                      checked={checked}
                      onChange={() => toggle(question, option.id)}
                      className="mt-0.5"
                    />
                    <span>{option.label}</span>
                  </label>
                );
              })}
            </fieldset>
          </li>
        ))}
      </ol>

      {problem === undefined ? null : (
        <ErrorNotice title={de.error.title} message={problem} />
      )}

      {answered ? null : <p className="text-sm text-gray-500">{de.quiz.unanswered}</p>}

      <div className="flex gap-2">
        <Button disabled={!answered || submitting} onClick={() => void submit()}>
          {submitting ? de.quiz.submitting : de.quiz.submit}
        </Button>
        <Button variant="secondary" onClick={props.onBack}>
          {de.content.back}
        </Button>
      </div>
    </div>
  );
}
