/**
 * That the Mediathek can actually be used to reuse a file (P81-03).
 *
 * The point of the feature is one sentence — an intro video uploaded once
 * should be usable in a second course — so the load-bearing assertion is that
 * picking hands back the same `s3://` reference an upload would have. The rest
 * are the two refusals that have to be visible rather than silent.
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, type ApiClient, type MediaAsset } from "@ds/sdk";
import { MediaPicker } from "./MediaPicker.js";

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

describe("MediaPicker", () => {
  it("hands back the reference an upload would have produced", async () => {
    const onPick = vi.fn();
    render(
      <MediaPicker client={client()} kind="video" onPick={onPick} onClose={vi.fn()} />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Diese Datei verwenden" }));

    expect(onPick).toHaveBeenCalledWith(ASSET.reference);
  });

  it("asks the API only for files that could answer the question", async () => {
    // A poster field offering a PDF is the §9.2 shape in miniature.
    const adminListMedia = vi.fn(async () => []);
    render(
      <MediaPicker
        client={client({ adminListMedia } as Partial<ApiClient>)}
        kind="image"
        onPick={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => expect(adminListMedia).toHaveBeenCalledWith({ kind: "image" }));
  });

  it("explains an empty library rather than showing a bare nothing", async () => {
    // What a customer sees on their very first course. "No files" with no
    // explanation reads as a broken list (§9.4).
    render(
      <MediaPicker
        client={client({ adminListMedia: vi.fn(async () => []) } as Partial<ApiClient>)}
        kind="video"
        onPick={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(await screen.findByText(/noch keine Datei hochgeladen/u)).toBeTruthy();
  });

  it("shows the refusal when the file is still in use", async () => {
    /*
     * The API answers 409 naming how many contents point at it, which is what
     * somebody needs in order to go and unpick it. Swallowing that would leave
     * a delete button that appears to do nothing.
     */
    /*
     * A real `ApiError`, not a bare `Error`.
     *
     * `describeError` reads `problem.detail` and falls back to the generic
     * sentence for anything else — correctly, since a network failure has no
     * German explanation to show. A test throwing the wrong shape passed
     * through that fallback and told me the detail was being swallowed when it
     * was not: the rig has to be shaped like the deployment (§9.13).
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
    render(
      <MediaPicker
        client={client({ adminForgetMedia } as Partial<ApiClient>)}
        kind="video"
        onPick={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Aus Mediathek entfernen" }),
    );

    expect(await screen.findByText(/noch in 2 Inhalten verwendet/u)).toBeTruthy();
  });

  it("says that removing an entry is not deleting the file", async () => {
    // Otherwise the button claims something it does not do — the object stays
    // in storage, deliberately (ADR-0004).
    render(
      <MediaPicker client={client()} kind="video" onPick={vi.fn()} onClose={vi.fn()} />,
    );

    expect(
      await screen.findByText(/die Datei selbst bleibt im Dateispeicher erhalten/u),
    ).toBeTruthy();
  });
});
