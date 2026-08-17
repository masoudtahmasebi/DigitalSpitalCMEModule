/**
 * The Mediathek, as a control (P81-03, rebuilt on the shared library P88-01).
 *
 * ## Why this exists
 *
 * Asked for directly: _"we should also have a mediathek-library section for all
 * of the files a customer have uploaded … anywhere which is hochladen we should
 * be able to use this."_
 *
 * The cost of not having it was concrete: an introduction video uploaded once
 * could not be used in a second course without uploading it again, because the
 * only way to reuse a file was to remember its key. That is how a bucket
 * accumulates six copies of one recording, none of them replaceable in one
 * place.
 *
 * ## Why it is a picker *as well as* a page
 *
 * A Mediathek screen you have to visit, copy a reference out of, and paste into
 * a form is not reuse — it is the same remembering, with extra steps. So this
 * opens *where the upload button already is*, and choosing a file assigns its
 * reference exactly as completing an upload would.
 *
 * The screen (`MediaLibrary`) is the other half, and it is not a duplicate:
 * renaming a batch, writing the alt text somebody skipped, or clearing out a
 * cancelled course are not things that happen inside a content form. Both read
 * the same `useMediaLibrary`, so a rename made in one is the rename made in the
 * other, and neither can develop its own idea of when a field is saved.
 *
 * ## What deletion means here, and what it does not
 *
 * It forgets the library entry. The object stays in storage, because an object
 * can be referenced by a course this tenant sees and by an archived certificate
 * it does not, and destroying bytes belongs to the erasure path with its own
 * audit trail (ADR-0004).
 */

import type { ApiClient } from "@ds/sdk";
import { de } from "../locale/de.js";
import { useMediaLibrary, type MediaKind } from "../media-library.js";
import { MediaCard } from "./MediaCard.js";
import { Button, Notice } from "./ui.js";

export type { MediaKind };

export function MediaPicker(props: {
  client: ApiClient;
  /** Restricts the list to what this field could actually accept. */
  kind: MediaKind;
  /** Called with the `s3://…` reference, exactly as an upload would return it. */
  onPick: (reference: string) => void;
  onClose: () => void;
}) {
  const library = useMediaLibrary(props.client, props.kind);

  return (
    <section
      className="space-y-3 rounded-md border border-[color:var(--ds-hairline)] p-3"
      aria-label={de.media.title}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">{de.media.title}</h3>
        <Button variant="secondary" onClick={props.onClose}>
          {de.media.close}
        </Button>
      </div>

      <p className="text-xs text-[color:var(--ds-ink-muted)]">{de.media.intro}</p>

      {library.problem === undefined ? null : (
        <Notice tone="error">{library.problem}</Notice>
      )}

      {library.assets === undefined ? (
        <p className="text-sm text-[color:var(--ds-ink-muted)]">{de.loading}</p>
      ) : library.assets.length === 0 ? (
        /*
         * Not an error, and worth saying out loud: a customer who has uploaded
         * nothing yet sees this on their very first course, and "no files" with
         * no explanation reads as a broken list (§9.4).
         */
        <p className="text-sm text-[color:var(--ds-ink-muted)]">{de.media.empty}</p>
      ) : (
        <ul className="grid max-h-[28rem] gap-3 overflow-y-auto sm:grid-cols-2">
          {library.assets.map((asset) => (
            <MediaCard
              key={asset.id}
              client={props.client}
              asset={asset}
              library={library}
              onPick={props.onPick}
            />
          ))}
        </ul>
      )}

      <p className="text-xs text-[color:var(--ds-ink-muted)]">{de.media.forgetHint}</p>
    </section>
  );
}
