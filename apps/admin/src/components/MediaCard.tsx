/**
 * One file in the library, as a card (P88-01).
 *
 * ## Why the preview matters more here than on a form
 *
 * On a content form the author has just chosen the file and knows what it is.
 * In the library they are looking at a list of things uploaded weeks ago by
 * somebody else, whose only distinguishing feature is a generated key. A row of
 * filenames is not a media manager; it is a table of strings.
 *
 * So every card shows the file: a `<video>` for a recording, an `<img>` for a
 * picture, an `<embed>` for a PDF, and — where nothing can be shown — the type
 * and size said in words rather than a grey rectangle (§9.4).
 *
 * ## The preview is minted per card, and only when the card exists
 *
 * `useReadableAsset` asks for a signature for **this** entry. A list route that
 * returned URLs would mint one capability per file whether or not anybody
 * looked, and write an audited `read` for each — see the note on
 * `UploadService.list`. Fifty files scrolled past is fifty reads that happened;
 * fifty files listed should not be.
 *
 * ## Where the fields go, and why they are two
 *
 * `title` names the file for whoever is filing it — "Intro Modul 1". `altText`
 * describes the picture for somebody who cannot see it, which is what a screen
 * reader announces and what WCAG 1.1.1 requires. Using one for the other
 * produces alt text that reads like a filing label: it satisfies an automated
 * check and helps nobody, so the form keeps them apart and says why.
 *
 * Alt text is offered for images only. A video carries its meaning in its
 * captions track and a PDF in its own text; an `alt` on either is a field that
 * nothing renders, which is the §9.2 shape — a control that cannot do anything.
 */

import type { ApiClient, MediaAsset } from "@ds/sdk";
import { de } from "../locale/de.js";
import { useReadableAsset } from "../media-preview.js";
import { familyOf, humanBytes, type MediaLibraryState } from "../media-library.js";
import { Button, TextInput } from "./ui.js";

export function MediaCard(props: {
  client: ApiClient;
  asset: MediaAsset;
  library: MediaLibraryState;
  /** Offered by the picker, absent on the Mediathek screen itself. */
  onPick?: ((reference: string) => void) | undefined;
}) {
  const { asset, library } = props;
  const draft = library.draftFor(asset);
  const family = familyOf(asset.mimeType);
  const working = library.busy === asset.id;

  return (
    <li className="space-y-3 rounded-lg border border-[color:var(--ds-hairline)] bg-[color:var(--ds-surface)] p-3">
      <MediaThumbnail client={props.client} asset={asset} />

      <div className="space-y-1">
        <p className="break-all text-sm font-medium text-[color:var(--ds-ink)]">
          {asset.fileName}
        </p>
        <p className="text-xs text-[color:var(--ds-ink-muted)]">
          {asset.mimeType ?? de.media.unknownType} · {humanBytes(asset.byteSize)} ·{" "}
          {new Date(asset.createdAt).toLocaleDateString("de-DE")}
        </p>
        {/*
          What removing it would cost, said before the button is pressed
          (§9.4). The API refuses while anything points at the file; without
          this the operator learns that from a 409 after deciding.
        */}
        <p className="text-xs text-[color:var(--ds-ink-muted)]">
          {asset.usedByCount === 0 ? de.media.unused : de.media.usedBy(asset.usedByCount)}
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-xs">
          <span className="mb-1 block">{de.media.assetTitle}</span>
          <TextInput
            id={`ds-media-title-${asset.id}`}
            aria-label={de.media.assetTitle}
            value={draft.title}
            maxLength={200}
            /*
              Typed locally, written on blur (P88-01). The first version saved
              from `onChange` — one request per keystroke, each replacing the
              value under the cursor with the server's answer.
            */
            onChange={(title) => library.edit(asset.id, { title })}
            onBlur={() => library.commit(asset)}
          />
        </label>

        {family !== "image" ? null : (
          <label className="text-xs">
            <span className="mb-1 block">{de.media.assetAlt}</span>
            <TextInput
              id={`ds-media-alt-${asset.id}`}
              aria-label={de.media.assetAlt}
              value={draft.altText}
              maxLength={500}
              onChange={(altText) => library.edit(asset.id, { altText })}
              onBlur={() => library.commit(asset)}
            />
          </label>
        )}
      </div>

      {family !== "image" ? null : (
        <p className="text-xs text-[color:var(--ds-ink-muted)]">{de.media.altHint}</p>
      )}

      <div className="flex flex-wrap gap-2">
        {props.onPick === undefined ? null : (
          <Button onClick={() => props.onPick?.(asset.reference)} disabled={working}>
            {de.media.use}
          </Button>
        )}
        <Button
          variant="danger"
          onClick={() => library.forget(asset)}
          /*
            Refused by the API while anything points at it, and refused here
            too — a button whose only possible outcome is an error is worse
            than an absent one (§9.2). The count beside it says why.
          */
          disabled={working || asset.usedByCount > 0}
        >
          {de.media.forget}
        </Button>
      </div>
    </li>
  );
}

/**
 * The file itself, in whatever way this type can be shown.
 *
 * A fixed height so a list of mixed types does not reflow as each signature
 * arrives — a grid that jumps while it loads is unusable to click in, and every
 * card resolves at a different moment.
 */
function MediaThumbnail(props: { client: ApiClient; asset: MediaAsset }) {
  const preview = useReadableAsset(props.client, props.asset.id);
  const family = familyOf(props.asset.mimeType);

  const frame =
    "flex h-40 w-full items-center justify-center overflow-hidden rounded-md bg-[color:var(--ds-surface-sunken)]";

  if (preview.kind === "loading") {
    return (
      <div className={frame}>
        <span className="text-xs text-[color:var(--ds-ink-muted)]">{de.loading}</span>
      </div>
    );
  }

  if (preview.kind !== "ready") {
    /*
     * Named rather than blank. A grey rectangle where a picture should be is
     * indistinguishable from a feature that was never built — and the honest
     * causes here are ordinary: no object storage on this deployment, or a
     * signature the bucket refused.
     */
    return (
      <div className={frame}>
        <span className="px-3 text-center text-xs text-[color:var(--ds-ink-muted)]">
          {de.media.noPreview}
        </span>
      </div>
    );
  }

  if (family === "image") {
    return (
      <div className={frame}>
        <img
          src={preview.url}
          // The library's own alt text when it has one. Empty when it does not,
          // which is the correct claim for a thumbnail beside its own filename:
          // the name is already the accessible label for this card.
          alt={props.asset.altText ?? ""}
          className="max-h-40 max-w-full object-contain"
        />
      </div>
    );
  }

  if (family === "video" || family === "audio") {
    return (
      <div className={frame}>
        {/* eslint-disable-next-line jsx-a11y/media-has-caption -- a library thumbnail is not a lesson; captions belong to the content that uses the file */}
        <video src={preview.url} controls preload="metadata" className="max-h-40" />
      </div>
    );
  }

  if (props.asset.mimeType === "application/pdf") {
    return (
      <div className={frame}>
        <embed src={preview.url} type="application/pdf" className="h-40 w-full" />
      </div>
    );
  }

  return (
    <div className={frame}>
      <a
        href={preview.url}
        target="_blank"
        rel="noreferrer"
        className="px-3 text-center text-xs underline"
      >
        {de.media.openFile}
      </a>
    </div>
  );
}
