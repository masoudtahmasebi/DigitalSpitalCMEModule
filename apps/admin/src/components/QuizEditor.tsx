/**
 * Authoring a Lernerfolgskontrolle (P9-05). **Human review gate** — CLAUDE.md §2.
 *
 * This is the only screen in the console that displays which answer is correct,
 * and the only one whose output decides whether a physician passes. Two rules
 * are worth stating because they are the ones a form can get wrong quietly:
 *
 * 1. **A question with no correct option cannot be passed by anybody.** Not by
 *    a careless learner — by anybody, ever, including a physician who knows the
 *    material. Saving one would silently cap every future attempt below the
 *    accredited 70 %.
 * 2. **A `single` question with two correct options is the same defect.**
 *    Scoring is exact-set: the submitted set must equal the correct set, so a
 *    single-choice question with two correct answers is unpassable because a
 *    learner can only pick one.
 *
 * The server refuses both. This screen refuses them *first*, per question, with
 * the field marked — not because the client is trusted, but because an author
 * who has written eleven questions should be told which one is wrong before
 * they submit, rather than receiving one sentence about the whole document.
 *
 * ## Editing is a diff, and the screen has to make that visible
 *
 * `PUT` sends the whole document; anything the server holds and the document
 * does not name is deleted. A question a learner has already answered cannot
 * be deleted, so `answerCount` is rendered next to it and the delete control is
 * replaced by the reason. Reordering and rewording stay available — an
 * already-scored attempt keeps the answers it was scored against.
 */

import { useCallback, useState } from "react";
import type { ApiClient, AuthoringQuiz, QuizWrite } from "@ds/sdk";
import { questionProblems, type QuestionProblem } from "@ds/domain";
import { de } from "../locale/de.js";
import { freshKey, swap } from "../drafts.js";
import { useLoaded, useSaver } from "../hooks.js";
import {
  Button,
  ConfirmButton,
  Field,
  IconButton,
  LoadFailure,
  Notice,
  Panel,
  SaveProblem,
  Select,
  Spinner,
  TextArea,
  TextInput,
} from "./ui.js";

type QuestionKind = "single" | "multi";

const KINDS: ReadonlyArray<readonly [QuestionKind, string]> = [
  ["single", de.quiz.kinds.single],
  ["multi", de.quiz.kinds.multi],
];

/**
 * A question being edited.
 *
 * `id` absent means new. `answerCount` is the server's, and is never edited —
 * it travels through so the row can explain why it cannot be deleted. `key` is
 * a stable React identity for a question that has no id yet.
 */
interface DraftQuestion {
  readonly key: string;
  readonly id?: string;
  prompt: string;
  kind: QuestionKind;
  readonly answerCount: number;
  options: DraftOption[];
}

interface DraftOption {
  readonly key: string;
  readonly id?: string;
  label: string;
  isCorrect: boolean;
}

