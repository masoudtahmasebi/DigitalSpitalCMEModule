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
import type { ApiClient, UploadPurpose } from "@ds/sdk";
import { uploadToTicket } from "@ds/sdk";
import { de } from "../locale/de.js";
import { Button, Field, IconButton, Notice, TextInput } from "./ui.js";

/** What a file picker should offer per purpose. Mirrors `UPLOAD_TYPES`. */
const ACCEPT: Readonly<Record<UploadPurpose, string>> = {
  video: "video/mp4,video/webm,audio/mpeg,audio/mp4",
  captions: "text/vtt,.vtt",
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
  file: File,
  onProgress: (percent: number) => void,
  signal: AbortSignal,
): Promise<{ reference: string; mimeType: string }> {
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
    </Field>
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
