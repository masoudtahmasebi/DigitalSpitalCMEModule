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
  RowList,
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
  /**
   * Back to "Inhalte & Darstellung" (P74-06).
   *
   * Reported as *"when in here i added a question, i can not easily go back to
   * the inhalt darstellung"*. The way back existed — the breadcrumb at the top
   * of the page — and after writing eleven questions it is several screens
   * above where the author is working. An exit belongs where the work ends, not
   * only where it began.
   */
  onDone: () => void;
  /**
   * The course's content lock (P178-01).
   *
   * A locked exam is **read**, not edited: `PUT /admin/contents/{id}/quiz` is
   * refused by the API, so a form that accepted keystrokes and then answered
   * 409 on save would be the §9.2 mistake with a paragraph of typing thrown
   * away. The read-only view below is a different rendering rather than the
   * same one with `disabled` on every field, because a disabled form still
   * looks like a form somebody has permission to fix.
   */
  contentLocked: boolean;
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

  if (props.contentLocked) {
    return (
      <section className="space-y-4">
        <Notice tone="warning" title={de.structure.contentLockTitle}>
          <p>{de.quiz.lockedBody}</p>
          <p className="mt-2">{de.structure.contentLockWays}</p>
        </Notice>

        {questions.length === 0 ? (
          <p className="text-sm text-gray-600">{de.quiz.empty}</p>
        ) : (
          <RowList ordered>
            {questions.map((question) => (
              <li key={question.key}>
                <div className="rounded-xl border border-gray-200 bg-white p-4">
                  <p className="text-sm font-medium text-gray-900">{question.prompt}</p>
                  <p className="mt-1 text-xs text-gray-500">
                    {de.quiz.kinds[question.kind]}
                  </p>
                  <ul className="mt-2 space-y-1">
                    {question.options.map((option) => (
                      <li key={option.key} className="text-sm text-gray-700">
                        <span aria-hidden="true">{option.isCorrect ? "✓ " : "· "}</span>
                        {option.label}
                        {option.isCorrect ? (
                          <span className="sr-only"> {de.quiz.correctOption}</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              </li>
            ))}
          </RowList>
        )}

        <Button variant="secondary" onClick={props.onDone}>
          {de.quiz.backToStructure}
        </Button>
      </section>
    );
  }

  const problems = questions.map(describeProblems);
  const anyProblem = problems.some((list) => list.length > 0);

  const update = (index: number, change: (question: DraftQuestion) => DraftQuestion) => {
    setDraft(questions.map((q, i) => (i === index ? change(q) : q)));
  };

  return (
    <section className="space-y-4">
      {/* Heading and the way back come from `Page`'s title and trail (P30-02):
          the course editor knows a quiz is open and puts it in the path. */}
      <p className="max-w-3xl text-sm text-gray-600">{de.quiz.intro}</p>

      {/*
        Questions that used to be in this exam and no longer are (P114-01).

        Shown only when there are some. An exam that went from eleven questions
        to two otherwise reads as data loss to whoever opens it next — the rows
        are still there, and nothing on the screen said so. The questions
        themselves are deliberately not listed: they are not the
        Lernerfolgskontrolle any more, so every control on them would be one the
        server refuses.
      */}
      {quiz !== undefined && quiz.retiredCount > 0 ? (
        <Notice tone="info" title={de.quiz.retiredTitle}>
          {de.quiz.retiredNotice(quiz.retiredCount)}
        </Notice>
      ) : null}

      <SaveProblem title={de.error.title} problem={saver.problem} />
      {saver.state === "saved" && draft === undefined ? (
        <Notice tone="success">{de.common.saved}</Notice>
      ) : null}
      {showProblems && anyProblem ? (
        <Notice tone="error" title={de.error.title}>
          {de.quiz.fixBeforeSaving}
        </Notice>
      ) : null}

      {/*
        Two panes: the exam on the left, one question under the cursor on the
        right (P128-01).
        
        The screen was a single column of eleven identical cards, and the
        client's objection was about exactly that — finding question 7 meant
        scrolling and reading first fields. The rail is the fix and it is also
        where the *state* of the exam lives: which questions have a problem is
        visible without scrolling to them, which is what an author needs when
        the save is refused.
      */}
      <div className="grid gap-5 lg:grid-cols-[15rem_minmax(0,1fr)] lg:items-start">
        <QuestionRail
          questions={questions}
          problems={showProblems ? problems : questions.map(() => [])}
          onAdd={() => setDraft([...questions, newQuestion()])}
        />

        <div className="min-w-0 space-y-4">
          {questions.length === 0 ? (
            <p className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-600">
              {de.quiz.empty}
            </p>
          ) : (
            <RowList>
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
            </RowList>
          )}

          <Button
            variant="secondary"
            onClick={() => setDraft([...questions, newQuestion()])}
          >
            {de.quiz.addQuestion}
          </Button>
        </div>
      </div>

      {/*
        The action bar sticks to the bottom of the viewport.

        An author writing question eleven is a long way from a Save button at
        the end of the document, and the unsaved-changes note beside it is only
        useful where it can be seen. Both references put the commit controls in
        a bar that does not scroll away.
      */}
      <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center gap-2 border-t border-gray-200 bg-white/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
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
        {/*
          Named, not "Zurück" (P74-06). A button that says only "back" leaves
          the reader to work out where back is, which is the objection P30-02
          made about the control the breadcrumb replaced — and this screen is
          two levels down, so "back" has two plausible answers.

          It does not save. A control that both left and saved would be one
          click for two decisions, and the one that matters here decides what a
          physician is asked. The unsaved-changes note beside it is what makes
          leaving safe to offer.
        */}
        <Button variant="secondary" onClick={props.onDone}>
          {de.quiz.backToStructure}
        </Button>
        {draft === undefined ? null : (
          <p className="self-center text-xs font-medium text-amber-700" role="status">
            {de.quiz.unsavedChanges}
          </p>
        )}
      </div>
    </section>
  );
}

/**
 * The exam, as a list you can see all of at once (P128-01).
 *
 * Every reference the client sent puts this rail beside the editor, and the
 * reason is not decoration: an author is editing one question and reasoning
 * about eleven. The number, the first words of the prompt and the kind are what
 * tell them apart — a card headed "3." says nothing, which P100-02 already
 * found once for the card titles.
 *
 * The problem dot is the part that earns its place. When a save is refused
 * because question 7 has no correct option, the rail says *seven* without the
 * author scrolling to find out; before, the only signal was a sentence at the
 * top and red text far below the fold.
 *
 * A button rather than an anchor: this scrolls within a screen, it does not
 * navigate, and an `href` would put a second address on a screen that already
 * has one (§9.8 is about places you can *be*, and a question is not one).
 */
function QuestionRail(props: {
  questions: readonly DraftQuestion[];
  problems: ReadonlyArray<readonly string[]>;
  onAdd: () => void;
}) {
  return (
    <aside className="lg:sticky lg:top-4">
      <div className="flex items-center justify-between px-1 pb-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          {de.quiz.railHeading(props.questions.length)}
        </h2>
        {/*
          Its own name, not "Frage hinzufügen".

          The button at the foot of the canvas already carries that label, and
          two controls with one accessible name is a screen reader announcing
          the same thing twice and a `getByRole` that resolves to two elements —
          which is exactly how the journey drives this screen. The same mistake
          the customer-prompt made with a second combobox an hour ago; caught
          here by asking rather than by a red suite.
        */}
        <IconButton label={de.quiz.railAdd} glyph="+" onClick={props.onAdd} />
      </div>

      <ol className="space-y-1.5">
        {props.questions.map((question, index) => {
          const prompt = question.prompt.trim();
          const broken = (props.problems[index] ?? []).length > 0;
          return (
            <li key={question.key}>
              <button
                type="button"
                onClick={() => {
                  document
                    .getElementById(`question-${question.key}-card`)
                    ?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
                className={`flex w-full items-start gap-2 rounded-lg border px-2.5 py-2 text-left transition ${
                  broken
                    ? "border-red-300 bg-red-50"
                    : "border-gray-200 bg-white hover:border-brand-500"
                }`}
              >
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-gray-100 text-[11px] font-semibold text-gray-700">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium text-gray-900">
                    {prompt === "" ? de.quiz.unnamed : prompt}
                  </span>
                  <span className="block truncate text-[11px] text-gray-500">
                    {question.kind === "single"
                      ? de.quiz.kinds.single
                      : de.quiz.kinds.multi}
                  </span>
                </span>
                {broken ? (
                  <span
                    aria-label={de.quiz.railProblem}
                    className="mt-1 h-2 w-2 shrink-0 rounded-full bg-red-500"
                  />
                ) : null}
              </button>
            </li>
          );
        })}
      </ol>
    </aside>
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

  /*
   * The prompt is the row's title (P100-02).
   *
   * A card headed "3." says nothing about which question it is — an author
   * scrolling eleven of them was reading the first field of each to find the
   * one they wanted. `answered` moves to the meta line for the same reason:
   * it is a fact about the row, not a control.
   */
  const prompt = question.prompt.trim();

  return (
    <div
      id={`question-${question.key}-card`}
      className="scroll-mt-4 rounded-xl border border-gray-200 bg-white shadow-sm"
    >
      {/*
        The card header carries the identity and the controls, as both
        references draw it: what this question is, and what can be done to it.
        The kind sits in the body with its label, because it is an editable
        field rather than a badge — a pill that turns out to be a dropdown is
        the kind of thing that reads as decoration until somebody needs it.
      */}
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-4 py-3">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-brand-50 text-xs font-semibold text-brand-700">
          {index + 1}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-900">
          {prompt === "" ? de.quiz.unnamed : prompt}
        </span>
        {question.answerCount > 0 ? (
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600">
            {de.quiz.answered(question.answerCount)}
          </span>
        ) : null}
        <span className="flex items-center gap-1">
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
          {/*
            Removing an answered question is now possible, and does something
            different (P114-01): the server retires it rather than deleting it.
            Until then this control was disabled with "Kann nicht gelöscht
            werden", and one recorded answer made an exam permanently
            uneditable — reported as "I want to make it to only 2 questions and
            i can not."

            The confirm step is where the difference is stated, because that is
            the moment somebody decides. An answered question says it will
            leave the exam and keep its record; an unanswered one is an ordinary
            delete and says so.
          */}
          <ConfirmButton
            label={de.common.delete}
            confirmLabel={
              question.answerCount > 0 ? de.quiz.confirmRetire : de.common.confirmDelete
            }
            cancelLabel={de.common.cancel}
            ariaLabel={question.answerCount > 0 ? de.quiz.retireOnRemove : undefined}
            onConfirm={props.onDelete}
          />
        </span>
      </div>

      <div className="space-y-3 px-4 py-4">
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
            /*
              The correct answer is the thing this row is about, so it reads as
              a marked row rather than a checkbox with a label beside it — which
              is how both references draw it, and it is also the honest emphasis:
              this is the only screen in the console that says which answer is
              right.

              It stays a **checkbox**, not the radio the references use. A
              `multi` question has more than one correct answer, so a radio would
              be a control that cannot express what the model allows (§9.2) — and
              the journey checks the first checkbox to mark an answer correct.
            */
            <div
              key={option.key}
              className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 ${
                option.isCorrect
                  ? "border-emerald-300 bg-emerald-50"
                  : "border-transparent"
              }`}
            >
              <input
                id={id(`correct-${option.key}`)}
                type="checkbox"
                checked={option.isCorrect}
                onChange={(event) =>
                  setOption(optionIndex, { isCorrect: event.target.checked })
                }
                className="h-4 w-4 shrink-0 accent-emerald-600"
              />
              <label
                htmlFor={id(`correct-${option.key}`)}
                className="w-16 shrink-0 text-xs font-medium text-gray-600"
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
    </div>
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
