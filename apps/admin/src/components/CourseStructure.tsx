/**
 * The authoring tree: modules, chapters, content (P9-04).
 *
 * ## Why the reorder controls are buttons, not drag-and-drop
 *
 * A deliberate choice, not a shortcut. Drag-and-drop needs a pointer, and the
 * accessible fallback for it is a keyboard affordance that announces where an
 * item is and where it went — which is these buttons. Building both means
 * building the hard one anyway and then maintaining a second path that can
 * disagree with it. The responsive and a11y floor is costed in and not
 * reducible (CLAUDE.md §3), so the keyboard path is the path.
 *
 * Moving a chapter between modules is a `<select>` for the same reason: it is
 * the one move that cannot be expressed as "up" or "down", and a listbox is
 * both operable by keyboard and readable by a screen reader without any
 * live-region choreography.
 *
 * ## Every reorder sends the whole tree
 *
 * `PUT /admin/courses/{slug}/structure/order` takes the entire arrangement and
 * validates each level as a permutation before writing anything. So this screen
 * applies the move to its local copy, sends the result, and renders whatever
 * comes back. It never patches its own tree from a success — a create shifts
 * nothing but a reorder shifts everything, and a console that guessed would
 * eventually hold a shape the server does not.
 *
 * ## Deletion says why before the click
 *
 * `learnerRecords` comes back on every content item. A module whose descendants
 * hold learner records shows the refusal in place of the button rather than
 * offering a button that 409s — the server is still the gate, but an author
 * should not have to click to discover a rule.
 */

import { useCallback, useMemo, useState } from "react";
import type {
  ApiClient,
  AuthoringChapter,
  AuthoringContent,
  AuthoringModule,
  CourseStructure as Structure,
  ContentWrite,
  MediaSourceWrite,
} from "@ds/sdk";
import { MEDIA_MIME_TYPES } from "@ds/domain";
import { de } from "../locale/de.js";
import { nullable, swap } from "../drafts.js";
import {
  moveChapter,
  recordsUnderModule,
  toOrder,
  withChapters,
  withContents,
} from "../structure-order.js";
import { useLoaded, useSaver } from "../hooks.js";
import { probeableSourceUrl, probeDurationSec } from "../media-duration.js";
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

type ContentKind = AuthoringContent["kind"];

const CONTENT_KINDS: ReadonlyArray<readonly [ContentKind, string]> = [
  ["video", de.structure.kinds.video],
  ["text", de.structure.kinds.text],
  ["quiz", de.structure.kinds.quiz],
  ["details", de.structure.kinds.details],
  ["material", de.structure.kinds.material],
];

