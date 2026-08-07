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
