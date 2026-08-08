/**
 * The Evaluation (P6).
 *
 * Submitted once — the server refuses a second submission, and this screen
 * reflects that rather than re-offering a form that would 409.
 *
 * Free-text answers are personal data (ADR-0004). Nothing here logs them, and
 * the failure path shows the API's own German message rather than echoing what
 * the learner typed back at them in an error string.
 */

import { useState } from "react";
import type { ApiClient, Evaluation, EvaluationSubmission } from "@ds/sdk";
import { de } from "../locale/de.js";
import { Button, ErrorNotice } from "./primitives.js";
import { describeError } from "../hooks.js";

type AnswerValue = string | number | string[];

export function EvaluationScreen(props: {
  client: ApiClient;
  courseSlug: string;
  evaluation: Evaluation;
  onSubmitted: () => void;
  onBack: () => void;
}) {
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});
  const [submitting, setSubmitting] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();

  const { client, courseSlug, evaluation } = props;

  if (evaluation.submitted) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">{de.evaluation.title}</h2>
        <p
          className="rounded-md bg-green-50 p-4 text-sm text-status-completed"
          role="status"
        >
          {de.evaluation.submitted}
        </p>
        <Button variant="secondary" onClick={props.onBack}>
          {de.content.back}
        </Button>
      </div>
    );
  }

  const missingRequired = evaluation.questions.some(
    (question) => question.required && isBlank(answers[question.id]),
  );

  async function submit(): Promise<void> {
    setSubmitting(true);
    setProblem(undefined);
    try {
      const submission: EvaluationSubmission = {
        answers: Object.entries(answers)
          .filter(([, value]) => !isBlank(value))
          .map(([evaluationId, answer]) => ({ evaluationId, answer })),
      };
      await client.submitEvaluation(courseSlug, submission);
      props.onSubmitted();
    } catch (error) {
      setProblem(
        describeError(error instanceof Error ? error : undefined, {
          unauthenticated: de.error.unauthenticated,
          generic: de.error.generic,
          noCourse: de.error.noCourse,
        }),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">{de.evaluation.title}</h2>
        <p className="mt-1 text-sm text-gray-600">{de.evaluation.intro}</p>
      </div>

      <ol className="space-y-5">
        {evaluation.questions.map((question) => (
          <li key={question.id}>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-gray-900">
                {question.prompt}
                {question.required ? (
                  <span aria-label={de.evaluation.required} className="text-red-600">
                    {" "}
                    *
                  </span>
                ) : null}
              </legend>

              {question.kind === "scale" ? (
                <ScaleInput
                  question={question}
                  value={answers[question.id]}
                  onChange={(value) =>
                    setAnswers((previous) => ({ ...previous, [question.id]: value }))
                  }
                />
              ) : question.kind === "text" ? (
                <textarea
                  rows={3}
                  maxLength={2000}
                  placeholder={de.evaluation.textPlaceholder}
                  className="w-full rounded-md border border-gray-300 p-2 text-sm"
                  onChange={(event) =>
                    setAnswers((previous) => ({
                      ...previous,
                      [question.id]: event.target.value,
                    }))
                  }
                />
              ) : (
                <ChoiceInput
                  question={question}
                  value={answers[question.id]}
                  onChange={(value) =>
                    setAnswers((previous) => ({ ...previous, [question.id]: value }))
                  }
                />
              )}
            </fieldset>
          </li>
        ))}
      </ol>

      {problem === undefined ? null : (
        <ErrorNotice title={de.error.title} message={problem} />
      )}

      {missingRequired ? (
        <p className="text-sm text-gray-500">{de.evaluation.missing}</p>
      ) : null}

      <div className="flex gap-2">
        <Button disabled={missingRequired || submitting} onClick={() => void submit()}>
          {submitting ? de.evaluation.submitting : de.evaluation.submit}
        </Button>
        <Button variant="secondary" onClick={props.onBack}>
          {de.content.back}
        </Button>
      </div>
    </div>
  );
}

function ScaleInput(props: {
  question: Evaluation["questions"][number];
  value: AnswerValue | undefined;
  onChange: (value: AnswerValue) => void;
}) {
  const options =
    props.question.options.length > 0
      ? props.question.options
      : ["1", "2", "3", "4", "5"];

  return (
    /*
     * The anchors sit beside the scale where there is room and **above and
     * below it** where there is not (P19-03).
     *
     * On one row at 320 px this pushed the page 19 px wider than the viewport:
     * "trifft nicht zu" and "trifft voll zu" are three lines each at that
     * width, and five 36 px circles plus two of those columns do not fit.
     * A horizontal scrollbar on a form a physician has to complete to earn
     * their points is not a cosmetic fault — it hides the buttons.
     *
     * `flex-col` rather than wrapping, because a wrapped row puts "trifft voll
     * zu" under the *left* end of the scale, where it reads as a label for the
     * 1.
     */
    <div className="flex items-center gap-3 max-sm:flex-col max-sm:items-start max-sm:gap-1">
      <span className="text-xs text-gray-500">{de.evaluation.scaleLow}</span>
      <div className="flex flex-wrap gap-1">
        {options.map((option) => (
          <label key={option} className="cursor-pointer">
            <input
              type="radio"
              name={props.question.id}
              className="sr-only"
              checked={props.value === option}
              onChange={() => props.onChange(option)}
            />
            <span
              className={`inline-flex h-9 w-9 items-center justify-center rounded-full border text-sm ${
                props.value === option
                  ? "border-brand-600 bg-brand-600 text-white"
                  : "border-gray-300 text-gray-700"
              }`}
            >
              {option}
            </span>
          </label>
        ))}
      </div>
      <span className="text-xs text-gray-500">{de.evaluation.scaleHigh}</span>
    </div>
  );
}

function ChoiceInput(props: {
  question: Evaluation["questions"][number];
  value: AnswerValue | undefined;
  onChange: (value: AnswerValue) => void;
}) {
  const multi = props.question.kind === "multi";
  const chosen = Array.isArray(props.value)
    ? props.value
    : typeof props.value === "string"
      ? [props.value]
      : [];

  return (
    <div className="space-y-1">
      {props.question.options.map((option) => (
        <label
          key={option}
          className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-brand-50"
        >
          <input
            type={multi ? "checkbox" : "radio"}
            name={props.question.id}
            checked={chosen.includes(option)}
            onChange={() =>
              props.onChange(
                multi
                  ? chosen.includes(option)
                    ? chosen.filter((entry) => entry !== option)
                    : [...chosen, option]
                  : option,
              )
            }
          />
          <span>{option}</span>
        </label>
      ))}
    </div>
  );
}

function isBlank(value: AnswerValue | undefined): boolean {
  if (value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}
