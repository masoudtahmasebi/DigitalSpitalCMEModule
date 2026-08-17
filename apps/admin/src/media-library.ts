/**
 * The customer's media library, as state (P88-01).
 *
 * ## Why this is a module and not a component
 *
 * The library is looked at in two places — the **Mediathek screen**, where an
 * operator files and tidies, and the **picker**, which opens beside an upload
 * button so a file can be reused without uploading it again. Both load the same
 * list, rename the same entries, write the same alt text and remove the same
 * rows; only the action at the end differs.
 *
 * Written twice, the two would drift, and the way they drift is not cosmetic:
 * one of them ends up saving on a different event from the other, and an
 * operator who learned the screen finds the picker discards what they typed.
 *
 * ## Typing is not saving
 *
 * The first version of the picker called `PATCH /admin/media/{id}` from the
 * input's `onChange` — **one request per keystroke**, each answering with the
 * server's row, which then replaced the value under the cursor. A twenty
 * character title was twenty round trips racing the typist, and the field
 * fought back.
 *
 * So the draft lives here, keyed by asset, and is written when the field is
 * *finished with* — blur, or Enter. Nothing is lost by closing a picker
 * mid-edit: choosing a file blurs the field first, so the pending rename is
 * written on the way out.
 *
 * ## What "remove" means, and what it does not
 *
 * It forgets the library entry. The object stays in storage, because an object
 * may be referenced by a course this tenant sees and by an archived certificate
 * it does not, and destroying bytes belongs to the erasure path with its own
 * audit trail (ADR-0004). The API refuses entirely while a course content still
 * points at the file, and now says so *before* the button is pressed: every row
 * carries `usedByCount`.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient, MediaAsset } from "@ds/sdk";
import { de } from "./locale/de.js";
import { describeError } from "./api.js";

/**
 * Which files to offer.
 *
 * The first token of a MIME type, matching the API's filter. A poster field
 * asks for `image` and a source field for `video`, so the list somebody scrolls
 * is the list that could answer their question — offering a PDF where a poster
 * belongs is the §9.2 shape in miniature.
 *
 * `undefined` means everything, which is what the Mediathek screen and a
 * material field both want.
 */
export type MediaKind = "video" | "image" | "audio" | "application" | "text" | undefined;

/** The editable half of an entry, held locally until it is finished with. */
export interface MediaDraft {
  readonly title: string;
  readonly altText: string;
}

export interface MediaLibraryState {
  /** `undefined` while the first load is in flight — not the same as empty. */
  readonly assets: readonly MediaAsset[] | undefined;
  readonly problem: string | undefined;
  /** The id of the entry currently being written, if any. */
  readonly busy: string | undefined;
  /** What is in the fields right now, which may differ from what is stored. */
  readonly draftFor: (asset: MediaAsset) => MediaDraft;
  readonly edit: (id: string, change: Partial<MediaDraft>) => void;
  /** Write a draft if it differs from what is stored. Called on blur. */
  readonly commit: (asset: MediaAsset) => void;
  readonly forget: (asset: MediaAsset) => void;
  readonly reload: () => void;
}

