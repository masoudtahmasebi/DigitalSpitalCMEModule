/**
 * Putting a file into a course (P23-04).
 *
 * Until now the course editor took a URL and only a URL, which meant somebody
 * had to already have the video hosted somewhere — the reported version of that
 * was "how can I upload a video?!". This is the missing half.
 *
 * ## What it is not
 *
 * It is not a file input that posts to the API. The bytes go **straight to
 * object storage** over a short-lived signed URL: the console asks the API for
 * permission, uploads, and then asks the API to confirm the object landed.
 * `@ds/sdk`'s `uploadToTicket` is the only part that talks to the bucket, and it
 * deliberately sends no cookie, no bearer token and no tenant header — the
 * signature is the authorisation, and a shared request helper is how a
 * credential eventually ends up at a third-party host.
 *
 * ## Why the progress bar is not decoration
 *
 * A lecture is hundreds of megabytes and takes minutes. A spinner with no
 * percentage in front of that is indistinguishable from a hang, and the
 * reasonable response to a hang is to reload the page — which, with no
 * resumable upload behind it, throws away everything transferred so far. The
 * percentage is what stops that.
 *
 * ## Why the value is shown as a chip, not as a key
 *
 * An `s3://0198f4c1-…/courses/0198f4c1-…/video-9f3b…mp4` in a text field is
 * unreadable, invites editing, and editing it can only ever break it — the key
 * is the server's, and a hand-edited one is refused. So a stored reference
 * renders as "hochgeladen" with the object's own name and a remove button,
 * while an ordinary URL stays an editable field. Both are legitimate: a
 * customer already serving media from their own CDN keeps doing that.
 */

import { useRef, useState } from "react";
import { srtToVtt } from "@ds/domain";
import type { ApiClient, UploadPurpose } from "@ds/sdk";
import { uploadToTicket } from "@ds/sdk";
import { de } from "../locale/de.js";
import { useReadableUrl } from "../media-preview.js";
import { Button, Field, IconButton, Notice, TextInput } from "./ui.js";

/**
 * What a file picker should offer per purpose. Mirrors `UPLOAD_TYPES`.
 *
 * `captions` offers `.srt` as well, and that is not a widening of what the
 * platform stores (P74-05). An SRT is converted to WebVTT here, before the
 * upload, so the object in the bucket is `text/vtt` exactly as before — see
 * `prepare`. Offering it is the point: SRT is what comes out of every
 * transcription service, and `<track>` takes WebVTT and nothing else.
 */
const ACCEPT: Readonly<Record<UploadPurpose, string>> = {
  video: "video/mp4,video/webm,audio/mpeg,audio/mp4",
  captions: "text/vtt,.vtt,.srt,application/x-subrip",
  poster: "image/jpeg,image/png,image/webp",
  material: "application/pdf",
};

type State =
  | { readonly kind: "idle" }
  | { readonly kind: "uploading"; readonly percent: number }
  | { readonly kind: "failed"; readonly message: string };

export function isUploadedReference(value: string): boolean {
  return value.startsWith("s3://");
}

/** The object's own filename, for a chip a human can recognise. */
export function referenceName(value: string): string {
  return value.split("/").at(-1) ?? value;
}

/**
 * Run the three-step upload and report the reference.
 *
 * Exported so the sources editor can upload a video without this component's
 * single-value chrome — a video content has a *list* of renditions, and the
 * field below has one value.
 */
export async function runUpload(
  client: ApiClient,
  courseSlug: string,
  purpose: UploadPurpose,
  chosen: File,
  onProgress: (percent: number) => void,
  signal: AbortSignal,
): Promise<{ reference: string; mimeType: string }> {
  const file = await prepare(purpose, chosen);

  const ticket = await client.adminBeginUpload(courseSlug, {
    purpose,
    // `file.type` is empty for some files on some platforms — a `.vtt` picked
    // in Safari is the usual one. Falling back to the purpose's own type lets
    // the server decide rather than failing here with nothing to say.
    mimeType: file.type === "" ? fallbackType(purpose) : file.type,
    sizeBytes: file.size,
  });

  await uploadToTicket(ticket, file, { onProgress, signal });

  // Not optional. Without it there is no reference, and the server has not
  // checked that the bucket holds what it approved.
  const confirmed = await client.adminCompleteUpload(courseSlug, ticket.key);
  return { reference: confirmed.reference, mimeType: confirmed.mimeType };
}

