/**
 * The one dialog behind the one button (P90-01).
 *
 * ## What this inherits
 *
 * `MediaPicker.test.tsx` pinned the properties of the inline panel this
 * replaces: that choosing hands back the reference an upload would have
 * produced, that a field asks the API only for files that could answer its
 * question, that an empty library is explained rather than blank, and that the
 * 409 naming how many contents still use a file is shown rather than swallowed.
 * The panel is gone; every one of those is still a property, so they are here.
 *
 * ## And what is new, and is the reason this file is not a rename
 *
 * The console had no modal before this, on the reasoning recorded in `ui.tsx`:
 *
 * > _A modal has to trap focus, restore it on close, and be dismissible by
 * > Escape, and getting any of those subtly wrong makes the console unusable by
 * > keyboard._
 *
 * Each of the three is asserted below. They are the ones nobody notices are
 * missing — a mouse user never finds out that Tab leaves the dialog, and the
 * person who does find out is the one who cannot work around it.
 */

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, type ApiClient, type MediaAsset } from "@ds/sdk";
import { MediaDialog } from "./MediaDialog.js";
import { de } from "../locale/de.js";
import type * as UploadsModule from "../uploads.js";

afterEach(cleanup);

const ASSET: MediaAsset = {
  id: "aaaaaaaa-0000-4000-8000-00000000000a",
  reference: "s3://cust/courses/c1/video-9f2c3d.mp4",
  fileName: "Intro Modul 1.mp4",
  mimeType: "video/mp4",
  byteSize: 1024,
  title: null,
  altText: null,
  createdAt: "2026-08-17T10:00:00.000Z",
  usedByCount: 0,
};

function client(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    adminListMedia: vi.fn(async () => [ASSET]),
    adminDescribeMedia: vi.fn(async () => ASSET),
    adminForgetMedia: vi.fn(async () => undefined),
    // Every card mints a preview signature for its own entry (P88-01). Refusing
    // here is the ordinary "no object storage on this deployment" path, which
    // the card renders as a named state rather than a blank rectangle.
    adminViewMedia: vi.fn(async () => {
      throw new Error("no storage in this test");
    }),
    ...overrides,
  } as unknown as ApiClient;
}

function open(props: Partial<Parameters<typeof MediaDialog>[0]> = {}) {
  const onPick = vi.fn();
  const onClose = vi.fn();
  render(
    <MediaDialog
      client={props.client ?? client()}
      kind="video"
      purpose="video"
      courseSlug="adhs"
      onPick={onPick}
      onClose={onClose}
      {...props}
    />,
  );
  return { onPick, onClose };
}

