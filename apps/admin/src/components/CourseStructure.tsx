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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ApiClient,
  AuthoringChapter,
  AuthoringContent,
  AuthoringModule,
  CourseStructure as Structure,
  ContentWrite,
  MediaSourceWrite,
} from "@ds/sdk";
import { lengthsAgree, mimeTypeForUrl } from "@ds/domain";
import { MediaCheckPanel } from "./MediaCheck.js";
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
import { readableUrl } from "../media-preview.js";
import { capturePosterFrame } from "../poster-frame.js";
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
import { isUploadedReference, referenceName, runUpload } from "../uploads.js";
import { MediaDialog } from "./MediaDialog.js";
import { MediaPreview, UploadField } from "./UploadField.js";

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
      {/*
        Both rules, once, in prose measure (P100-01).

        The second one used to be repeated verbatim beside every locked row —
        three times on a course with one module, one chapter and one content,
        and it is 118 characters. A rule that is the same on every row belongs
        where the screen is explained; what the row needs is the marker.
      */}
      <div className="max-w-3xl space-y-1.5 text-sm text-gray-600">
        <p>{de.structure.intro}</p>
        <p>{de.structure.lockedRule}</p>
      </div>

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
                courseSlug={courseSlug}
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

      {/*
       * Here rather than on the settings screen, because this is where the
       * source URLs are typed and it is the URLs the check is about (P63-04).
       */}
      <MediaCheckPanel client={client} courseSlug={courseSlug} />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

