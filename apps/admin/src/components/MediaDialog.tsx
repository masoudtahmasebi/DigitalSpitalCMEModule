/**
 * Choosing a file, in one place (P90-01).
 *
 * ## The report this replaces
 *
 * > _"why are there 3 options? i don't get it why I have to repeat everything
 * > multiple times, just one button to select the media, and then a popup opens
 * > shows already uploaded medias for that customer, or you can upload a new
 * > one, like wordpress"_
 *
 * The three buttons were not three ways to do one thing — they were **three
 * unrelated things drawn as one row of equal buttons**: upload a file (P23-04),
 * pick one already uploaded (P81-03), and add an empty row to type an external
 * URL into. Each arrived in a different phase by the same reasoning — _this
 * screen cannot do X yet, so here is a button for X_ — and nobody afterwards
 * asked what the row adds up to.
 *
 * What WordPress gets right is not the styling. It is that the question is
 * **"which file?"**, and where the file comes from is an answer *inside* that
 * question rather than a decision to be taken before it. So: one button, one
 * dialog, three tabs.
 *
 * ## Why the URL tab is not a leftover
 *
 * It is the empty row, given a home and a label. A customer already serving
 * media from their own CDN keeps doing that, and an adaptive HLS manifest is a
 * URL rather than an upload — the hint under this control has said so since
 * P23-04. Deleting the affordance to make the dialog tidier would have removed
 * a case the platform supports.
 *
 * ## A modal has obligations, and `ui.tsx` wrote them down first
 *
 * `ConfirmButton`'s header records why the console had no dialogs:
 *
 * > _A modal has to trap focus, restore it on close, and be dismissible by
 * > Escape, and getting any of those subtly wrong makes the console unusable by
 * > keyboard._
 *
 * True, and a reason to implement them rather than to leave a media browser
 * inline: this one is a screenful of cards, not a one-sentence confirmation.
 * All three are implemented here and asserted in `MediaDialog.test.tsx`,
 * because an untested focus trap is the defect that reaches exactly the person
 * who cannot route around it.
 *
 * ## What it does not do
 *
 * It does not default to the upload tab when the library is empty. That was
 * tempting and it would make the post-deploy journey depend on how much the DS
 * Test tenant happens to hold — P89-03's mistake in a new place. The empty
 * state carries the button instead, which is the same help without the
 * non-determinism.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { mimeTypeForUrl } from "@ds/domain";
import type { ApiClient, UploadPurpose } from "@ds/sdk";
import { de } from "../locale/de.js";
import { useMediaLibrary, type MediaKind } from "../media-library.js";
import { ACCEPT, describeUploadFailure, runUpload } from "../uploads.js";
import { MediaCard } from "./MediaCard.js";
import { Button, Notice, TextInput, UploadProgress } from "./ui.js";

type Tab = "library" | "upload" | "url";

type Upload =
  | { readonly kind: "idle" }
  | { readonly kind: "busy"; readonly percent: number }
  | { readonly kind: "failed"; readonly message: string };

export function MediaDialog(props: {
  client: ApiClient;
  /** Which family of the library to list — the field's own accept rule. */
  kind: MediaKind;
  /** What an upload from here is for: the accept list and the API's purpose. */
  purpose: UploadPurpose;
  /** Absent while a course is still being created; uploading needs one. */
  courseSlug: string | undefined;
  /** Given the reference and the type the bucket stored it as. */
  onPick: (reference: string, mimeType: string) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("library");

  return (
    <Modal label={de.media.dialogTitle} onClose={props.onClose}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold text-[color:var(--ds-ink)]">
          {de.media.dialogTitle}
        </h2>
        <Button variant="secondary" onClick={props.onClose}>
          {de.media.close}
        </Button>
      </div>

      <div
        role="tablist"
        aria-label={de.media.tabsLabel}
        className="mt-3 flex flex-wrap gap-2 border-b border-[color:var(--ds-hairline)]"
      >
        {(["library", "upload", "url"] as const).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
              tab === id
                ? "border-brand-600 text-brand-700"
                : "border-transparent text-gray-700 hover:text-brand-700"
            }`}
          >
            {de.media.tabs[id]}
          </button>
        ))}
      </div>

      <div className="mt-3">
        {tab === "library" ? (
          <LibraryTab
            client={props.client}
            kind={props.kind}
            onPick={(reference) =>
              props.onPick(reference, mimeTypeForUrl(reference) ?? "")
            }
            onUploadInstead={() => setTab("upload")}
          />
        ) : tab === "upload" ? (
          <UploadTab
            client={props.client}
            purpose={props.purpose}
            courseSlug={props.courseSlug}
            onUploaded={props.onPick}
          />
        ) : (
          <UrlTab onSubmit={(url) => props.onPick(url, mimeTypeForUrl(url) ?? "")} />
        )}
      </div>
    </Modal>
  );
}

/**
 * The library, as the dialog's first tab.
 *
 * The cards are the Mediathek screen's own — same component, same
 * `useMediaLibrary` — so a rename made here is the rename made there, and
 * neither can develop its own idea of when a field is saved (P88-01).
 *
 * The search is client-side over the loaded page, as on the screen. Honest at a
 * customer's volume and stated as such; if a library outgrows it the fix is
 * paging in the API rather than a cleverer filter here.
 */
function LibraryTab(props: {
  client: ApiClient;
  kind: MediaKind;
  onPick: (reference: string) => void;
  onUploadInstead: () => void;
}) {
  const library = useMediaLibrary(props.client, props.kind);
  const [search, setSearch] = useState("");

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
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs">
          <span className="mb-1 block">{de.media.search}</span>
          <TextInput
            id="ds-media-dialog-search"
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
         * Two empty states, told apart, and the first one carries the way out
         * (§9.4). "You have uploaded nothing yet" is the state a customer's
         * very first course opens in, and a shelf with nothing on it and no
         * button reads as a broken list.
         */
        <div className="space-y-2">
          <p className="text-sm text-[color:var(--ds-ink-muted)]">
            {library.assets.length === 0 ? de.media.empty : de.media.noMatch}
          </p>
          {library.assets.length === 0 ? (
            <Button onClick={props.onUploadInstead}>{de.media.tabs.upload}</Button>
          ) : null}
        </div>
      ) : (
        <ul className="grid max-h-[26rem] gap-3 overflow-y-auto sm:grid-cols-2">
          {(shown ?? []).map((asset) => (
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
    </div>
  );
}

/**
 * Uploading, from inside the dialog.
 *
 * The three-step upload is unchanged and still `runUpload`: a ticket from the
 * API, the bytes straight to the bucket over a signed URL, then the API
 * confirming the object landed. What moved is only where the control lives.
 *
 * The file input is **visible and labelled** rather than a hidden input behind
 * a button. A hidden input is what the browser suite reaches for anyway, and a
 * visible one is the drop target's own label — one control instead of two that
 * have to agree.
 */
function UploadTab(props: {
  client: ApiClient;
  purpose: UploadPurpose;
  courseSlug: string | undefined;
  onUploaded: (reference: string, mimeType: string) => void;
}) {
  const [state, setState] = useState<Upload>({ kind: "idle" });
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | undefined>(undefined);

  const start = useCallback(
    (file: File): void => {
      if (props.courseSlug === undefined) return;

      const controller = new AbortController();
      abort.current = controller;
      setState({ kind: "busy", percent: 0 });

      void (async () => {
        try {
          const result = await runUpload(
            props.client,
            props.courseSlug ?? "",
            props.purpose,
            file,
            (percent) => setState({ kind: "busy", percent }),
            controller.signal,
          );
          setState({ kind: "idle" });
          props.onUploaded(result.reference, result.mimeType);
        } catch (error) {
          setState({ kind: "failed", message: describeUploadFailure(error) });
        } finally {
          abort.current = undefined;
          // So picking the same file again after a failure still fires `change`.
          if (input.current !== null) input.current.value = "";
        }
      })();
    },
    [props],
  );

  if (state.kind === "busy") {
    return (
      <UploadProgress
        percent={state.percent}
        label={de.uploads.progress}
        cancelLabel={de.uploads.cancel}
        onCancel={() => abort.current?.abort()}
      />
    );
  }

  return (
    <div className="space-y-3">
      {props.courseSlug === undefined ? (
        /*
         * Said, not hidden (§9.2/§9.4). Uploading needs a course to upload
         * against; the library tab beside this one does not, and works. A
         * control that vanishes is a control somebody looks for.
         */
        <Notice tone="warning">{de.uploads.noCourseYet}</Notice>
      ) : null}

      <div
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          const file = event.dataTransfer.files[0];
          if (file !== undefined) start(file);
        }}
        className={`rounded-lg border-2 border-dashed p-6 text-center ${
          over
            ? "border-brand-600 bg-[color:var(--ds-surface-sunken)]"
            : "border-[color:var(--ds-hairline)]"
        }`}
      >
        <label className="block text-sm font-medium text-[color:var(--ds-ink)]">
          <span className="mb-2 block">{de.media.dropHere}</span>
          <input
            ref={input}
            type="file"
            accept={ACCEPT[props.purpose]}
            disabled={props.courseSlug === undefined}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file !== undefined) start(file);
            }}
            className="mx-auto block text-sm"
          />
        </label>
      </div>

      <p className="text-xs text-[color:var(--ds-ink-muted)]">
        {de.media.uploadHints[props.purpose]}
      </p>

      {state.kind === "failed" ? <Notice tone="warning">{state.message}</Notice> : null}
    </div>
  );
}

/**
 * A file this platform does not host.
 *
 * This is the old "Videoquelle hinzufügen" empty row, with a label saying what
 * belongs in it. The row it produced said nothing at all, so the only way to
 * learn it wanted a URL was to type into it and find out.
 */
function UrlTab(props: { onSubmit: (url: string) => void }) {
  const [url, setUrl] = useState("");
  const trimmed = url.trim();

  return (
    <div className="space-y-3">
      <label className="block text-sm">
        <span className="mb-1 block font-medium">{de.media.urlLabel}</span>
        <TextInput
          id="ds-media-dialog-url"
          value={url}
          maxLength={2000}
          onChange={setUrl}
        />
      </label>
      <p className="text-xs text-[color:var(--ds-ink-muted)]">{de.media.urlHint}</p>
      <Button disabled={trimmed === ""} onClick={() => props.onSubmit(trimmed)}>
        {de.media.urlSubmit}
      </Button>
    </div>
  );
}

/**
 * The modal shell: Escape, a focus trap, and focus restored on close.
 *
 * `useRef` for what had focus before, captured on mount rather than read on
 * unmount — by then it is whatever the browser fell back to, usually `<body>`,
 * and restoring that leaves a keyboard user at the top of the document with no
 * idea where they were.
 *
 * The trap is a Tab handler rather than `inert` on everything else: `inert`
 * needs a polyfill in the browsers this console supports, and the wrapping
 * behaviour is what people actually notice.
 */
function Modal(props: { label: string; onClose: () => void; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  const restoreTo = useRef<Element | null>(null);

  useEffect(() => {
    restoreTo.current = document.activeElement;
    panel.current?.focus();

    const body = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = body;
      const previous = restoreTo.current;
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8"
      onMouseDown={(event) => {
        // The backdrop, and only the backdrop: `onMouseDown` on the overlay
        // fires for clicks inside the panel too, and closing the dialog because
        // somebody started selecting text in it is a lost draft.
        if (event.target === event.currentTarget) props.onClose();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={props.label}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            props.onClose();
            return;
          }
          if (event.key !== "Tab") return;

          const focusable = [
            ...(panel.current?.querySelectorAll<HTMLElement>(
              'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
            ) ?? []),
          ];
          const first = focusable[0];
          const last = focusable.at(-1);
          if (first === undefined || last === undefined) return;

          const active = document.activeElement;
          if (event.shiftKey && (active === first || active === panel.current)) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && active === last) {
            event.preventDefault();
            first.focus();
          }
        }}
        className="w-full max-w-3xl rounded-lg border border-[color:var(--ds-hairline)] bg-[color:var(--ds-surface)] p-4 shadow-xl"
      >
        {props.children}
      </div>
    </div>
  );
}