describe("the library tab", () => {
  it("hands back the reference an upload would have produced", async () => {
    const { onPick } = open();

    fireEvent.click(await screen.findByRole("button", { name: "Diese Datei verwenden" }));

    expect(onPick).toHaveBeenCalledWith(ASSET.reference, "video/mp4");
  });

  it("asks the API only for files that could answer the question", async () => {
    // A poster field offering a PDF is the §9.2 shape in miniature.
    const adminListMedia = vi.fn(async () => []);
    open({
      client: client({ adminListMedia } as Partial<ApiClient>),
      kind: "image",
      purpose: "poster",
    });

    await waitFor(() => expect(adminListMedia).toHaveBeenCalledWith({ kind: "image" }));
  });

  it("explains an empty library and offers the way out of it", async () => {
    /*
     * What a customer sees on their very first course. "No files" with no
     * explanation reads as a broken list (§9.4) — and here the next thing to do
     * is one tab away, so the empty state carries the button rather than
     * leaving somebody to find the tab.
     */
    open({
      client: client({ adminListMedia: vi.fn(async () => []) } as Partial<ApiClient>),
    });

    expect(await screen.findByText(/noch keine Datei hochgeladen/u)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Datei hochladen" }));
    expect(screen.getByText(/hierher ziehen/u)).toBeTruthy();
  });

  it("shows the refusal when the file is still in use", async () => {
    /*
     * The API answers 409 naming how many contents point at it, which is what
     * somebody needs in order to go and unpick it. Swallowing that would leave
     * a delete button that appears to do nothing.
     *
     * A real `ApiError`, not a bare `Error`: `describeError` reads
     * `problem.detail` and falls back to the generic sentence for anything else
     * — the rig has to be shaped like the deployment (§9.13).
     */
    const adminForgetMedia = vi.fn(async () => {
      throw new ApiError(
        {
          type: "https://docs.ds-education.de/errors/conflict",
          title: "Conflict",
          status: 409,
          detail: "Diese Datei wird noch in 2 Inhalten verwendet.",
        },
        new Response(null, { status: 409 }),
      );
    });
    open({ client: client({ adminForgetMedia } as Partial<ApiClient>) });

    fireEvent.click(
      await screen.findByRole("button", { name: "Aus Mediathek entfernen" }),
    );

    expect(await screen.findByText(/noch in 2 Inhalten verwendet/u)).toBeTruthy();
  });

  it("says that removing an entry is not deleting the file", async () => {
    // Otherwise the button claims something it does not do — the object stays
    // in storage, deliberately (ADR-0004).
    open();

    expect(
      await screen.findByText(/die Datei selbst bleibt im Dateispeicher erhalten/u),
    ).toBeTruthy();
  });
});

describe("the URL tab", () => {
  it("takes an address for a file this platform does not hold", async () => {
    // The old "Videoquelle hinzufügen" empty row, with a label saying what
    // belongs in it. An HLS manifest is a URL and never an upload.
    const { onPick } = open();

    fireEvent.click(screen.getByRole("tab", { name: "Von Adresse (URL)" }));
    fireEvent.change(screen.getByLabelText("Adresse der Datei"), {
      target: { value: "https://cdn.medice.de/adhs/1080.m3u8" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Adresse übernehmen" }));

    expect(onPick).toHaveBeenCalledWith(
      "https://cdn.medice.de/adhs/1080.m3u8",
      "application/vnd.apple.mpegurl",
    );
  });

  it("does not offer to submit nothing", () => {
    // A button whose only possible outcome is an empty source row is the §9.2
    // shape: it looks like a decision and could never have worked.
    open();

    fireEvent.click(screen.getByRole("tab", { name: "Von Adresse (URL)" }));

    expect(
      (screen.getByRole("button", { name: "Adresse übernehmen" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});

describe("the upload tab", () => {
  it("says why it cannot run yet, and leaves the library working", () => {
    /*
     * Before the course is saved there is no slug to upload against — but
     * choosing a file that is already stored is assigning a string and needs no
     * course. Disabling the whole dialog would take away the half that works.
     */
    open({ courseSlug: undefined });

    fireEvent.click(screen.getByRole("tab", { name: "Datei hochladen" }));

    expect(screen.getByText(/speichern Sie die Fortbildung zuerst/iu)).toBeTruthy();
    expect(
      (document.querySelector('input[type="file"]') as HTMLInputElement).disabled,
    ).toBe(true);
  });
});

/**
 * The three obligations `ui.tsx` named, one test each.
 *
 * None of them is visible to a mouse. All three are the difference between a
 * dialog and a trap for somebody using a keyboard or a screen reader.
 */
describe("what a modal owes the person using it", () => {
  it("closes on Escape", () => {
    const { onClose } = open();

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    expect(onClose).toHaveBeenCalled();
  });

  it("closes when the backdrop is clicked, and not when the panel is", () => {
    // `onMouseDown` on the overlay fires for clicks inside the panel too, so
    // the target has to be checked — closing because somebody started selecting
    // text in the dialog is a lost draft.
    const { onClose } = open();
    const panel = screen.getByRole("dialog");

    fireEvent.mouseDown(panel);
    expect(onClose).not.toHaveBeenCalled();

    const backdrop = panel.parentElement;
    if (backdrop === null) throw new Error("no backdrop");
    fireEvent.mouseDown(backdrop);
    expect(onClose).toHaveBeenCalled();
  });

  it("keeps Tab inside the dialog", async () => {
    open();
    await screen.findByRole("button", { name: "Diese Datei verwenden" });

    const panel = screen.getByRole("dialog");
    const focusable = [
      ...panel.querySelectorAll<HTMLElement>(
        "button, input, [tabindex]:not([tabindex='-1'])",
      ),
    ];
    const last = focusable.at(-1);
    const first = focusable[0];
    if (last === undefined || first === undefined) throw new Error("nothing focusable");

    last.focus();
    fireEvent.keyDown(panel, { key: "Tab" });

    expect(document.activeElement).toBe(first);
  });

  it("gives focus to the dialog and hands it back on close", () => {
    /*
     * Captured on mount rather than read on unmount: by then it is whatever the
     * browser fell back to — usually `<body>` — and restoring that leaves a
     * keyboard user at the top of the document with no idea where they were.
     */
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();

    const { unmount } = render(
      <MediaDialog
        client={client()}
        kind="video"
        purpose="video"
        courseSlug="adhs"
        onPick={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(document.activeElement).toBe(screen.getByRole("dialog"));

    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});

describe("an upload that is still in flight when the tab changes (P150-02)", () => {
  /*
   * Reported with a network panel: a multi-gigabyte PUT still `(pending)` while
   * the dialog showed no progress at all, because switching to *Mediathek* and
   * back unmounted `UploadTab` and took its `busy` state with it. The request
   * itself keeps running — nothing aborts it — so the person sees an idle file
   * picker over a live upload.
   *
   * The consequence the reporter named is the one that matters: *"he may try to
   * do a new upload, as he is not seeing the progress"*. A duplicate
   * multi-gigabyte upload is worse than a missing bar — wasted bandwidth,
   * wasted storage, and two objects to reconcile.
   */
  function pickFile() {
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    if (input === null) throw new Error("no file input on the upload tab");
    const file = new File([new Uint8Array(8)], "modul-1.mp4", { type: "video/mp4" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    fireEvent.change(input);
    return file;
  }

  const toTab = (name: RegExp) => fireEvent.click(screen.getByRole("tab", { name }));

  it("keeps showing the upload after a tab switch, and refuses a second one", async () => {
    // A promise that never settles: the upload is in flight for the whole test.
    let started = 0;
    const runUpload = vi.fn(() => {
      started += 1;
      return new Promise<never>(() => undefined);
    });
    vi.doMock("../uploads.js", async () => ({
      ...(await vi.importActual<typeof UploadsModule>("../uploads.js")),
      runUpload,
    }));
    vi.resetModules();
    const { MediaDialog: Dialog } = await import("./MediaDialog.js");

    render(
      <Dialog
        client={client()}
        kind="video"
        purpose="video"
        courseSlug="adhs"
        onPick={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    toTab(/hochladen|upload/iu);
    pickFile();
    await waitFor(() => {
      expect(screen.getByLabelText(de.uploads.progress)).toBeDefined();
    });
    expect(started).toBe(1);

    // Away and back — the case that was reported.
    toTab(/mediathek|library/iu);
    toTab(/hochladen|upload/iu);

    // (a) The upload is still tracked. Before this fix the tab remounted idle
    //     and showed a file picker over a live request.
    expect(
      screen.queryByLabelText(de.uploads.progress),
      "the in-flight upload lost its progress indicator on a tab switch",
    ).not.toBeNull();

    // (b) …and there is nothing to start a second one *with*: while the upload
    //     is in flight the tab shows progress, not a picker or a drop zone.
    expect(
      document.querySelector('input[type="file"]'),
      "a file picker is offered over a live upload",
    ).toBeNull();
    expect(started).toBe(1);

    vi.doUnmock("../uploads.js");
  });

  /*
   * The guard, tested where it can actually fail.
   *
   * The assertion above was first written as "pick a second file and assert
   * nothing started" — and sabotage caught it being **vacuous**: once the state
   * is lifted there is no file input to pick with, so the second pick never
   * happened, and removing `if (busy) return;` left the test green. §9.1, in an
   * assertion of mine, found by breaking the thing it guards.
   *
   * So the guard is exercised directly. No path through today's UI can reach
   * it — which is exactly the kind of code that rots silently unless something
   * holds it.
   */
  it("refuses a second upload while one is in flight", async () => {
    let started = 0;
    const runUpload = vi.fn(() => {
      started += 1;
      return new Promise<never>(() => undefined);
    });
    vi.doMock("../uploads.js", async () => ({
      ...(await vi.importActual<typeof UploadsModule>("../uploads.js")),
      runUpload,
    }));
    vi.resetModules();
    const { useUploadController } = await import("./MediaDialog.js");

    const file = new File([new Uint8Array(8)], "modul-1.mp4", { type: "video/mp4" });
    let controller: ReturnType<typeof useUploadController> | undefined;

    function Probe() {
      controller = useUploadController(client(), "video", "adhs", vi.fn());
      return null;
    }
    render(<Probe />);

    act(() => controller?.start(file));
    await waitFor(() => {
      expect(started).toBe(1);
    });

    // The second one, while the first is still in flight.
    act(() => controller?.start(file));
    expect(started, "a second upload started while the first was still in flight").toBe(
      1,
    );

    vi.doUnmock("../uploads.js");
  });
});