function ModuleBlock(props: {
  client: ApiClient;
  courseSlug: string;
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
            lockedLabel={de.structure.locked}
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
                  courseSlug={props.courseSlug}
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
  courseSlug: string;
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
            lockedLabel={de.structure.locked}
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
                  courseSlug={props.courseSlug}
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
          courseSlug={props.courseSlug}
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
  courseSlug: string;
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
            lockedLabel={de.structure.locked}
            onConfirm={() => props.onMutate(() => client.adminDeleteContent(content.id))}
          />
        </div>
      </div>

      {editing ? (
        <div className="mt-3 border-t border-gray-100 pt-3">
          <ContentForm
            client={client}
            courseSlug={props.courseSlug}
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
  courseSlug: string;
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
        client={props.client}
        courseSlug={props.courseSlug}
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
  client: ApiClient;
  courseSlug: string;
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
              /*
               * Derived, never typed (P79-01). The uploader reports the
               * bucket's own content type and `mimeTypeForUrl` reads the
               * extension of a pasted URL; `undefined` from either means the
               * format is simply not described, which is legitimate.
               */
              mimeType: nullable(mimeType) ?? mimeTypeForUrl(fileUrl) ?? null,
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
          <SourcesEditor
            sources={sources}
            onChange={setSources}
            idFor={id}
            client={props.client}
            courseSlug={props.courseSlug}
          />

          {sources.filter((source) => source.url.trim() !== "").length === 0 ? (
            <Notice tone="warning">{de.structure.sourcesMissing}</Notice>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            {/*
              The length is **measured**, not typed (P75-01).

              It was a number field with a button beside it, and the client's
              report is what that costs: a 45-second video on a course whose
              row said 1524, a learner told to watch 25:24 that does not exist,
              and no way forward — the watch gate is a percentage of this
              figure, so one wrong number makes a module impossible rather than
              merely inaccurate.

              A field an author *can* get wrong is a field that eventually is
              wrong, and nothing downstream can tell. So the file decides, and
              the only escape hatch is the one case where no file can be read.
            */}
            <MeasuredDuration
              id={id("duration")}
              sources={sources}
              client={props.client}
              courseSlug={props.courseSlug}
              value={durationSec}
              state={probe}
              onState={setProbe}
              onChange={setDurationSec}
            />
            <AutoPoster
              id={id("poster")}
              sources={sources}
              value={posterUrl}
              client={props.client}
              courseSlug={props.courseSlug}
              onChange={setPosterUrl}
            />
            <UploadField
              label={de.structure.captionsUrl}
              hint={de.structure.captionsHint}
              id={id("captions")}
              value={captionsUrl}
              purpose="captions"
              client={props.client}
              courseSlug={props.courseSlug}
              onChange={setCaptionsUrl}
            />
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

      {/*
        `material` is here too, and that was the missing half of the Mediathek
        card.

        The layout draws a paragraph under each download's title (page-05), and
        the learner API now sends it — but this form only offered the field for
        `text` and `details`, so there was no way to write one. An exposed field
        nobody can fill is the same as no field.

        Same column, same 20 000 cap, different label: on a download it is the
        sentence that says what the file is for, not the lesson's prose.
      */}
      {kind === "text" || kind === "details" || kind === "material" ? (
        <Field
          label={kind === "material" ? de.structure.materialBody : de.structure.body}
          htmlFor={id("body")}
        >
          <TextArea
            id={id("body")}
            value={body}
            rows={kind === "material" ? 3 : 6}
            maxLength={20_000}
            onChange={setBody}
          />
        </Field>
      ) : null}

      {kind === "material" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <UploadField
            label={de.structure.fileUrl}
            id={id("file")}
            value={fileUrl}
            purpose="material"
            client={props.client}
            courseSlug={props.courseSlug}
            onChange={setFileUrl}
            // The bucket's own answer, not the file picker's claim — and it
            // saves an author typing "application/pdf" into a free-text field.
            onMimeType={setMimeType}
          />
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
 * The video's length, measured from the file rather than typed (P75-01).
 *
 * ## Why there is no longer a number field here
 *
 * Reported from production:
 *
 * > _"in the course i have a video which is 45 seconds and the system says you
 * > have to watch a video for 25 minutes, which there is not, and i can not go
 * > further in the course"_
 *
 * The watch gate is a percentage of `durationSec`. A figure larger than the
 * file is therefore not an inaccuracy — it is a module **nobody can finish**,
 * because the seconds it demands do not exist to be watched. The learner sees a
 * progress bar that cannot fill and no sentence explaining why.
 *
 * It used to be a text input with "Aus Video ermitteln" beside it, offered
 * rather than automatic, on the reasoning that an author might have a
 * deliberate figure — a recording with thirty seconds of black at the end. That
 * reasoning was wrong in the direction that matters: a field an author *can*
 * get wrong is one that eventually is wrong, nothing downstream can tell, and
 * the person who pays is a physician who cannot complete their Fortbildung.
 *
 * So the file decides. The measurement runs by itself when the sources change,
 * and the value is shown as what it is: a reading, not an opinion.
 *
 * ## The one escape hatch, and why it exists
 *
 * A length that cannot be measured must not make the content unsaveable — a
 * customer's own CDN may send no CORS headers, and an adaptive manifest may
 * report nothing. In exactly that case the field becomes editable and says
 * why. Removing it entirely would replace "a wrong number" with "a course that
 * cannot be authored at all", which is not an improvement (CLAUDE.md §9.2: a
 * control that can only produce an error is worse than an absent one — and so
 * is an absent control that was the only way through).
 */
/**
 * The poster field, which fills itself from the video (P80-01).
 *
 * Asked for as _"the preview picture should be automatically as the first
 * second of the video if no image is selected."_ Without one the player shows
 * a black rectangle until the first frame decodes, which is indistinguishable
 * from a video that failed to load.
 *
 * ## Only when the box is empty
 *
 * It never replaces a poster an author chose. The capture runs when there is a
 * video, no poster, and no capture has been attempted for this source — and the
 * ordinary upload field stays exactly as it was underneath, so choosing a still
 * by hand is unchanged.
 *
 * ## Failure is silent on purpose
 *
 * `capturePosterFrame` answers `undefined` for a tainted canvas, a codec the
 * browser cannot decode, or a source that never loads. A poster is a
 * convenience and the field beside it still works, so a failure leaves the box
 * empty rather than interrupting an author with an error about a thing they did
 * not ask for. The one thing it must not do is loop: `attemptedRef` records the
 * source it tried, so a failure is attempted once and not on every keystroke.
 */
function AutoPoster(props: {
  id: string;
  sources: readonly MediaSourceWrite[];
  value: string;
  client: ApiClient;
  courseSlug: string;
  onChange: (value: string) => void;
}) {
  const source = probeableSourceUrl(props.sources);
  const { client, courseSlug, onChange, value } = props;
  const [busy, setBusy] = useState(false);
  const attemptedRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (source === undefined) return;
    if (value.trim() !== "") return;
    if (attemptedRef.current === source) return;
    attemptedRef.current = source;

    let cancelled = false;
    setBusy(true);
    void (async () => {
      try {
        // The same signed read the duration probe and the preview use — an
        // `s3://` reference is not something a `<video>` can open.
        const url = await readableUrl(client, courseSlug, source);
        const frame = url === undefined ? undefined : await capturePosterFrame(url);
        if (cancelled || frame === undefined) return;

        // The ordinary upload path: same presign, same key prefix, same
        // storage audit row. A second path for posters would be a second set
        // of rules to keep in step.
        const uploaded = await runUpload(
          client,
          courseSlug,
          "poster",
          frame,
          () => {},
          new AbortController().signal,
        );
        if (!cancelled) onChange(uploaded.reference);
      } catch {
        // Silent by design — see the header.
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [source, value, client, courseSlug, onChange]);

  return (
    <div>
      <UploadField
        label={de.structure.posterUrl}
        hint={de.structure.posterHint}
        id={props.id}
        value={props.value}
        purpose="poster"
        client={client}
        courseSlug={courseSlug}
        onChange={onChange}
      />
      {busy ? (
        <p className="mt-1 text-xs text-[color:var(--ds-ink-muted)]" role="status">
          {de.structure.posterCapturing}
        </p>
      ) : null}
    </div>
  );
}

function MeasuredDuration(props: {
  id: string;
  sources: readonly MediaSourceWrite[];
  client: ApiClient;
  courseSlug: string;
  value: string;
  state: "idle" | "running" | "failed" | number;
  onState: (next: "idle" | "running" | "failed" | number) => void;
  onChange: (value: string) => void;
}) {
  const source = probeableSourceUrl(props.sources);
  const { client, courseSlug, onChange, onState } = props;

  /**
   * What was stored before this form measured anything (P76-03).
   *
   * The measurement overwrites the field, which is the point of P75-01 — and on
   * its own it makes a *broken* content indistinguishable from a correct one:
   * the operator opens the form, sees the right length, and never learns that
   * what was saved was blocking learners, or that they now have to press
   * Speichern to repair it.
   *
   * A ref taken on first render, not `props.value`, because `props.value` is
   * what the probe replaced a moment later.
   */
  const storedRef = useRef(props.value);

  /**
   * The source this content had when the form opened (P80-02).
   *
   * Without it the notice below cannot tell two very different situations
   * apart, and it reported the alarming one for both:
   *
   * - the file is unchanged and the stored length disagrees with it — the
   *   content **was** blocking learners, which is worth a warning;
   * - the operator has just uploaded a different file, so of course the stored
   *   length describes the old one. Nobody was blocked; nothing is wrong.
   *
   * The client hit the second and read the first: „Teilnehmende konnten diesen
   * Abschnitt nicht abschließen" immediately after uploading a new video, about
   * a video no learner has ever seen.
   */
  const openedWithSource = useRef(source);
  const sourceChangedHere = source !== openedWithSource.current;

  /*
   * Measured when the source changes, and only then.
   *
   * Keyed on the URL rather than on the array: the sources list is rebuilt on
   * every keystroke in a label field, and re-probing a lecture on each one
   * would mint a signature per character.
   */
  useEffect(() => {
    if (source === undefined) return;

    let cancelled = false;
    onState("running");
    void (async () => {
      // An `s3://` reference has to become a signed URL before a `<video>` can
      // load it; an ordinary URL passes straight through.
      const url = await readableUrl(client, courseSlug, source);
      const seconds = url === undefined ? undefined : await probeDurationSec(url);
      if (cancelled) return;
      if (seconds === undefined) {
        onState("failed");
        return;
      }
      onChange(String(seconds));
      onState(seconds);
    })();

    return () => {
      cancelled = true;
    };
  }, [source, client, courseSlug, onChange, onState]);

  const measured = typeof props.state === "number";

  return (
    <Field
      label={de.structure.durationSec}
      hint={measured ? de.structure.durationMeasuredHint : de.structure.durationHint}
      htmlFor={props.id}
    >
      {measured ? (
        // Shown, not editable. The number is a reading of the file, and a box
        // around it would invite the edit this whole component exists to stop.
        <p
          className="rounded-md border border-[color:var(--ds-hairline)] bg-[color:var(--ds-surface)] px-3 py-2 text-sm text-[color:var(--ds-ink)]"
          id={props.id}
        >
          {de.structure.durationMeasured(Number(props.state))}
        </p>
      ) : (
        <TextInput
          id={props.id}
          value={props.value}
          type="number"
          onChange={props.onChange}
        />
      )}

      {props.state === "running" ? (
        <p className="mt-1 text-xs text-[color:var(--ds-ink-muted)]" role="status">
          {de.structure.durationDetecting}
        </p>
      ) : null}

      {props.state === "failed" ? (
        <p className="mt-1 text-xs text-amber-700" role="status">
          {de.structure.durationDetectFailed}
        </p>
      ) : null}

      {/*
        The stored figure was wrong, and saying so is the repair (P76-03).

        Without this the correction is invisible: the form measures, the field
        shows the right number, and an operator who came here for something else
        never learns that this content was refusing to complete for every
        learner — nor that leaving without pressing Speichern leaves it that way.

        It names both numbers and the consequence, per §9.4. `role="status"`
        rather than `alert`: this is the operator's own screen reporting on work
        it just did, not an interruption.
      */}
      {measured && !lengthsAgree(Number(storedRef.current), Number(props.state)) ? (
        /*
         * Two sentences, because they are two different facts (P80-02).
         *
         * Amber only for a length that disagrees with the file that was
         * *already there* — that content really was refusing to complete.
         * Swapping the video is an ordinary edit and gets an ordinary note:
         * the number changed with the file, press Speichern.
         */
        <p
          className={`mt-1 text-xs ${
            sourceChangedHere ? "text-[color:var(--ds-ink-muted)]" : "text-amber-700"
          }`}
          role="status"
        >
          {sourceChangedHere
            ? de.structure.durationFollowedNewFile(Number(props.state))
            : de.structure.durationCorrected(
                Number(storedRef.current),
                Number(props.state),
              )}
        </p>
      ) : null}
    </Field>
  );
}

function SourcesEditor(props: {
  sources: readonly MediaSourceWrite[];
  onChange: (next: MediaSourceWrite[]) => void;
  idFor: (field: string) => string;
  client: ApiClient;
  courseSlug: string;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);

  const patch = (index: number, change: Partial<MediaSourceWrite>) =>
    props.onChange(
      props.sources.map((source, i) => (i === index ? { ...source, ...change } : source)),
    );

  // The same rule the length probe uses, so the preview and the measurement are
  // of the same file.
  const previewed = probeableSourceUrl(props.sources);

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
            {isUploadedReference(source.url) ? (
              // A key is not editable text. It is the server's, and a
              // hand-edited one can only ever be refused — so it renders as
              // what it is and the row is removed rather than corrected.
              <span className="flex items-center rounded-md border border-[color:var(--ds-hairline)] bg-[color:var(--ds-surface)] px-3 py-2 text-sm text-[color:var(--ds-ink)]">
                {de.uploads.stored} · {referenceName(source.url)}
              </span>
            ) : (
              <TextInput
                id={props.idFor(`source-url-${index}`)}
                aria-label={de.structure.sourceUrl}
                value={source.url}
                maxLength={2000}
                onChange={(url) =>
                  // The extension answers it, so nobody has to (P79-01). An
                  // unrecognised one stores "", which reaches the player as a
                  // <source> with no `type` and is sniffed by the browser.
                  patch(index, { url, mimeType: mimeTypeForUrl(url) ?? "" })
                }
              />
            )}
            {/*
              The Bezeichnung, and only when it can do anything (P84-02).
              
              Reported as *"i still do not get it what is this automatisch"*:
              the field carried the value "Automatisch", had no visible label —
              only an `aria-label` a sighted person never sees — and sat beside
              a single video source, where the quality picker it feeds is never
              drawn at all. So it was an unexplained box whose contents changed
              nothing, which is the §9.2 shape with the sign flipped.
              
              A quality picker needs something to pick between, so this appears
              from the second source onwards, with the sentence that was already
              written for it in the locale and rendered nowhere (§9.3).
            */}
            {props.sources.length < 2 ? null : (
              <TextInput
                id={props.idFor(`source-label-${index}`)}
                aria-label={de.structure.sourceLabel}
                value={source.label ?? ""}
                maxLength={60}
                onChange={(label) => patch(index, { label })}
              />
            )}
            <IconButton
              label={de.structure.removeSource(source.url === "" ? "—" : source.url)}
              glyph="✕"
              onClick={() => props.onChange(props.sources.filter((_, i) => i !== index))}
            />
          </li>
        ))}
      </ul>

      {props.sources.length < 2 ? null : (
        <p className="text-xs text-[color:var(--ds-ink-muted)]">
          {de.structure.sourceLabelHint}
        </p>
      )}

      {/*
        One button, and it used to be three (P90-01).

        "Video hochladen", "Aus Mediathek wählen" and "Videoquelle hinzufügen"
        stood here as equals, and they were not alternatives — they were an
        upload, a library and an empty row for an external URL, each added in a
        different phase for a reason that was locally sound. The client read the
        row as one decision offered three times:

          *"why are there 3 options? i don't get it why I have to repeat
          everything multiple times, just one button to select the media"*

        All three are answers to "which file?", so they are tabs of one dialog
        now. Every one of them still exists — the URL tab is the empty row with
        a label saying what belongs in it.
      */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          id={props.idFor("choose-media")}
          onClick={() => setDialogOpen(true)}
        >
          {de.media.choose}
        </Button>
      </div>

      {!dialogOpen ? null : (
        <MediaDialog
          client={props.client}
          kind="video"
          purpose="video"
          courseSlug={props.courseSlug}
          onPick={(reference, mimeType) => {
            /*
             * Appended rather than replacing the first, because a course can
             * carry several renditions of one recording — 1080p, 720p, an
             * adaptive manifest — and silently overwriting the one already
             * there would lose an author's work with no undo.
             *
             * The type comes from the bucket where there is one, so the player
             * is told what was actually stored rather than what a filename
             * suggested; `mimeTypeForUrl` answers for an external URL.
             */
            props.onChange([
              ...props.sources,
              {
                url: reference,
                mimeType: mimeType === "" ? (mimeTypeForUrl(reference) ?? "") : mimeType,
                label: null,
              },
            ]);
            setDialogOpen(false);
          }}
          onClose={() => setDialogOpen(false)}
        />
      )}

      <p className="text-xs text-[color:var(--ds-ink-muted)]">
        {de.uploads.videoUploadHint}
      </p>

      {/*
        One preview, under the list rather than one per row (P74-03).

        The rows are renditions of the *same* recording — 1080p, 720p, an
        adaptive manifest — so three players would show the same film three
        times and download it three times. The first row is the one the browser
        would take, so it is the one worth looking at, and it is also the one
        `DurationProbe` measures: seeing a different film from the one the length
        came off would be worse than seeing none.
      */}
      {previewed === undefined ? null : (
        <MediaPreview
          client={props.client}
          courseSlug={props.courseSlug}
          value={previewed}
          purpose="video"
        />
      )}
    </fieldset>
  );
}