/**
 * The file as it should reach the bucket (P74-05).
 *
 * Only captions have anything to do here, and only when the author picked an
 * SRT. `<track src>` takes **WebVTT and nothing else**: a browser handed an
 * `.srt` fires `error` on the track and shows no captions at all, silently,
 * with the video playing perfectly. So an author who uploaded subtitles and saw
 * no complaint would have a course without them, and would find out from a
 * physician who could not follow it.
 *
 * Converting here rather than at play time means the stored object is genuinely
 * `text/vtt`: the API's upload rules do not learn a second format, nothing
 * converts on the learner's path, and a file downloaded from the Mediathek is
 * what its name says.
 *
 * A file that is already WebVTT, or that is not subtitles at all, is passed
 * through untouched. The second is deliberate: the server refuses it with a
 * German message written for this screen, which is a better refusal than
 * anything this function could invent, and a converter that repaired its input
 * would produce plausible nonsense.
 */
async function prepare(purpose: UploadPurpose, file: File): Promise<File> {
  if (purpose !== "captions") return file;

  const converted = srtToVtt(await readText(file));
  if (!converted.ok) return file;

  return new File([converted.vtt], toVttName(file.name), { type: "text/vtt" });
}

/**
 * The file's text, from whichever API this browser has.
 *
 * `Blob.prototype.text()` is the modern one and is what nearly every visitor
 * uses. `FileReader` is the fallback, and it is not hypothetical: Safari gained
 * `text()` only in 14, and jsdom — which is what the console's own tests run
 * in — does not implement it at all. Without this the conversion threw in a
 * `try` that reported it as "the upload failed", which is a message about the
 * wrong thing.
 */
async function readText(file: File): Promise<string> {
  if (typeof file.text === "function") return file.text();

  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result ?? "")));
    reader.addEventListener("error", () =>
      reject(reader.error ?? new Error("the file could not be read")),
    );
    reader.readAsText(file);
  });
}

/**
 * `untertitel.srt` → `untertitel.vtt`. The extension is a lie otherwise.
 *
 * `lastIndexOf` rather than a regular expression anchored at the end: a
 * repetition before `$` backtracks quadratically, and the input here is a
 * filename somebody chose.
 */
function toVttName(name: string): string {
  const dot = name.lastIndexOf(".");
  const stem = dot <= 0 ? name : name.slice(0, dot);
  return `${stem}.vtt`;
}

function fallbackType(purpose: UploadPurpose): string {
  return purpose === "captions"
    ? "text/vtt"
    : purpose === "material"
      ? "application/pdf"
      : purpose === "poster"
        ? "image/jpeg"
        : "video/mp4";
}

/**
 * A field that holds either a URL somebody typed or a file somebody uploaded.
 *
 * `courseSlug` is undefined only while a course is being created, before it has
 * a slug to upload against. The button says so rather than disappearing —
 * a control that vanishes is a control an author looks for.
 */