export function useMediaLibrary(client: ApiClient, kind: MediaKind): MediaLibraryState {
  const [assets, setAssets] = useState<readonly MediaAsset[] | undefined>();
  const [problem, setProblem] = useState<string | undefined>();
  const [busy, setBusy] = useState<string | undefined>();
  const [drafts, setDrafts] = useState<Readonly<Record<string, MediaDraft>>>({});

  /**
   * Whether this hook is still mounted.
   *
   * A picker is closed by choosing a file, which unmounts it while the reload
   * it triggered is still in flight. Without this the resolution sets state on
   * a component that is gone — harmless in React 18, and still a warning that
   * trains people to ignore warnings.
   */
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const reload = useCallback(() => {
    client.adminListMedia(kind === undefined ? {} : { kind }).then(
      (rows) => {
        if (live.current) setAssets(rows);
      },
      (error: unknown) => {
        if (live.current) setProblem(describeError(error, de.error.generic));
      },
    );
  }, [client, kind]);

  useEffect(reload, [reload]);

  const draftFor = useCallback(
    (asset: MediaAsset): MediaDraft =>
      drafts[asset.id] ?? { title: asset.title ?? "", altText: asset.altText ?? "" },
    [drafts],
  );

  const edit = useCallback(
    (id: string, change: Partial<MediaDraft>) => {
      setDrafts((current) => {
        const asset = (assets ?? []).find((entry) => entry.id === id);
        const base = current[id] ?? {
          title: asset?.title ?? "",
          altText: asset?.altText ?? "",
        };
        return { ...current, [id]: { ...base, ...change } };
      });
    },
    [assets],
  );

  const commit = useCallback(
    (asset: MediaAsset) => {
      const draft = drafts[asset.id];
      if (draft === undefined) return;

      // Nothing changed — do not spend a request, an audit row and a re-render
      // on a field somebody tabbed through.
      if (
        draft.title === (asset.title ?? "") &&
        draft.altText === (asset.altText ?? "")
      ) {
        setDrafts((current) => omit(current, asset.id));
        return;
      }

      setBusy(asset.id);
      setProblem(undefined);
      client
        .adminDescribeMedia(asset.id, { title: draft.title, altText: draft.altText })
        .then(
          (updated) => {
            if (!live.current) return;
            setAssets((current) =>
              (current ?? []).map((entry) => (entry.id === updated.id ? updated : entry)),
            );
            setDrafts((current) => omit(current, asset.id));
          },
          (error: unknown) => {
            if (!live.current) return;
            /*
             * The draft is **kept** on failure, deliberately.
             *
             * Clearing it would restore the stored value under the cursor and
             * lose what somebody typed, at the exact moment they most need it
             * back — a refused save is when the text is least reproducible.
             */
            setProblem(describeError(error, de.error.generic));
          },
        )
        .finally(() => {
          if (live.current) setBusy(undefined);
        });
    },
    [client, drafts],
  );

  const forget = useCallback(
    (asset: MediaAsset) => {
      setBusy(asset.id);
      setProblem(undefined);
      client
        .adminForgetMedia(asset.id)
        .then(
          () => {
            if (!live.current) return;
            setAssets((current) =>
              (current ?? []).filter((entry) => entry.id !== asset.id),
            );
            setDrafts((current) => omit(current, asset.id));
          },
          (error: unknown) => {
            // The 409 names how many contents still use it, which is exactly
            // what somebody needs in order to go and unpick it. Shown as it
            // arrives.
            if (live.current) setProblem(describeError(error, de.error.generic));
          },
        )
        .finally(() => {
          if (live.current) setBusy(undefined);
        });
    },
    [client],
  );

  return { assets, problem, busy, draftFor, edit, commit, forget, reload };
}

function omit<T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> {
  const { [key]: _removed, ...rest } = record;
  return rest;
}

/**
 * A byte count as an operator reads it.
 *
 * Binary units with German decimal separators, because the console is German
 * first and "1.4 MB" beside "1,4 MB" on the same screen reads as two different
 * numbers. Bytes below a kilobyte are printed as bytes rather than "0,0 KB",
 * which is a real case: a WebVTT file with two cues.
 */
export function humanBytes(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < 1024) return de.media.bytes(bytes);

  const units = ["KB", "MB", "GB", "TB"] as const;
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1).replace(".", ",")} ${units[unit] ?? "KB"}`;
}

/**
 * The broad family of a file, for the filter chips and the preview.
 *
 * Derived from the MIME type's first token, which is what the API indexes and
 * filters on — one rule, so a chip labelled "Bilder" selects exactly the rows
 * the server would return for `kind=image`.
 */
export function familyOf(mimeType: string | null): MediaKind {
  const first = (mimeType ?? "").split("/")[0]?.trim().toLowerCase() ?? "";
  return first === "video" ||
    first === "image" ||
    first === "audio" ||
    first === "application" ||
    first === "text"
    ? first
    : undefined;
}
