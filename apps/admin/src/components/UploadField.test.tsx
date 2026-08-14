/**
 * The upload field, rendered (P23-04).
 *
 * ## Why this file exists in this shape
 *
 * The console shipped four bugs with twenty passing tests, because those tests
 * covered two pure helpers and nothing that rendered. So the assertions here
 * are about what an author sees and can click — a stored reference that is not
 * an editable text box, a button that says why it is disabled, a progress bar
 * with real ARIA values, and a German message when the API refuses.
 *
 * ## What is mocked, and what deliberately is not
 *
 * `uploadToTicket` is mocked: it is `XMLHttpRequest` against a bucket, and jsdom
 * has no bucket. The *transport* is tested for real elsewhere —
 * `object-storage.test.ts` drives a signature-verifying HTTP server, and the
 * integration suite drives the whole path end to end. What only this file can
 * check is the wiring: that `begin`, the PUT and `complete` are called in that
 * order, with the values from each other, and that every failure in between
 * lands somewhere an author can read.
 *
 * The client is a plain object rather than a mock framework's proxy, so a
 * method the component starts calling and this file does not provide is a
 * `TypeError` in the test rather than a silently-recorded call.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ApiClient } from "@ds/sdk";
import { clearPreviewCache } from "../media-preview.js";
import { isUploadedReference, referenceName, UploadField } from "./UploadField.js";

const uploadToTicket = vi.hoisted(() => vi.fn());

vi.mock("@ds/sdk", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  uploadToTicket,
}));

const REFERENCE = "s3://0198f4c1-7a2e-7000-8000-000000000001/courses/abc/video-9f3b.mp4";

afterEach(() => {
  cleanup();
  uploadToTicket.mockReset();
  // The preview cache lives in a module, so it outlives a case unless it is
  // reset here — the P42-01 lesson about ambient state, one module along.
  clearPreviewCache();
});

function fakeClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    adminBeginUpload: vi.fn(async () => ({
      key: "0198f4c1-7a2e-7000-8000-000000000001/courses/abc/video-9f3b.mp4",
      url: "https://storage.example/signed",
      method: "PUT" as const,
      headers: { "Content-Type": "video/mp4" },
      expiresAt: "2026-08-07T09:30:00.000Z",
    })),
    adminCompleteUpload: vi.fn(async () => ({
      reference: REFERENCE,
      sizeBytes: 11,
      mimeType: "video/mp4",
    })),
    // The preview's own call (P74-03). Present here rather than left out, so a
    // component that stops calling it fails a test instead of quietly showing
    // nothing.
    adminViewUpload: vi.fn(async () => ({
      url: "https://storage.example/signed-get",
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    })),
    ...overrides,
  } as unknown as ApiClient;
}

function renderField(props: Partial<Parameters<typeof UploadField>[0]> = {}) {
  const onChange = vi.fn();
  const client = props.client ?? fakeClient();

  render(
    <UploadField
      label="Vorschaubild"
      id="poster"
      value=""
      purpose="poster"
      client={client}
      courseSlug="adhs"
      onChange={onChange}
      {...props}
    />,
  );

  return { onChange, client };
}

/** The hidden `<input type="file">`, which has no accessible role by design. */
function filePicker(): HTMLInputElement {
  const input = document.querySelector('input[type="file"]');
  if (input === null) throw new Error("no file input rendered");
  return input as HTMLInputElement;
}

/**
 * A blob's text, through `FileReader`.
 *
 * jsdom does not implement `Blob.prototype.text()` — the same gap `readText`
 * in the component exists for, and the reason it exists rather than being a
 * one-liner.
 */
function readAsText(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result ?? "")));
    reader.addEventListener("error", () =>
      reject(reader.error ?? new Error("unreadable")),
    );
    reader.readAsText(file);
  });
}

function choose(file: File): void {
  const input = filePicker();
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  fireEvent.change(input);
}