export function UploadField(props: {
  label: string;
  hint?: string;
  id: string;
  value: string;
  purpose: UploadPurpose;
  client: ApiClient;
  courseSlug: string | undefined;
  onChange: (value: string) => void;
  /** Told what the bucket stored it as; used by the material field. */
  onMimeType?: (mimeType: string) => void;
}) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const input = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | undefined>(undefined);

  const start = (file: File): void => {
    const controller = new AbortController();
    abort.current = controller;
    setState({ kind: "uploading", percent: 0 });

    void (async () => {
      try {
        const result = await runUpload(
          props.client,
          // Guarded by the caller: the button is disabled without a slug.
          props.courseSlug ?? "",
          props.purpose,
          file,
          (percent) => setState({ kind: "uploading", percent }),
          controller.signal,
        );
        props.onChange(result.reference);
        props.onMimeType?.(result.mimeType);
        setState({ kind: "idle" });
      } catch (error) {
        setState({ kind: "failed", message: messageOf(error) });
      } finally {
        abort.current = undefined;
        // So picking the same file again after a failure still fires `change`.
        if (input.current !== null) input.current.value = "";
      }
    })();
  };

  return (
    <Field
      label={props.label}
      // Spread rather than passed: `exactOptionalPropertyTypes` distinguishes
      // "absent" from "present and undefined", and `Field` accepts only the
      // first.
      {...(props.hint === undefined ? {} : { hint: props.hint })}
      htmlFor={props.id}
    >
      {isUploadedReference(props.value) ? (
        <div className="flex items-center gap-2 rounded-md border border-[color:var(--ds-hairline)] bg-[color:var(--ds-surface)] px-3 py-2">
          <span className="text-sm text-[color:var(--ds-ink)]">
            {de.uploads.stored} · {referenceName(props.value)}
          </span>
          <span className="ml-auto">
            <IconButton
              label={de.uploads.remove}
              glyph="✕"
              onClick={() => props.onChange("")}
            />
          </span>
        </div>
      ) : (
        <TextInput
          id={props.id}
          value={props.value}
          maxLength={2000}
          onChange={props.onChange}
        />
      )}

      <input
        ref={input}
        type="file"
        className="hidden"
        accept={ACCEPT[props.purpose]}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file !== undefined) start(file);
        }}
      />

      {state.kind === "uploading" ? (
        <UploadProgress percent={state.percent} onCancel={() => abort.current?.abort()} />
      ) : (
        <div className="mt-1 flex items-center gap-2">
          <Button
            variant="secondary"
            disabled={props.courseSlug === undefined}
            onClick={() => input.current?.click()}
          >
            {de.uploads.choose}
          </Button>
          {props.courseSlug === undefined ? (
            <span className="text-xs text-[color:var(--ds-ink-muted)]">
              {de.uploads.noCourseYet}
            </span>
          ) : null}
        </div>
      )}

      {state.kind === "failed" ? <Notice tone="warning">{state.message}</Notice> : null}

      <MediaPreview
        client={props.client}
        courseSlug={props.courseSlug}
        value={props.value}
        purpose={props.purpose}
      />
    </Field>
  );
}

/**
 * Show the author the file, not its name (P74-03).
 *
 * > _"for here, can we have the preview of the video, and the preview of images
 * > uploaded?"_
 *
 * Reasonable, and it was not laziness that left it out: the form holds an
 * `s3://` reference, and a browser cannot fetch one. `useReadableUrl` asks the
 * API for a short-lived signature; everything here is what to do with it.
 *
 * ## Why a poster is an `<img>` and a video is a `<video>` and a PDF is a link
 *
 * A preview is worth having when it answers the question the author actually
 * has, which differs per purpose. For an image it is "is this the right
 * picture" — one look. For a video it is "is this the right recording, and does
 * it play" — which needs controls, and is also the only way to notice before a
 * physician does that the file is silent or is the wrong take. For a PDF and a
 * caption file it is "is this the right document", and an inline PDF viewer in
 * a form is a page inside a page; a link that opens it is both smaller and
 * better.
 *
 * ## Why a failure is stated
 *
 * A blank space where a preview should be reads as an unfinished feature. It is
 * an ordinary state — no object storage on this deployment, an object removed
 * behind the reference — and saying which is not possible from here, so it says
 * what it knows: the file could not be opened, and the reference is unchanged.
 */