export function CourseStructureEditor(props: {
  client: ApiClient;
  courseSlug: string;
  onEditQuiz: (contentId: string, title: string) => void;
}) {
  const { client, courseSlug } = props;

  const load = useCallback(
    () => client.adminGetStructure(courseSlug),
    [client, courseSlug],
  );
  const [structure, setStructure, loadProblem, retry] = useLoaded(load);
  const saver = useSaver();

  const mutate = useCallback(
    (action: () => Promise<Structure>) => {
      void saver.run(async () => setStructure(await action()));
    },
    [saver, setStructure],
  );

  /** Apply a rearrangement to the local tree and send the whole thing. */
  const reorder = useCallback(
    (next: readonly AuthoringModule[]) => {
      mutate(() => client.adminReorderStructure(courseSlug, toOrder(next)));
    },
    [client, courseSlug, mutate],
  );

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

  if (structure === undefined) return <Spinner label={de.loading} />;

  const modules = structure.modules;

  return (
    <section className="space-y-4">
      <p className="max-w-3xl text-sm text-gray-600">{de.structure.intro}</p>

      <SaveProblem title={de.error.title} problem={saver.problem} />
      {saver.state === "saving" ? (
        <p className="text-xs text-gray-500" role="status">
          {de.structure.reordering}
        </p>
      ) : null}

      {modules.length === 0 ? (
        <p className="text-sm text-gray-600">{de.structure.empty}</p>
      ) : (
        <ol className="space-y-4">
          {modules.map((module, index) => (
            <li key={module.id}>
              <ModuleBlock
                client={client}
                module={module}
                modules={modules}
                index={index}
                onMutate={mutate}
                onReorder={reorder}
                onEditQuiz={props.onEditQuiz}
              />
            </li>
          ))}
        </ol>
      )}

      <AddForm
        label={de.structure.newModule}
        fields={[{ key: "title", label: de.common.title, maxLength: 300 }]}
        onSubmit={(values) =>
          client.adminCreateModule(courseSlug, { title: values.title ?? "" })
        }
        onDone={setStructure}
      />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

function ModuleBlock(props: {
  client: ApiClient;
  module: AuthoringModule;
  modules: readonly AuthoringModule[];
  index: number;
  onMutate: (action: () => Promise<Structure>) => void;
  onReorder: (next: readonly AuthoringModule[]) => void;
  onEditQuiz: (contentId: string, title: string) => void;
}) {
  const { client, module, modules, index } = props;
  const [editing, setEditing] = useState(false);

  const blockedBy = recordsUnderModule(module);

  return (
    <Panel
      title={
        <span>
          <span className="text-xs font-normal uppercase tracking-wide text-gray-500">
            {de.structure.module} {index + 1}
          </span>
          <br />
          {module.title}
          {module.subtitle === null ? null : (
            <span className="ml-2 text-sm font-normal text-gray-600">
              {module.subtitle}
            </span>
          )}
        </span>
      }
      actions={
        <>
          <IconButton
            label={de.common.moveUp}
            glyph="↑"
            disabled={index === 0}
            onClick={() => props.onReorder(swap(modules, index, index - 1))}
          />
          <IconButton
            label={de.common.moveDown}
            glyph="↓"
            disabled={index === modules.length - 1}
            onClick={() => props.onReorder(swap(modules, index, index + 1))}
          />
          <Button variant="secondary" onClick={() => setEditing(!editing)}>
            {editing ? de.common.cancel : de.common.edit}
          </Button>
          <ConfirmButton
            label={de.common.delete}
            confirmLabel={de.common.confirmDelete}
            cancelLabel={de.common.cancel}
            disabledReason={blockedBy > 0 ? de.structure.lockedByRecords : undefined}
            onConfirm={() => props.onMutate(() => client.adminDeleteModule(module.id))}
          />
        </>
      }
    >
      {editing ? (
        <EditForm
          fields={[
            { key: "title", label: de.common.title, value: module.title, maxLength: 300 },
            {
              key: "subtitle",
              label: de.structure.moduleSubtitle,
              value: module.subtitle ?? "",
              maxLength: 300,
              optional: true,
            },
          ]}
          onSubmit={(values) =>
            client.adminUpdateModule(module.id, {
              title: values.title ?? "",
              subtitle: nullable(values.subtitle),
            })
          }
          onDone={(next) => {
            props.onMutate(async () => next);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : null}

      <div className="mt-3 space-y-3">
        {module.chapters.length === 0 ? (
          <p className="text-sm text-gray-600">{de.structure.noChapters}</p>
        ) : (
          <ol className="space-y-3">
            {module.chapters.map((chapter, chapterIndex) => (
              <li key={chapter.id}>
                <ChapterBlock
                  client={client}
                  chapter={chapter}
                  module={module}
                  modules={modules}
                  index={chapterIndex}
                  onMutate={props.onMutate}
                  onReorder={props.onReorder}
                  onEditQuiz={props.onEditQuiz}
                />
              </li>
            ))}
          </ol>
        )}

        <AddForm
          label={de.structure.newChapter}
          fields={[{ key: "title", label: de.common.title, maxLength: 300 }]}
          onSubmit={(values) =>
            client.adminCreateChapter(module.id, { title: values.title ?? "" })
          }
          onDone={(next) => props.onMutate(async () => next)}
        />
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Chapter
// ---------------------------------------------------------------------------

function ChapterBlock(props: {
  client: ApiClient;
  chapter: AuthoringChapter;
  module: AuthoringModule;
  modules: readonly AuthoringModule[];
  index: number;
  onMutate: (action: () => Promise<Structure>) => void;
  onReorder: (next: readonly AuthoringModule[]) => void;
  onEditQuiz: (contentId: string, title: string) => void;
}) {
  const { client, chapter, module, modules, index } = props;
  const [editing, setEditing] = useState(false);

  const blocked = chapter.contents.some((content) => content.learnerRecords > 0);
  const moduleOptions = useMemo(
    () => modules.map((m) => [m.id, m.title] as const),
    [modules],
  );

  return (
    <Panel
      tone="nested"
      title={
        <span>
          <span className="text-xs font-normal uppercase tracking-wide text-gray-500">
            {de.structure.chapter} {index + 1}
          </span>
          <br />
          {chapter.title}
        </span>
      }
      actions={
        <>
          <IconButton
            label={de.common.moveUp}
            glyph="↑"
            disabled={index === 0}
            onClick={() =>
              props.onReorder(
                withChapters(modules, module.id, swap(module.chapters, index, index - 1)),
              )
            }
          />
          <IconButton
            label={de.common.moveDown}
            glyph="↓"
            disabled={index === module.chapters.length - 1}
            onClick={() =>
              props.onReorder(
                withChapters(modules, module.id, swap(module.chapters, index, index + 1)),
              )
            }
          />
          {modules.length > 1 ? (
            <label className="flex items-center gap-1 text-xs text-gray-600">
              <span className="sr-only sm:not-sr-only">{de.structure.moveToModule}</span>
              <select
                aria-label={de.structure.moveToModule}
                value={module.id}
                onChange={(event) =>
                  props.onReorder(moveChapter(modules, chapter.id, event.target.value))
                }
                className="rounded border border-gray-300 px-2 py-1 text-xs"
              >
                {moduleOptions.map(([id, title]) => (
                  <option key={id} value={id}>
                    {title}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <Button variant="secondary" onClick={() => setEditing(!editing)}>
            {editing ? de.common.cancel : de.common.edit}
          </Button>
          <ConfirmButton
            label={de.common.delete}
            confirmLabel={de.common.confirmDelete}
            cancelLabel={de.common.cancel}
            disabledReason={blocked ? de.structure.lockedByRecords : undefined}
            onConfirm={() => props.onMutate(() => client.adminDeleteChapter(chapter.id))}
          />
        </>
      }
    >
      {editing ? (
        <EditForm
          fields={[
            {
              key: "title",
              label: de.common.title,
              value: chapter.title,
              maxLength: 300,
            },
            {
              key: "body",
              label: de.structure.chapterBody,
              value: chapter.body ?? "",
              multiline: true,
              maxLength: 20_000,
              optional: true,
            },
          ]}
          onSubmit={(values) =>
            client.adminUpdateChapter(chapter.id, {
              title: values.title ?? "",
              body: nullable(values.body),
            })
          }
          onDone={(next) => {
            props.onMutate(async () => next);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : null}

      <div className="mt-3 space-y-2">
        {chapter.contents.length === 0 ? (
          <p className="text-sm text-gray-600">{de.structure.noContents}</p>
        ) : (
          <ol className="space-y-2">
            {chapter.contents.map((content, contentIndex) => (
              <li key={content.id}>
                <ContentRow
                  client={client}
                  content={content}
                  chapter={chapter}
                  modules={modules}
                  index={contentIndex}
                  onMutate={props.onMutate}
                  onReorder={props.onReorder}
                  onEditQuiz={props.onEditQuiz}
                />
              </li>
            ))}
          </ol>
        )}

        <NewContent
          client={client}
          chapterId={chapter.id}
          onDone={(next) => props.onMutate(async () => next)}
        />
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

function ContentRow(props: {
  client: ApiClient;
  content: AuthoringContent;
  chapter: AuthoringChapter;
  modules: readonly AuthoringModule[];
  index: number;
  onMutate: (action: () => Promise<Structure>) => void;
  onReorder: (next: readonly AuthoringModule[]) => void;
  onEditQuiz: (contentId: string, title: string) => void;
}) {
  const { client, content, chapter, modules, index } = props;
  const [editing, setEditing] = useState(false);

  const move = (to: number) =>
    props.onReorder(withContents(modules, chapter.id, swap(chapter.contents, index, to)));

  return (
    <div className="rounded border border-gray-200 bg-white p-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <span className="text-xs uppercase tracking-wide text-gray-500">
            {de.structure.kinds[content.kind]}
          </span>
          <p className="truncate text-sm font-medium text-gray-900">{content.title}</p>
          <p className="text-xs text-gray-500">
            {content.learnerRecords > 0
              ? de.structure.learnerRecords(content.learnerRecords)
              : null}
            {content.kind === "quiz" ? (
              <span className={content.learnerRecords > 0 ? "ml-2" : ""}>
                {content.questionCount === null || content.questionCount === 0
                  ? de.structure.noQuestions
                  : de.structure.questionCount(content.questionCount)}
              </span>
            ) : null}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <IconButton
            label={de.common.moveUp}
            glyph="↑"
            disabled={index === 0}
            onClick={() => move(index - 1)}
          />
          <IconButton
            label={de.common.moveDown}
            glyph="↓"
            disabled={index === chapter.contents.length - 1}
            onClick={() => move(index + 1)}
          />
          {content.kind === "quiz" ? (
            <Button
              variant="secondary"
              onClick={() => props.onEditQuiz(content.id, content.title)}
            >
              {de.structure.editQuiz}
            </Button>
          ) : null}
          <Button variant="secondary" onClick={() => setEditing(!editing)}>
            {editing ? de.common.cancel : de.common.edit}
          </Button>
          <ConfirmButton
            label={de.common.delete}
            confirmLabel={de.common.confirmDelete}
            cancelLabel={de.common.cancel}
            disabledReason={
              content.learnerRecords > 0 ? de.structure.lockedByRecords : undefined
            }
            onConfirm={() => props.onMutate(() => client.adminDeleteContent(content.id))}
          />
        </div>
      </div>

      {editing ? (
        <div className="mt-3 border-t border-gray-100 pt-3">
          <ContentForm
            initial={content}
            submitLabel={de.common.save}
            onSubmit={(write) => client.adminUpdateContent(content.id, write)}
            onDone={(next) => {
              props.onMutate(async () => next);
              setEditing(false);
            }}
            onCancel={() => setEditing(false)}
          />
        </div>
      ) : null}
    </div>
  );
}

function NewContent(props: {
  client: ApiClient;
  chapterId: string;
  onDone: (next: Structure) => void;
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        {de.structure.newContent}
      </Button>
    );
  }

  return (
    <div className="rounded border border-dashed border-gray-300 p-3">
      <ContentForm
        submitLabel={de.common.add}
        onSubmit={(write) => props.client.adminCreateContent(props.chapterId, write)}
        onDone={(next) => {
          props.onDone(next);
          setOpen(false);
        }}
        onCancel={() => setOpen(false)}
      />
    </div>
  );
}

/**
 * The one form in the console whose fields depend on a choice made inside it.
 *
 * Which fields matter is decided by `kind`, and the rule that a `video` needs a
 * `durationSec` is enforced by `@ds/domain` on the server. This form shows the
 * field and says why it is required; it does not decide — a second copy of that
 * rule here could disagree with the one that counts.
 */
function ContentForm(props: {
  initial?: AuthoringContent;
  submitLabel: string;
  onSubmit: (write: ContentWrite) => Promise<Structure>;
  onDone: (next: Structure) => void;
  onCancel: () => void;
}) {
  const initial = props.initial;
  const [kind, setKind] = useState<ContentKind>(initial?.kind ?? "video");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [sources, setSources] = useState<MediaSourceWrite[]>(
    initial?.sources?.map((source) => ({ ...source })) ?? [],
  );
  const [posterUrl, setPosterUrl] = useState(initial?.posterUrl ?? "");
  const [captionsUrl, setCaptionsUrl] = useState(initial?.captionsUrl ?? "");
  const [durationSec, setDurationSec] = useState(
    initial?.durationSec === null || initial?.durationSec === undefined
      ? ""
      : String(initial.durationSec),
  );
  const [probe, setProbe] = useState<"idle" | "running" | "failed" | number>("idle");
  const [fileUrl, setFileUrl] = useState(initial?.fileUrl ?? "");
  const [mimeType, setMimeType] = useState(initial?.mimeType ?? "");
  const saver = useSaver();

  const id = (field: string) => `content-${initial?.id ?? "new"}-${field}`;

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        void saver.run(async () =>
          props.onDone(
            await props.onSubmit({
              kind,
              title: title.trim(),
              body: nullable(body),
              // Blank rows are dropped rather than sent: an author who added a
              // row and changed their mind should not get a 422 about it.
              sources: sources.filter((source) => source.url.trim() !== ""),
              posterUrl: nullable(posterUrl),
              captionsUrl: nullable(captionsUrl),
              durationSec: durationSec.trim() === "" ? null : Number(durationSec),
              fileUrl: nullable(fileUrl),
              mimeType: nullable(mimeType),
            }),
          ),
        );
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={de.structure.kind} htmlFor={id("kind")}>
          <Select
            id={id("kind")}
            value={kind}
            options={CONTENT_KINDS}
            onChange={setKind}
          />
        </Field>
        <Field label={de.common.title} htmlFor={id("title")}>
          <TextInput id={id("title")} value={title} maxLength={300} onChange={setTitle} />
        </Field>
      </div>

      {kind === "video" ? (
        <>
          <SourcesEditor sources={sources} onChange={setSources} idFor={id} />

          {sources.filter((source) => source.url.trim() !== "").length === 0 ? (
            <Notice tone="warning">{de.structure.sourcesMissing}</Notice>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label={de.structure.durationSec}
              hint={de.structure.durationHint}
              htmlFor={id("duration")}
            >
              <TextInput
                id={id("duration")}
                value={durationSec}
                type="number"
                onChange={(next) => {
                  setDurationSec(next);
                  // A typed value replaces the probe's verdict rather than
                  // sitting under a stale "Länge übernommen".
                  setProbe("idle");
                }}
              />
              {/*
                The length is a compliance input, not a caption: the watch gate
                is a percentage of it, so a mistyped figure quietly makes the
                tail of a video optional. Reading it out of the file is the one
                way to get it right that does not depend on the author's care.
              */}
              <DurationProbe
                sources={sources}
                state={probe}
                onState={setProbe}
                onDuration={(seconds) => setDurationSec(String(seconds))}
              />
            </Field>
            <Field
              label={de.structure.posterUrl}
              hint={de.structure.posterHint}
              htmlFor={id("poster")}
            >
              <TextInput
                id={id("poster")}
                value={posterUrl}
                maxLength={2000}
                onChange={setPosterUrl}
              />
            </Field>
            <Field
              label={de.structure.captionsUrl}
              hint={de.structure.captionsHint}
              htmlFor={id("captions")}
            >
              <TextInput
                id={id("captions")}
                value={captionsUrl}
                maxLength={2000}
                onChange={setCaptionsUrl}
              />
            </Field>
          </div>
        </>
      ) : null}

      {/*
        Not a refusal. WCAG 1.2.2 is Level A and every video with speech owes
        captions, but a slide-only recording legitimately has none and neither
        this form nor the server can tell the two apart. Saying what is owed and
        why is the honest middle — blocking the save would stop valid content,
        and saying nothing would let an author not know.
      */}
      {kind === "video" && captionsUrl.trim() === "" ? (
        <Notice tone="warning">{de.structure.captionsMissing}</Notice>
      ) : null}

      {kind === "text" || kind === "details" ? (
        <Field label={de.structure.body} htmlFor={id("body")}>
          <TextArea
            id={id("body")}
            value={body}
            rows={6}
            maxLength={20_000}
            onChange={setBody}
          />
        </Field>
      ) : null}

      {kind === "material" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={de.structure.fileUrl} htmlFor={id("file")}>
            <TextInput
              id={id("file")}
              value={fileUrl}
              maxLength={2000}
              onChange={setFileUrl}
            />
          </Field>
          <Field label={de.structure.mimeType} htmlFor={id("mime")}>
            <TextInput
              id={id("mime")}
              value={mimeType}
              maxLength={200}
              onChange={setMimeType}
            />
          </Field>
        </div>
      ) : null}

      <SaveProblem title={de.error.title} problem={saver.problem} />

      <div className="flex gap-2">
        <Button type="submit" disabled={saver.state === "saving" || title.trim() === ""}>
          {saver.state === "saving" ? de.common.saving : props.submitLabel}
        </Button>
        <Button variant="secondary" onClick={props.onCancel}>
          {de.common.cancel}
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Small generic forms
//
// Modules and chapters differ only in their field list, so they share one form
// rather than each carrying a near-identical copy that would drift.
// ---------------------------------------------------------------------------

interface FormField {
  readonly key: string;
  readonly label: string;
  readonly value?: string;
  readonly maxLength?: number;
  readonly multiline?: boolean;
  readonly optional?: boolean;
}

function AddForm(props: {
  label: string;
  fields: readonly FormField[];
  onSubmit: (values: Record<string, string>) => Promise<Structure>;
  onDone: (next: Structure) => void;
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        {props.label}
      </Button>
    );
  }

  return (
    <div className="rounded border border-dashed border-gray-300 p-3">
      <EditForm
        fields={props.fields}
        submitLabel={de.common.add}
        onSubmit={props.onSubmit}
        onDone={(next) => {
          props.onDone(next);
          setOpen(false);
        }}
        onCancel={() => setOpen(false)}
      />
    </div>
  );
}

function EditForm(props: {
  fields: readonly FormField[];
  submitLabel?: string;
  onSubmit: (values: Record<string, string>) => Promise<Structure>;
  onDone: (next: Structure) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(props.fields.map((field) => [field.key, field.value ?? ""])),
  );
  const saver = useSaver();

  const incomplete = props.fields.some(
    (field) => field.optional !== true && (values[field.key] ?? "").trim() === "",
  );

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        void saver.run(async () => props.onDone(await props.onSubmit(values)));
      }}
    >
      {props.fields.map((field) => {
        const id = `field-${field.key}-${props.fields.length}`;
        return (
          <Field
            key={field.key}
            label={
              field.optional === true
                ? `${field.label} (${de.common.optional})`
                : field.label
            }
            htmlFor={id}
          >
            {field.multiline === true ? (
              <TextArea
                id={id}
                value={values[field.key] ?? ""}
                maxLength={field.maxLength}
                onChange={(value) => setValues({ ...values, [field.key]: value })}
              />
            ) : (
              <TextInput
                id={id}
                value={values[field.key] ?? ""}
                maxLength={field.maxLength}
                onChange={(value) => setValues({ ...values, [field.key]: value })}
              />
            )}
          </Field>
        );
      })}

      <SaveProblem title={de.error.title} problem={saver.problem} />

      <div className="flex gap-2">
        <Button type="submit" disabled={saver.state === "saving" || incomplete}>
          {saver.state === "saving"
            ? de.common.saving
            : (props.submitLabel ?? de.common.save)}
        </Button>
        <Button variant="secondary" onClick={props.onCancel}>
          {de.common.cancel}
        </Button>
      </div>
    </form>
  );
}

/**
 * The renditions of one video.
 *
 * ## Why the format is a dropdown and not a text field
 *
 * The value reaches a browser as a `<source type>` attribute and is matched
 * *literally*. `mp4`, `video/MP4 ` or a stray space produces a source every
 * browser silently skips — presenting as a video that will not play, with
 * nothing in the console to explain it. The server refuses an unknown type with
 * a 422, but a dropdown means the author never reaches that refusal.
 *
 * ## Why the order is editable
 *
 * The browser takes the first `type` it can play, so order **is** the format
 * negotiation: an adaptive stream listed after the MP4 is an adaptive stream
 * Safari never uses. `orderSources` re-sorts adaptive ahead of progressive when
 * the lesson is served, so getting this wrong is recoverable — but within a
 * group the author's order is preserved and is theirs to decide.
 */
/**
 * "Aus Video ermitteln" — fills the length from the file's own header.
 *
 * Offered rather than automatic. An author editing an existing content item may
 * have a deliberate figure in that field: a recording with thirty seconds of
 * black at the end, or a length agreed with the Ärztekammer. Overwriting it on
 * render would replace a decision with a measurement without telling anybody.
 *
 * Absent entirely when no source can be fetched — a button that always fails is
 * worse than no button.
 */
function DurationProbe(props: {
  sources: readonly MediaSourceWrite[];
  state: "idle" | "running" | "failed" | number;
  onState: (next: "idle" | "running" | "failed" | number) => void;
  onDuration: (seconds: number) => void;
}) {
  const url = probeableSourceUrl(props.sources);
  if (url === undefined) return null;

  return (
    <div className="mt-1 space-y-1">
      <button
        type="button"
        className="ds-button-secondary text-xs"
        disabled={props.state === "running"}
        onClick={() => {
          props.onState("running");
          void probeDurationSec(url).then((seconds) => {
            if (seconds === undefined) {
              props.onState("failed");
              return;
            }
            props.onDuration(seconds);
            props.onState(seconds);
          });
        }}
      >
        {props.state === "running"
          ? de.structure.durationDetecting
          : de.structure.durationDetect}
      </button>
      {typeof props.state === "number" ? (
        <p className="text-xs text-green-700" role="status">
          {de.structure.durationDetected(props.state)}
        </p>
      ) : null}
      {props.state === "failed" ? (
        <p className="text-xs text-amber-700" role="status">
          {de.structure.durationDetectFailed}
        </p>
      ) : null}
    </div>
  );
}

function SourcesEditor(props: {
  sources: readonly MediaSourceWrite[];
  onChange: (next: MediaSourceWrite[]) => void;
  idFor: (field: string) => string;
}) {
  const patch = (index: number, change: Partial<MediaSourceWrite>) =>
    props.onChange(
      props.sources.map((source, i) => (i === index ? { ...source, ...change } : source)),
    );

  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-gray-900">
        {de.structure.sources}
      </legend>
      <p className="text-xs text-gray-500">{de.structure.sourcesHint}</p>

      <ul className="space-y-2">
        {props.sources.map((source, index) => (
          // Index-keyed deliberately: a row has no id until it is saved, and
          // keying on the URL would remount the input on every keystroke and
          // lose focus after each character.
          <li key={index} className="grid gap-2 sm:grid-cols-[1fr_11rem_8rem_auto]">
            <TextInput
              id={props.idFor(`source-url-${index}`)}
              aria-label={de.structure.sourceUrl}
              value={source.url}
              maxLength={2000}
              onChange={(url) => patch(index, { url })}
            />
            <Select
              id={props.idFor(`source-type-${index}`)}
              aria-label={de.structure.sourceType}
              value={source.mimeType}
              options={MEDIA_TYPE_OPTIONS}
              onChange={(mimeType) => patch(index, { mimeType })}
            />
            <TextInput
              id={props.idFor(`source-label-${index}`)}
              aria-label={de.structure.sourceLabel}
              value={source.label ?? ""}
              maxLength={60}
              onChange={(label) => patch(index, { label })}
            />
            <IconButton
              label={de.structure.removeSource(source.url === "" ? "—" : source.url)}
              glyph="✕"
              onClick={() => props.onChange(props.sources.filter((_, i) => i !== index))}
            />
          </li>
        ))}
      </ul>

      <Button
        variant="secondary"
        onClick={() =>
          props.onChange([
            ...props.sources,
            // Defaults to MP4: it is the rendition every course has, and an
            // author adding a second one changes the dropdown deliberately.
            { url: "", mimeType: "video/mp4", label: null },
          ])
        }
      >
        {de.structure.addSource}
      </Button>
    </fieldset>
  );
}

/**
 * The formats a source may declare, labelled for an author.
 *
 * Derived from `MEDIA_MIME_TYPES` rather than typed out, so the dropdown cannot
 * offer a type the server would refuse — the list has one home.
 */
const MEDIA_TYPE_LABELS: Readonly<Record<string, string>> = {
  "video/mp4": "MP4 (H.264)",
  "video/webm": "WebM",
  "video/ogg": "Ogg",
  "audio/mpeg": "MP3 (nur Ton)",
  "audio/mp4": "M4A (nur Ton)",
  "audio/ogg": "Ogg (nur Ton)",
  "application/vnd.apple.mpegurl": "HLS (adaptiv)",
  "application/x-mpegurl": "HLS (adaptiv, alt)",
  "application/dash+xml": "DASH (adaptiv)",
};

const MEDIA_TYPE_OPTIONS: ReadonlyArray<readonly [string, string]> = MEDIA_MIME_TYPES.map(
  (mimeType) => [mimeType, MEDIA_TYPE_LABELS[mimeType] ?? mimeType] as const,
);