export function QuizEditor(props: {
  client: ApiClient;
  contentId: string;
  contentTitle: string;
  onBack: () => void;
}) {
  const { client, contentId } = props;

  const load = useCallback(() => client.adminGetQuiz(contentId), [client, contentId]);
  const [quiz, setQuiz, loadProblem, retry] = useLoaded(load);
  const [draft, setDraft] = useState<DraftQuestion[] | undefined>();
  const [showProblems, setShowProblems] = useState(false);
  const saver = useSaver();

  // The draft is seeded from the server's document the first time it arrives,
  // and from then on it is the thing being edited. Re-seeding on every render
  // would discard everything typed since.
  const questions = draft ?? (quiz === undefined ? undefined : toDraft(quiz));

  if (loadProblem !== undefined) {
    return (
      <LoadFailure
        title={de.error.title}
        retryLabel={de.error.retry}
        problem={loadProblem}
        onRetry={retry}
      />
    );
  }

  if (questions === undefined) return <Spinner label={de.loading} />;

  const problems = questions.map(describeProblems);
  const anyProblem = problems.some((list) => list.length > 0);

  const update = (index: number, change: (question: DraftQuestion) => DraftQuestion) => {
    setDraft(questions.map((q, i) => (i === index ? change(q) : q)));
  };

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="secondary" onClick={props.onBack}>
          {de.nav.back}
        </Button>
        <h3 className="text-base font-semibold text-gray-900">
          {de.quiz.title} — {props.contentTitle}
        </h3>
      </div>

      <p className="max-w-3xl text-sm text-gray-600">{de.quiz.intro}</p>

      <SaveProblem title={de.error.title} problem={saver.problem} />
      {saver.state === "saved" && draft === undefined ? (
        <Notice tone="success">{de.common.saved}</Notice>
      ) : null}
      {showProblems && anyProblem ? (
        <Notice tone="error" title={de.error.title}>
          {de.quiz.fixBeforeSaving}
        </Notice>
      ) : null}

      {questions.length === 0 ? (
        <p className="text-sm text-gray-600">{de.quiz.empty}</p>
      ) : (
        <ol className="space-y-4">
          {questions.map((question, index) => (
            <li key={question.key}>
              <QuestionBlock
                question={question}
                index={index}
                total={questions.length}
                problems={showProblems ? (problems[index] ?? []) : []}
                onChange={(next) => update(index, () => next)}
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
          {de.quiz.addQuestion}
        </Button>
        <Button
          disabled={saver.state === "saving"}
          onClick={() => {
            setShowProblems(true);
            if (anyProblem) return;
            void saver
              .run(async () => {
                const stored = await client.adminSetQuiz(contentId, toWrite(questions));
                setQuiz(stored);
                // Adopt the server's document, ids and all: the next save has
                // to diff against what was actually stored, not against a
                // draft whose new questions still have no id.
                setDraft(undefined);
                setShowProblems(false);
              })
              .then(() => undefined);
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
  problems: readonly string[];
  onChange: (next: DraftQuestion) => void;
  onMove: (to: number) => void;
  onDelete: () => void;
}) {
  const { question, index } = props;
  const id = (field: string) => `question-${question.key}-${field}`;

  const setOption = (optionIndex: number, change: Partial<DraftOption>) => {
    props.onChange({
      ...question,
      options: question.options.map((option, i) =>
        i === optionIndex ? { ...option, ...change } : option,
      ),
    });
  };

  return (
    <Panel
      title={`${index + 1}.`}
      actions={
        <>
          {question.answerCount > 0 ? (
            <span className="text-xs text-gray-500">
              {de.quiz.answered(question.answerCount)}
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
              question.answerCount > 0 ? de.quiz.lockedByAnswers : undefined
            }
            onConfirm={props.onDelete}
          />
        </>
      }
    >
      <div className="space-y-3">
        <Field label={de.quiz.prompt} htmlFor={id("prompt")}>
          <TextArea
            id={id("prompt")}
            value={question.prompt}
            rows={2}
            maxLength={2000}
            onChange={(prompt) => props.onChange({ ...question, prompt })}
          />
        </Field>

        <Field label={de.quiz.kind} htmlFor={id("kind")}>
          <Select
            id={id("kind")}
            value={question.kind}
            options={KINDS}
            onChange={(kind) => props.onChange({ ...question, kind })}
          />
        </Field>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-gray-900">{de.quiz.option}</legend>
          {question.options.map((option, optionIndex) => (
            <div key={option.key} className="flex items-center gap-2">
              <input
                id={id(`correct-${option.key}`)}
                type="checkbox"
                checked={option.isCorrect}
                onChange={(event) =>
                  setOption(optionIndex, { isCorrect: event.target.checked })
                }
                className="h-4 w-4"
              />
              <label
                htmlFor={id(`correct-${option.key}`)}
                className="w-16 shrink-0 text-xs text-gray-600"
              >
                {de.quiz.isCorrect}
              </label>
              <TextInput
                id={id(`label-${option.key}`)}
                value={option.label}
                maxLength={1000}
                onChange={(label) => setOption(optionIndex, { label })}
              />
              <IconButton
                label={de.common.delete}
                glyph="×"
                disabled={question.options.length <= 2}
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
            disabled={question.options.length >= 10}
            onClick={() =>
              props.onChange({ ...question, options: [...question.options, newOption()] })
            }
          >
            {de.quiz.addOption}
          </Button>
        </fieldset>

        {props.problems.map((problem) => (
          <p key={problem} className="text-xs font-medium text-red-700">
            {problem}
          </p>
        ))}
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Draft ↔ wire
// ---------------------------------------------------------------------------

function toDraft(quiz: AuthoringQuiz): DraftQuestion[] {
  return quiz.questions.map((question) => ({
    key: question.id,
    id: question.id,
    prompt: question.prompt,
    kind: question.kind,
    answerCount: question.answerCount,
    options: question.options.map((option) => ({
      key: option.id,
      id: option.id,
      label: option.label,
      isCorrect: option.isCorrect,
    })),
  }));
}

function toWrite(questions: readonly DraftQuestion[]): QuizWrite {
  return {
    questions: questions.map((question) => ({
      ...(question.id === undefined ? {} : { id: question.id }),
      prompt: question.prompt.trim(),
      kind: question.kind,
      options: question.options.map((option) => ({
        ...(option.id === undefined ? {} : { id: option.id }),
        label: option.label.trim(),
        isCorrect: option.isCorrect,
      })),
    })),
  };
}

/**
 * German sentences for whatever `@ds/domain` says is wrong with a question.
 *
 * The rule is not restated here — `questionProblems` is the same function the
 * API refuses on, so the form cannot mark a question the server would accept or
 * accept one the server would refuse. All this map adds is the words.
 */
const PROBLEM_COPY: Readonly<Record<QuestionProblem, string>> = {
  empty_prompt: de.quiz.emptyPrompt,
  too_few_options: de.quiz.tooFewOptions,
  empty_option: de.quiz.emptyOption,
  no_correct_option: de.quiz.noCorrect,
  too_many_correct_options: de.quiz.tooManyCorrect,
};

function describeProblems(question: DraftQuestion): readonly string[] {
  return questionProblems(question).map((problem) => PROBLEM_COPY[problem]);
}

function newQuestion(): DraftQuestion {
  return {
    key: freshKey(),
    prompt: "",
    kind: "single",
    answerCount: 0,
    options: [newOption(), newOption()],
  };
}

function newOption(): DraftOption {
  return { key: freshKey(), label: "", isCorrect: false };
}
