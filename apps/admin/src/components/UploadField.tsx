/**
 * A field that holds a file (P23-04, rebuilt on one button in P90-01).
 *
 * Until P23-04 the course editor took a URL and only a URL, which meant
 * somebody had to already have the video hosted somewhere — the reported
 * version of that was "how can I upload a video?!".
 *
 * ## Why there is one button now and there were two
 *
 * "Datei hochladen" and "Aus Mediathek wählen" sat side by side, and a poster
 * field, a subtitle field and a material field each drew both. The client, three
 * phases later:
 *
 * > _"why are there 3 options? … just one button to select the media, and then a
 * > popup opens shows already uploaded medias for that customer, or you can
 * > upload a new one, like wordpress"_
 *
 * The question a person has here is **which file**, and whether it is already
 * uploaded is an answer inside that question rather than a decision to take
 * before it. So the button says _Medien auswählen_ and the dialog holds both —
 * see `MediaDialog`.
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

import { useState } from "react";
import type { ApiClient, UploadPurpose } from "@ds/sdk";
import { de } from "../locale/de.js";
import { useReadableUrl } from "../media-preview.js";
import { isUploadedReference, LIBRARY_KIND, referenceName } from "../uploads.js";
import { MediaDialog } from "./MediaDialog.js";
import { Button, Field, IconButton, TextInput } from "./ui.js";

export { isUploadedReference, referenceName } from "../uploads.js";

/**
 * A field that holds either a URL somebody typed or a file somebody uploaded.
 *
 * `courseSlug` is undefined only while a course is being created, before it has
 * a slug to upload against. The dialog still opens — its library tab needs no
 * course, because choosing an already-stored file is assigning a string — and
 * its upload tab says why it cannot run yet.
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
  const [dialogOpen, setDialogOpen] = useState(false);

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

      <div className="mt-1">
        <Button variant="secondary" onClick={() => setDialogOpen(true)}>
          {de.media.choose}
        </Button>
      </div>

      {!dialogOpen ? null : (
        <MediaDialog
          client={props.client}
          kind={LIBRARY_KIND[props.purpose]}
          purpose={props.purpose}
          courseSlug={props.courseSlug}
          onPick={(reference, mimeType) => {
            props.onChange(reference);
            if (mimeType !== "") props.onMimeType?.(mimeType);
            setDialogOpen(false);
          }}
          onClose={() => setDialogOpen(false)}
        />
      )}

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
