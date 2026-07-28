/**
 * Authoring the Evaluationsbogen (P9-05).
 *
 * The Anerkennungsbescheid requires an evaluation, so a course with no
 * questions here is a course nobody can complete — the completion gate has a
 * condition it can never satisfy. That is why the empty state says so rather
 * than reading as a neutral "nothing yet".
 *
 * Same diffing rule as the quiz: `PUT` sends the whole document and anything
 * the server holds but this document does not name is deleted, except that a
 * question somebody has answered cannot be. `responseCount` travels with each
 * question so the row can say why in place of offering a delete that would 409.
 *
 * Free-text answers get their own note. They are the one place in the platform
 * where a learner types prose that may name a person or a condition, and
 * ADR-0004 keeps our personal-data footprint deliberately small — so the
 * screen says, where an author is deciding to add such a question, what
 * happens to what it collects.
 */

import { useCallback, useState } from "react";
import type { ApiClient, AuthoringEvaluation, EvaluationWrite } from "@ds/sdk";
import { de } from "../locale/de.js";
import { freshKey, swap } from "../drafts.js";
import { useLoaded, useSaver } from "../hooks.js";
import {
  Button,
  ConfirmButton,
  Field,
  IconButton,
  Notice,
  Panel,
  Select,
  Spinner,
  TextArea,
  TextInput,
} from "./ui.js";

type EvaluationKind = "scale" | "text" | "single";

const KINDS: ReadonlyArray<readonly [EvaluationKind, string]> = [
  ["scale", de.evaluation.kinds.scale],
  ["text", de.evaluation.kinds.text],
  ["single", de.evaluation.kinds.single],
];

interface DraftQuestion {
  readonly key: string;
  readonly id?: string;
  prompt: string;
  kind: EvaluationKind;
  required: boolean;
  options: string[];
  readonly responseCount: number;
}