export function MediaPreview(props: {
  client: ApiClient;
  courseSlug: string | undefined;
  value: string;
  purpose: UploadPurpose;
}) {
  const resolved = useReadableUrl(props.client, props.courseSlug, props.value);

  if (resolved.kind === "none") return null;
  if (resolved.kind === "loading") {
    return (
      <p className="mt-2 text-xs text-[color:var(--ds-ink-muted)]">
        {de.uploads.previewLoading}
      </p>
    );
  }
  if (resolved.kind === "failed") {
    return (
      <p className="mt-2 text-xs text-amber-700" role="status">
        {de.uploads.previewFailed}
      </p>
    );
  }

  if (props.purpose === "poster") {
    return (
      <img
        src={resolved.url}
        alt={de.uploads.previewPosterAlt}
        className="mt-2 max-h-40 rounded-md border border-[color:var(--ds-hairline)] object-contain"
      />
    );
  }

  if (props.purpose === "video") {
    return (
      /*
       * `preload="metadata"` rather than `auto`: a lecture is hundreds of
       * megabytes and an author opening a form is not asking to download one.
       *
       * No `<track>`, and the WCAG obligation is not being waved away. It
       * belongs to the learner's player, which does render one, and this form
       * refuses to be quiet about a video without captions — `captionsMissing`
       * says so under the very field that supplies them. A track here would
       * point at whatever is in that field at this instant, which is usually
       * nothing and is never what this preview is being asked: is this the
       * right recording.
       */
      // eslint-disable-next-line jsx-a11y/media-has-caption -- see above
      <video
        src={resolved.url}
        controls
        preload="metadata"
        aria-label={de.uploads.previewVideoLabel}
        className="mt-2 max-h-64 w-full rounded-md border border-[color:var(--ds-hairline)] bg-black"
      />
    );
  }

  return (
    <p className="mt-2">
      <a
        href={resolved.url}
        target="_blank"
        // `noreferrer` as well as `noopener`: the URL carries a signature, and
        // a `Referer` header would send it to whatever the file links to.
        rel="noopener noreferrer"
        className="text-sm underline"
      >
        {de.uploads.previewOpen}
      </a>
    </p>
  );
}

/**
 * The bar, with a cancel.
 *
 * `role="progressbar"` with the ARIA value attributes rather than a `<progress>`
 * element: the styling has to match the rest of the console and a `<progress>`
 * is close to unstyleable across browsers. The semantics are the part that
 * matters and they are all here.
 */
export function UploadProgress(props: { percent: number; onCancel: () => void }) {
  return (
    <div className="mt-1 flex items-center gap-3">
      <div
        role="progressbar"
        aria-label={de.uploads.progress}
        aria-valuenow={props.percent}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-2 flex-1 overflow-hidden rounded-full bg-[color:var(--ds-surface)]"
      >
        <div
          className="h-full bg-[color:var(--ds-brand-500)] transition-[width]"
          style={{ width: `${props.percent}%` }}
        />
      </div>
      <span className="w-12 text-right text-xs tabular-nums text-[color:var(--ds-ink-muted)]">
        {props.percent}%
      </span>
      <Button variant="secondary" onClick={props.onCancel}>
        {de.uploads.cancel}
      </Button>
    </div>
  );
}

/**
 * What to tell the author.
 *
 * The API's problem details already carry a German `detail` written for this
 * screen — "die Datei ist zu groß", "dieses Dateiformat wird nicht
 * unterstützt". Preferring it over a generic string is the difference between
 * an author fixing the file and an author filing a ticket.
 */
function messageOf(error: unknown): string {
  if (error instanceof Error && error.message !== "") {
    // `ApiError` puts the German detail on `.message`; `uploadToTicket` throws
    // its own plain-English strings for transport failures, which are replaced
    // here because an author should never see one.
    if (error.message.includes("cancelled")) return de.uploads.cancelled;
    if (
      error.message.includes("object storage") ||
      error.message.includes("connection")
    ) {
      return de.uploads.transportFailed;
    }
    return error.message;
  }
  return de.uploads.failed;
}