describe("what an author sees", () => {
  it("offers an editable field for a URL somebody typed", () => {
    renderField({ value: "https://cdn.medice.de/poster.jpg" });

    expect((screen.getByLabelText("Vorschaubild") as HTMLInputElement).value).toBe(
      "https://cdn.medice.de/poster.jpg",
    );
  });

  it("shows an uploaded file as a chip, not as an editable key", () => {
    // A key is the server's. A hand-edited one can only ever be refused, so
    // offering a text box invites a change that cannot work.
    renderField({ value: REFERENCE });

    expect(screen.queryByLabelText("Vorschaubild")).toBeNull();
    expect(screen.getByText(/Hochgeladen/)).toBeTruthy();
    expect(screen.getByText(/video-9f3b\.mp4/)).toBeTruthy();
  });

  it("clears the value when the uploaded file is removed", () => {
    const { onChange } = renderField({ value: REFERENCE });

    fireEvent.click(screen.getByRole("button", { name: /entfernen/i }));

    expect(onChange).toHaveBeenCalledWith("");
  });

  it("says why uploading is unavailable before the course exists", () => {
    // Not hidden. A control that vanishes is a control an author looks for.
    renderField({ courseSlug: undefined });

    expect(
      (screen.getByRole("button", { name: "Datei hochladen" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.getByText(/speichern Sie die Fortbildung zuerst/i)).toBeTruthy();
  });

  it("offers the file picker only the types this purpose accepts", () => {
    // Mirrors UPLOAD_TYPES. Offering a `.mov` a browser will let you pick and
    // the server will refuse is a round trip and a message, for nothing.
    renderField({ purpose: "material" });
    expect(filePicker().accept).toBe("application/pdf");
  });
});

describe("the three steps", () => {
  it("asks, uploads, confirms, and reports the reference", async () => {
    uploadToTicket.mockResolvedValue(undefined);
    const { onChange, client } = renderField({ purpose: "video" });

    choose(new File(["hello video"], "Vortrag.mp4", { type: "video/mp4" }));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(REFERENCE));

    expect(client.adminBeginUpload).toHaveBeenCalledWith("adhs", {
      purpose: "video",
      mimeType: "video/mp4",
      sizeBytes: 11,
    });
    // The key from the ticket, not a name the component made up.
    expect(client.adminCompleteUpload).toHaveBeenCalledWith(
      "adhs",
      "0198f4c1-7a2e-7000-8000-000000000001/courses/abc/video-9f3b.mp4",
    );
  });

  it("sends the ticket's own headers to the bucket", async () => {
    uploadToTicket.mockResolvedValue(undefined);
    renderField({ purpose: "video" });

    choose(new File(["hello video"], "Vortrag.mp4", { type: "video/mp4" }));

    await waitFor(() => expect(uploadToTicket).toHaveBeenCalled());
    const [ticket] = uploadToTicket.mock.calls[0] ?? [];
    expect(ticket.headers).toEqual({ "Content-Type": "video/mp4" });
  });

  it("falls back to the purpose's type when the picker reports none", async () => {
    // What Safari does with a .vtt. Sending "" would be a 422 with nothing
    // useful to say; letting the server decide is the honest fallback.
    uploadToTicket.mockResolvedValue(undefined);
    const { client } = renderField({ purpose: "captions" });

    choose(new File(["WEBVTT"], "untertitel.vtt", { type: "" }));

    await waitFor(() => expect(client.adminBeginUpload).toHaveBeenCalled());
    expect(client.adminBeginUpload).toHaveBeenCalledWith("adhs", {
      purpose: "captions",
      mimeType: "text/vtt",
      sizeBytes: 6,
    });
  });

  it("reports the type the bucket stored, not the one the picker claimed", async () => {
    uploadToTicket.mockResolvedValue(undefined);
    const onMimeType = vi.fn();
    renderField({ purpose: "material", onMimeType });

    choose(new File(["%PDF"], "handout.pdf", { type: "application/pdf" }));

    await waitFor(() => expect(onMimeType).toHaveBeenCalledWith("video/mp4"));
  });

  it("does not report a reference when the upload itself fails", async () => {
    // The failure that matters most: `begin` succeeded, so a component that
    // assumed the rest would follow would attach a course to nothing.
    uploadToTicket.mockRejectedValue(
      new Error("the connection to object storage failed"),
    );
    const { onChange, client } = renderField();

    choose(new File(["x"], "poster.png", { type: "image/png" }));

    await waitFor(() => expect(screen.getByText(/Verbindung zum/)).toBeTruthy());
    expect(onChange).not.toHaveBeenCalled();
    expect(client.adminCompleteUpload).not.toHaveBeenCalled();
  });
});

describe("progress and cancellation", () => {
  it("renders a progress bar with the real percentage", async () => {
    // Not decoration. A lecture takes minutes, and a spinner with no number in
    // front of that is indistinguishable from a hang.
    let report: ((percent: number) => void) | undefined;
    uploadToTicket.mockImplementation(
      async (
        _ticket: unknown,
        _file: unknown,
        options: { onProgress?: (percent: number) => void },
      ) => {
        report = options.onProgress;
        await new Promise(() => {
          /* never settles: the upload is in flight */
        });
      },
    );

    renderField();
    choose(new File(["x"], "poster.png", { type: "image/png" }));

    await waitFor(() => expect(screen.getByRole("progressbar")).toBeTruthy());

    report?.(42);
    await waitFor(() =>
      expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("42"),
    );
    expect(screen.getByText("42%")).toBeTruthy();
  });

  it("aborts the transfer when cancelled", async () => {
    let signal: AbortSignal | undefined;
    uploadToTicket.mockImplementation(
      async (_t: unknown, _f: unknown, options: { signal?: AbortSignal }) => {
        signal = options.signal;
        await new Promise(() => {});
      },
    );

    renderField();
    choose(new File(["x"], "poster.png", { type: "image/png" }));

    await waitFor(() => expect(screen.getByRole("progressbar")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }));

    expect(signal?.aborted).toBe(true);
  });
});

describe("what an author is told when it goes wrong", () => {
  it("shows the API's own German refusal", async () => {
    // The server already wrote a message for this screen. Replacing it with
    // "Upload fehlgeschlagen" is the difference between fixing the file and
    // filing a ticket.
    const client = fakeClient({
      adminBeginUpload: vi.fn(async () => {
        throw new Error("Die Datei ist zu groß.");
      }),
    } as Partial<ApiClient>);

    renderField({ client });
    choose(new File(["x"], "poster.png", { type: "image/png" }));

    await waitFor(() => expect(screen.getByText("Die Datei ist zu groß.")).toBeTruthy());
  });

  it("replaces the transport's English with something an author can act on", async () => {
    uploadToTicket.mockRejectedValue(
      new Error("the connection to object storage failed"),
    );

    renderField();
    choose(new File(["x"], "poster.png", { type: "image/png" }));

    await waitFor(() =>
      expect(screen.getByText(/Verbindung zum Dateispeicher/)).toBeTruthy(),
    );
  });

  it("says a cancellation was a cancellation, not a failure", async () => {
    uploadToTicket.mockRejectedValue(new Error("upload cancelled"));

    renderField();
    choose(new File(["x"], "poster.png", { type: "image/png" }));

    await waitFor(() =>
      expect(screen.getByText("Der Upload wurde abgebrochen.")).toBeTruthy(),
    );
  });

  it("lets the same file be chosen again after a failure", async () => {
    // `change` does not fire twice for the same value, so a picker left holding
    // the failed file silently ignores the retry.
    uploadToTicket.mockRejectedValue(new Error("upload cancelled"));

    renderField();
    choose(new File(["x"], "poster.png", { type: "image/png" }));

    await waitFor(() => expect(filePicker().value).toBe(""));
  });
});

/**
 * SRT in, WebVTT in the bucket (P74-05).
 *
 * > _"can we make the subtitle be also in srt format?"_
 *
 * The conversion itself is `srtToVtt` in `@ds/domain`, tested exhaustively
 * there. What only this file can hold is that anything **calls** it — the §9.3
 * shape — and that what reaches the bucket is the converted bytes rather than
 * the file the author picked.
 */
describe("subtitles the author already has", () => {
  const SRT = "1\n00:00:01,000 --> 00:00:04,000\nWillkommen.\n";

  it("uploads an SRT as WebVTT, under a .vtt name", async () => {
    uploadToTicket.mockResolvedValue(undefined);
    const { client } = renderField({ purpose: "captions" });

    choose(new File([SRT], "untertitel.srt", { type: "application/x-subrip" }));

    await waitFor(() => expect(client.adminBeginUpload).toHaveBeenCalled());
    // The type the *server* is asked to approve is the converted one — asking
    // for `application/x-subrip` would be a 422, correctly, since that is not a
    // format the platform stores.
    expect(client.adminBeginUpload).toHaveBeenCalledWith("adhs", {
      purpose: "captions",
      mimeType: "text/vtt",
      sizeBytes: expect.any(Number) as number,
    });

    const sent = uploadToTicket.mock.calls[0]?.[1] as File;
    expect(sent.name).toBe("untertitel.vtt");
    expect(sent.type).toBe("text/vtt");
    // The bytes, not just the label. A `<track>` handed anything without this
    // first line shows no captions at all, silently.
    expect(await readAsText(sent)).toContain("WEBVTT");
    expect(await readAsText(sent)).toContain("00:00:01.000 --> 00:00:04.000");
  });

  it("leaves a WebVTT file exactly as it was", async () => {
    // A second `WEBVTT` line in the middle of a file is a parse failure, so
    // converting twice would break the case that already worked.
    uploadToTicket.mockResolvedValue(undefined);
    const vtt = "WEBVTT\n\n00:00:01.000 --> 00:00:04.000\nWillkommen.\n";
    renderField({ purpose: "captions" });

    choose(new File([vtt], "untertitel.vtt", { type: "text/vtt" }));

    await waitFor(() => expect(uploadToTicket).toHaveBeenCalled());
    const sent = uploadToTicket.mock.calls[0]?.[1] as File;
    expect(sent.name).toBe("untertitel.vtt");
    expect(await readAsText(sent)).toBe(vtt);
  });

  it("offers the picker both formats", () => {
    renderField({ purpose: "captions" });
    const accept = filePicker().getAttribute("accept") ?? "";
    expect(accept).toContain(".srt");
    expect(accept).toContain(".vtt");
  });
});

/**
 * Seeing the file, not its name (P74-03).
 *
 * > _"for here, can we have the preview of the video, and the preview of images
 * > uploaded?"_
 *
 * The form held an `s3://` reference and a browser cannot fetch one, so it
 * showed a filename. These cases hold the wiring — that the component asks the
 * API, that it asks it for the right thing, and that a refusal is stated rather
 * than left as an empty rectangle.
 */
describe("the preview of an uploaded file", () => {
  it("asks the API to resolve the reference and shows the image", async () => {
    const { client } = renderField({ value: REFERENCE, purpose: "poster" });

    const image = await screen.findByAltText("Vorschau des hochgeladenen Bildes");
    expect(image.getAttribute("src")).toBe("https://storage.example/signed-get");
    expect(client.adminViewUpload).toHaveBeenCalledWith("adhs", REFERENCE);
  });

  it("shows a video as something an author can actually play", async () => {
    renderField({ value: REFERENCE, purpose: "video" });

    const video = await screen.findByLabelText("Vorschau des hochgeladenen Videos");
    expect(video.tagName).toBe("VIDEO");
    // Not `auto`: a lecture is hundreds of megabytes and opening a form is not
    // a request to download one.
    expect(video.getAttribute("preload")).toBe("metadata");
  });

  it("offers a PDF as a link rather than a viewer inside the form", async () => {
    renderField({ value: REFERENCE, purpose: "material" });

    const link = await screen.findByRole("link", { name: "Datei öffnen" });
    expect(link.getAttribute("href")).toBe("https://storage.example/signed-get");
    // The URL carries a signature; a `Referer` would hand it to whatever the
    // file links out to.
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("does not ask the API about a URL the customer serves themselves", async () => {
    const { client } = renderField({
      value: "https://cdn.medice.de/poster.jpg",
      purpose: "poster",
    });

    const image = await screen.findByAltText("Vorschau des hochgeladenen Bildes");
    expect(image.getAttribute("src")).toBe("https://cdn.medice.de/poster.jpg");
    expect(client.adminViewUpload).not.toHaveBeenCalled();
  });

  it("says the preview failed rather than leaving a blank space", async () => {
    // An ordinary state — no object storage on this deployment, or an object
    // removed behind the reference. A gap where a picture should be reads as an
    // unfinished feature (CLAUDE.md §9.4).
    renderField({
      value: REFERENCE,
      purpose: "poster",
      client: fakeClient({
        adminViewUpload: vi.fn(async () => {
          throw new Error("no object storage");
        }),
      } as unknown as Partial<ApiClient>),
    });

    expect(
      await screen.findByText(/Die Vorschau konnte nicht geladen werden/u),
    ).toBeDefined();
  });

  it("shows nothing at all when there is no value", () => {
    const { client } = renderField({ value: "", purpose: "poster" });

    expect(screen.queryByAltText("Vorschau des hochgeladenen Bildes")).toBeNull();
    expect(screen.queryByText(/Vorschau wird geladen/u)).toBeNull();
    expect(client.adminViewUpload).not.toHaveBeenCalled();
  });

  it("resolves a reference once, however many fields hold it", async () => {
    const client = fakeClient();
    renderField({ value: REFERENCE, purpose: "poster", client });
    renderField({ value: REFERENCE, purpose: "video", client });

    await screen.findByAltText("Vorschau des hochgeladenen Bildes");
    await screen.findByLabelText("Vorschau des hochgeladenen Videos");

    // A signature is minted per call and each one is an audit row; a content
    // form with a video, a poster and captions would otherwise mint on every
    // keystroke that re-renders it.
    expect(client.adminViewUpload).toHaveBeenCalledTimes(1);
  });
});

describe("the reference helpers", () => {
  it("recognises a stored reference and nothing else", () => {
    expect(isUploadedReference(REFERENCE)).toBe(true);
    expect(isUploadedReference("https://cdn.medice.de/a.mp4")).toBe(false);
    expect(isUploadedReference("")).toBe(false);
  });

  it("shows the object's own name rather than the whole key", () => {
    expect(referenceName(REFERENCE)).toBe("video-9f3b.mp4");
  });
});
