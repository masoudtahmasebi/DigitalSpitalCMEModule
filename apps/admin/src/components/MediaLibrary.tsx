/**
 * The Mediathek, as a screen (P88-01).
 *
 * ## Why the picker was not enough
 *
 * P81-03 built the library as a control that opens beside an upload button, on
 * the reasoning that _"a Mediathek screen you have to visit, copy a reference
 * out of, and paste into a form is not reuse — it is the same remembering, with
 * extra steps."_ That is still true of *reuse*, and it is why the picker
 * stays.
 *
 * It is not true of everything else somebody does with files. Renaming a batch
 * after a colleague uploaded them, writing the alt text that was skipped,
 * finding out which recording is taking four hundred megabytes, clearing out a
 * draft course's leftovers — none of those is happening inside a content form,
 * and until this screen the only way to reach any of them was to open a course,
 * begin adding a video, and use the picker as a side door. The controls existed
 * and the place to use them did not, which is CLAUDE.md §9.8: a state a person
 * can be in with no address of its own.
 *
 * ## Every kind, not only video
 *
 * The picker is opened by a field that wants one kind, so it filters to it. This
 * screen is the customer's whole library — recordings, images, PDFs, subtitle
 * files — and the filter is a control rather than a constraint. The chips are
 * derived from the same MIME first token the API indexes on, so a chip labelled
 * _Bilder_ selects exactly the rows `kind=image` returns; a second client-side
 * rule would eventually disagree with the server's.
 *
 * ## Removing is refused before it is offered
 *
 * Every row carries `usedByCount`, so the button is disabled while a course
 * still points at the file and the count beside it says why. The API refuses
 * either way — that is the gate — but a control whose only possible outcome is
 * an error is worse than an absent one (§9.2), and "in 3 Inhalten verwendet" is
 * what somebody needs in order to go and unpick it.
 */

import { useMemo, useState } from "react";
import type { ApiClient } from "@ds/sdk";
import { de } from "../locale/de.js";
import { humanBytes, useMediaLibrary, type MediaKind } from "../media-library.js";
import { MediaCard } from "./MediaCard.js";
import { Button, Notice, TextInput } from "./ui.js";

/**
 * The filter chips, in the order an operator is likely to want them.
 *
 * `undefined` first — the default is everything, because somebody arriving at
 * the Mediathek is usually looking for a file rather than for a category.
 */
const KINDS: ReadonlyArray<readonly [MediaKind, keyof typeof de.media.kinds]> = [
  [undefined, "all"],
  ["video", "video"],
  ["image", "image"],
  ["application", "document"],
  ["text", "captions"],
  ["audio", "audio"],
];

export function MediaLibrary(props: { client: ApiClient }) {
  const [kind, setKind] = useState<MediaKind>(undefined);
  const [search, setSearch] = useState("");
  const library = useMediaLibrary(props.client, kind);

  /**
   * The rows this filter and this search leave.
   *
   * The **kind** is the server's filter and the **search** is this screen's:
   * a customer's library is bounded by what they have uploaded, so narrowing a
   * loaded page by name locally is honest and instant, where a round trip per
   * keystroke would not be. If a library ever grows past the page size, the
   * fix is paging in the API rather than a smarter filter here.
   */
  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (needle === "") return library.assets;
    return (library.assets ?? []).filter((asset) =>
      [asset.fileName, asset.title ?? "", asset.mimeType ?? ""].some((field) =>
        field.toLowerCase().includes(needle),
      ),
    );
  }, [library.assets, search]);

  return (
    <div className="space-y-4">
      <p className="text-sm text-[color:var(--ds-ink-muted)]">{de.media.screenIntro}</p>

      <div className="flex flex-wrap items-end gap-3">
        <div
          role="group"
          aria-label={de.media.filterLabel}
          className="flex flex-wrap gap-2"
        >
          {KINDS.map(([value, label]) => (
            <button
              key={label}
              type="button"
              // `aria-pressed` rather than a styled div: this is a toggle, and a
              // screen reader has to be able to hear which one is on.
              aria-pressed={kind === value}
              onClick={() => setKind(value)}
              className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                kind === value
                  ? "bg-brand-600 text-white"
                  : "border border-gray-300 text-gray-800 hover:bg-gray-50"
              }`}
            >
              {de.media.kinds[label]}
            </button>
          ))}
        </div>

        <label className="text-xs">
          <span className="mb-1 block">{de.media.search}</span>
          <TextInput
            id="ds-media-search"
            value={search}
            maxLength={200}
            onChange={setSearch}
          />
        </label>

        <Button variant="secondary" onClick={library.reload}>
          {de.media.refresh}
        </Button>
      </div>

      {library.problem === undefined ? null : (
        <Notice tone="error">{library.problem}</Notice>
      )}

      {library.assets === undefined ? (
        <p className="text-sm text-[color:var(--ds-ink-muted)]">{de.loading}</p>
      ) : (shown ?? []).length === 0 ? (
        /*
         * Two different empty states, and telling them apart is the point.
         * "Nothing matches this filter" is a thing to undo; "you have not
         * uploaded anything yet" is a thing to explain (§9.4).
         */
        <p className="text-sm text-[color:var(--ds-ink-muted)]">
          {library.assets.length === 0 ? de.media.empty : de.media.noMatch}
        </p>
      ) : (
        <>
          <p className="text-xs text-[color:var(--ds-ink-muted)]">
            {de.media.count((shown ?? []).length, library.assets.length)}
          </p>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(shown ?? []).map((asset) => (
              <MediaCard
                key={asset.id}
                client={props.client}
                asset={asset}
                library={library}
              />
            ))}
          </ul>
        </>
      )}

      <p className="text-xs text-[color:var(--ds-ink-muted)]">{de.media.forgetHint}</p>

      {/*
        The storage total, which is the question an operator brings to this
        screen that no individual row answers. Computed from what is loaded and
        said as such — a figure claiming to be the bucket's would be wrong, since
        the library indexes what the console uploaded and the bucket also holds
        archived certificates nobody lists here.
      */}
      {library.assets === undefined || library.assets.length === 0 ? null : (
        <p className="text-xs text-[color:var(--ds-ink-muted)]">
          {de.media.totalSize(humanBytes(totalBytes(library.assets)))}
        </p>
      )}
    </div>
  );
}

function totalBytes(assets: readonly { byteSize: number | null }[]): number {
  return assets.reduce((sum, asset) => sum + (asset.byteSize ?? 0), 0);
}
