/**
 * The Mediathek, as a control (P81-03).
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
 * ## Why it is a picker and not a page
 *
 * A Mediathek screen you have to visit, copy a reference out of, and paste into
 * a form is not reuse — it is the same remembering, with extra steps. So this
 * is the thing that opens *where the upload button already is*, and choosing a
 * file assigns its reference exactly as completing an upload would. The two
 * paths end in the same place, which is what lets every caller treat them the
 * same.
 *
 * ## Accessibility is the reason the entries have fields at all
 *
 * An `<img>` with no alt text is a WCAG 1.1.1 failure, and until this screen
 * there was nowhere to put one — the bucket holds bytes and has no opinion
 * about what they depict. `title` and `altText` are separate on purpose and the
 * form says why: a title names the file for whoever is filing it, alt text
 * describes it for somebody who cannot see it, and using one for the other
 * produces alt text that reads like a filing label.
 *
 * ## What deletion means here, and what it does not
 *
 * It forgets the library entry. The object stays in storage, because an object
 * can be referenced by a course this tenant sees and by an archived certificate
 * it does not, and destroying bytes belongs to the erasure path with its own
 * audit trail (ADR-0004). The screen says that rather than implying the file is
 * gone — and the API refuses entirely while a course content still points at
 * it, naming how many.
 */

import { useCallback, useEffect, useState } from "react";
import type { ApiClient, MediaAsset } from "@ds/sdk";
import { de } from "../locale/de.js";
import { describeError } from "../api.js";
import { Button, Notice, TextInput } from "./ui.js";

/**
 * Which files to offer.
 *
 * The first token of a MIME type, matching the API's filter. A poster field
 * asks for `image` and a source field for `video`, so the list a person scrolls
 * is the list that could answer their question — offering a PDF where a poster
 * belongs is the §9.2 shape in miniature.
 *
 * `undefined` means everything, which is what a material field wants.
 */
export type MediaKind = "video" | "image" | "audio" | "application" | undefined;

export function MediaPicker(props: {
  client: ApiClient;
  /** Restricts the list. See `MediaKind`. */
  kind: MediaKind;
  /** Called with the `s3://…` reference, exactly as an upload would return it. */
  onPick: (reference: string) => void;
  onClose: () => void;
}) {
  const { client, kind, onPick, onClose } = props;

  const [assets, setAssets] = useState<readonly MediaAsset[] | undefined>();
  const [problem, setProblem] = useState<string | undefined>();
  const [busy, setBusy] = useState<string | undefined>();

  const load = useCallback(() => {
    client.adminListMedia(kind === undefined ? {} : { kind }).then(
      (rows) => setAssets(rows),
      (error: unknown) => setProblem(describeError(error, de.error.generic)),
    );
  }, [client, kind]);

  useEffect(load, [load]);

  async function describe(
    asset: MediaAsset,
    change: { title?: string; altText?: string },
  ): Promise<void> {
    setBusy(asset.id);
    setProblem(undefined);
    try {
      const updated = await client.adminDescribeMedia(asset.id, {
        title: change.title ?? asset.title ?? "",
        altText: change.altText ?? asset.altText ?? "",
      });
      setAssets((current) =>
        (current ?? []).map((entry) => (entry.id === updated.id ? updated : entry)),
      );
    } catch (error) {
      setProblem(describeError(error, de.error.generic));
    } finally {
      setBusy(undefined);
    }
  }

  async function forget(asset: MediaAsset): Promise<void> {
    setBusy(asset.id);
    setProblem(undefined);
    try {
      await client.adminForgetMedia(asset.id);
      setAssets((current) => (current ?? []).filter((entry) => entry.id !== asset.id));
    } catch (error) {
      // The 409 names how many contents still use it, which is exactly what
      // somebody needs in order to go and unpick it. Shown as it arrives.
      setProblem(describeError(error, de.error.generic));
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <section
      className="space-y-3 rounded-md border border-[color:var(--ds-hairline)] p-3"
      aria-label={de.media.title}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">{de.media.title}</h3>
        <Button variant="secondary" onClick={onClose}>
          {de.media.close}
        </Button>
      </div>

      <p className="text-xs text-[color:var(--ds-ink-muted)]">{de.media.intro}</p>

      {problem === undefined ? null : <Notice tone="error">{problem}</Notice>}

      {assets === undefined ? (
        <p className="text-sm text-[color:var(--ds-ink-muted)]">{de.loading}</p>
      ) : assets.length === 0 ? (
        /*
         * Not an error, and worth saying out loud: a customer who has uploaded
         * nothing yet sees this on their very first course, and "no files" with
         * no explanation reads as a broken list (§9.4).
         */
        <p className="text-sm text-[color:var(--ds-ink-muted)]">{de.media.empty}</p>
      ) : (
        <ul className="space-y-2">
          {assets.map((asset) => (
            <li
              key={asset.id}
              className="space-y-2 rounded-md border border-[color:var(--ds-hairline)] p-2"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm font-medium">{asset.fileName}</span>
                <span className="text-xs text-[color:var(--ds-ink-muted)]">
                  {asset.mimeType ?? de.media.unknownType}
                </span>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <label className="text-xs">
                  <span className="mb-1 block">{de.media.assetTitle}</span>
                  <TextInput
                    id={`ds-media-title-${asset.id}`}
                    aria-label={de.media.assetTitle}
                    value={asset.title ?? ""}
                    maxLength={200}
                    onChange={(title) => void describe(asset, { title })}
                  />
                </label>
                <label className="text-xs">
                  <span className="mb-1 block">{de.media.assetAlt}</span>
                  <TextInput
                    id={`ds-media-alt-${asset.id}`}
                    aria-label={de.media.assetAlt}
                    value={asset.altText ?? ""}
                    maxLength={500}
                    onChange={(altText) => void describe(asset, { altText })}
                  />
                </label>
              </div>
              <p className="text-xs text-[color:var(--ds-ink-muted)]">
                {de.media.altHint}
              </p>

              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() => onPick(asset.reference)}
                  disabled={busy === asset.id}
                >
                  {de.media.use}
                </Button>
                <Button
                  variant="danger"
                  onClick={() => void forget(asset)}
                  disabled={busy === asset.id}
                >
                  {de.media.forget}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-[color:var(--ds-ink-muted)]">{de.media.forgetHint}</p>
    </section>
  );
}