export function EvaluationEditor(props: { client: ApiClient; courseSlug: string }) {
  const { client, courseSlug } = props;

  const load = useCallback(
    () => client.adminGetEvaluation(courseSlug),
    [client, courseSlug],
  );
  const [evaluation, setEvaluation, loadProblem, retry] = useLoaded(load);
  const [draft, setDraft] = useState<DraftQuestion[] | undefined>();
  const saver = useSaver();

  const questions = draft ?? (evaluation === undefined ? undefined : toDraft(evaluation));

  if (loadProblem !== undefined) {
    return (
      <div className="space-y-3">
        <Notice tone="error" title={de.error.title}>
          {loadProblem}
        </Notice>
        <Button variant="secondary" onClick={retry}>
          {de.error.retry}
        </Button>
      </div>
    );
  }

  if (questions === undefined) return <Spinner label={de.loading} />;

  const hasFreeText = questions.some((question) => question.kind === "text");
  const incomplete = questions.some((question) => question.prompt.trim() === "");

  return (
    <section className="space-y-4">
      <p className="max-w-3xl text-sm text-gray-600">{de.evaluation.intro}</p>

      {hasFreeText ? (
        <Notice tone="warning">{de.evaluation.freeTextPrivacy}</Notice>
      ) : null}

      {saver.problem === undefined ? null : (
        <Notice tone="error" title={de.error.title}>
          {saver.problem}
        </Notice>
      )}
      {saver.state === "saved" && draft === undefined ? (
        <Notice tone="success">{de.common.saved}</Notice>
      ) : null}

      {questions.length === 0 ? (
        <Notice tone="warning">{de.evaluation.intro}</Notice>
      ) : (
        <ol className="space-y-4">
          {questions.map((question, index) => (
            <li key={question.key}>
              <QuestionBlock
                question={question}
                index={index}
                total={questions.length}
                onChange={(next) =>
                  setDraft(questions.map((q, i) => (i === index ? next : q)))
                }
                onMove={(to) => setDraft(swap(questions, index, to))}
                onDelete={() => setDraft(questions.filter((_, i) => i !== index))}
              />
            </li>
          ))}
        </ol>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          onClick={() => setDraft([...questions, newQuestion()])}
        >
          {de.evaluation.addQuestion}
        </Button>
        <Button
          disabled={saver.state === "saving" || incomplete}
          onClick={() => {
            void saver.run(async () => {
              setEvaluation(
                await client.adminSetEvaluation(courseSlug, toWrite(questions)),
              );
              setDraft(undefined);
            });
          }}
        >
          {saver.state === "saving" ? de.common.saving : de.common.save}
        </Button>
      </div>
    </section>
  );
}

function QuestionBlock(props: {
  question: DraftQuestion;
  index: number;
  total: number;
  onChange: (next: DraftQuestion) => void;
  onMove: (to: number) => void;
  onDelete: () => void;
}) {
  const { question, index } = props;
  const id = (field: string) => `evaluation-${question.key}-${field}`;

  return (
    <Panel
      title={`${index + 1}.`}
      actions={
        <>
          {question.responseCount > 0 ? (
            <span className="text-xs text-gray-500">
              {de.evaluation.answered(question.responseCount)}
            </span>
          ) : null}
          <IconButton
            label={de.common.moveUp}
            glyph="↑"
            disabled={index === 0}
            onClick={() => props.onMove(index - 1)}
          />
          <IconButton
            label={de.common.moveDown}
            glyph="↓"
            disabled={index === props.total - 1}
            onClick={() => props.onMove(index + 1)}
          />
          <ConfirmButton
            label={de.common.delete}
            confirmLabel={de.common.confirmDelete}
            cancelLabel={de.common.cancel}
            disabledReason={
              question.responseCount > 0 ? de.evaluation.lockedByAnswers : undefined
            }
            onConfirm={props.onDelete}
          />
        </>
      }
    >
      <div className="space-y-3">
        <Field label={de.evaluation.prompt} htmlFor={id("prompt")}>
          <TextArea
            id={id("prompt")}
            value={question.prompt}
            rows={2}
            maxLength={2000}
            onChange={(prompt) => props.onChange({ ...question, prompt })}
          />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={de.evaluation.kind} htmlFor={id("kind")}>
            <Select
              id={id("kind")}
              value={question.kind}
              options={KINDS}
              onChange={(kind) => props.onChange({ ...question, kind })}
            />
          </Field>
          <div className="flex items-end gap-2 pb-2">
            <input
              id={id("required")}
              type="checkbox"
              checked={question.required}
              onChange={(event) =>
                props.onChange({ ...question, required: event.target.checked })
              }
              className="h-4 w-4"
            />
            <label htmlFor={id("required")} className="text-sm text-gray-800">
              {de.evaluation.required}
            </label>
          </div>
        </div>

        {question.kind === "single" ? (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-gray-900">
              {de.evaluation.options}
            </legend>
            <p className="text-xs text-gray-600">{de.evaluation.optionsHint}</p>
            {question.options.map((option, optionIndex) => (
              // Index-keyed deliberately: these are plain strings with no
              // identity of their own, and the row has no state to mix up —
              // one input whose value is the item itself.
              <div key={optionIndex} className="flex items-center gap-2">
                <TextInput
                  id={id(`option-${optionIndex}`)}
                  value={option}
                  maxLength={200}
                  onChange={(value) =>
                    props.onChange({
                      ...question,
                      options: question.options.map((existing, i) =>
                        i === optionIndex ? value : existing,
                      ),
                    })
                  }
                />
                <IconButton
                  label={de.common.delete}
                  glyph="×"
                  onClick={() =>
                    props.onChange({
                      ...question,
                      options: question.options.filter((_, i) => i !== optionIndex),
                    })
                  }
                />
              </div>
            ))}
            <Button
              variant="secondary"
              disabled={question.options.length >= 20}
              onClick={() =>
                props.onChange({ ...question, options: [...question.options, ""] })
              }
            >
              {de.evaluation.addOption}
            </Button>
          </fieldset>
        ) : null}
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------

function toDraft(evaluation: AuthoringEvaluation): DraftQuestion[] {
  return evaluation.questions.map((question) => ({
    key: question.id,
    id: question.id,
    prompt: question.prompt,
    kind: question.kind,
    required: question.required,
    options: [...question.options],
    responseCount: question.responseCount,
  }));
}

function toWrite(questions: readonly DraftQuestion[]): EvaluationWrite {
  return {
    questions: questions.map((question) => ({
      ...(question.id === undefined ? {} : { id: question.id }),
      prompt: question.prompt.trim(),
      kind: question.kind,
      required: question.required,
      // Options are meaningless for scale and text, and sending stale ones for
      // a question whose kind was just changed would store them.
      options:
        question.kind === "single"
          ? question.options.map((option) => option.trim()).filter((o) => o !== "")
          : [],
    })),
  };
}

function newQuestion(): DraftQuestion {
  return {
    key: freshKey(),
    prompt: "",
    kind: "scale",
    required: true,
    options: [],
    responseCount: 0,
  };
}
