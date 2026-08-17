/**
 * The Mediathek screen (P88-01).
 *
 * Three properties, each of which was absent before this ticket and none of
 * which the picker's tests could have covered — they drive a control that only
 * exists inside a content form.
 *
 * The fourth assertion here is about the *picker* and belongs with these
 * because it is the same defect: a rename was written from `onChange`, one
 * request per keystroke, each answering with the server's row and replacing the
 * value under the cursor.
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ApiClient, MediaAsset } from "@ds/sdk";
import { MediaLibrary } from "./MediaLibrary.js";

afterEach(cleanup);

function asset(overrides: Partial<MediaAsset> = {}): MediaAsset {
  return {
    id: "aaaaaaaa-0000-4000-8000-00000000000a",
    reference: "s3://cust/courses/c1/video-9f2c3d.mp4",
    fileName: "Intro Modul 1.mp4",
    mimeType: "video/mp4",
    byteSize: 5_242_880,
    title: null,
    altText: null,
    createdAt: "2026-08-17T10:00:00.000Z",
    usedByCount: 0,
    ...overrides,
  };
}

function client(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    adminListMedia: vi.fn(async () => [asset()]),
    adminDescribeMedia: vi.fn(async (_id: string, input: unknown) =>
      asset(input as Partial<MediaAsset>),
    ),
    adminForgetMedia: vi.fn(async () => undefined),
    // The ordinary "no object storage configured" path. Asserted below: the
    // card names it rather than leaving a grey rectangle.
    adminViewMedia: vi.fn(async () => {
      throw new Error("no storage in this test");
    }),
    ...overrides,
  } as unknown as ApiClient;
}

describe("MediaLibrary", () => {
  it("lists every kind by default, and narrows to one when a chip is pressed", async () => {
    /*
     * The chips are the whole reason this is a screen rather than the picker:
     * a field opens the picker for the one kind it accepts, and an operator
     * arriving at the Mediathek is looking across all of them.
     *
     * Asserting the **request**, not the rendered rows: the filter is the
     * server's — the API indexes `split_part(mime_type, '/', 1)` — and a
     * client-side rule that agreed today would drift.
     */
    const adminListMedia = vi.fn(async () => [asset()]);
    render(<MediaLibrary client={client({ adminListMedia } as Partial<ApiClient>)} />);

    await waitFor(() => expect(adminListMedia).toHaveBeenCalledWith({}));

    fireEvent.click(screen.getByRole("button", { name: "Bilder" }));
    await waitFor(() => expect(adminListMedia).toHaveBeenCalledWith({ kind: "image" }));
  });

  it("says what removing a file would cost, and refuses before offering it", async () => {
    /*
     * §9.2. The API refuses while a content still points at the file, so a
     * button that could only produce that refusal is worse than none — and the
     * count beside it is what somebody needs in order to go and unpick it.
     */
    render(
      <MediaLibrary
        client={client({
          adminListMedia: vi.fn(async () => [asset({ usedByCount: 3 })]),
        } as Partial<ApiClient>)}
      />,
    );

    expect(await screen.findByText("In 3 Inhalten verwendet")).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "Aus Mediathek entfernen" })
        .hasAttribute("disabled"),
    ).toBe(true);
  });

  it("removes a file nothing points at", async () => {
    // The control for the assertion above: without it that one would pass on a
    // screen whose remove button is disabled for every file (§9.1).
    const adminForgetMedia = vi.fn(async () => undefined);
    render(<MediaLibrary client={client({ adminForgetMedia } as Partial<ApiClient>)} />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Aus Mediathek entfernen" }),
    );

    await waitFor(() => expect(adminForgetMedia).toHaveBeenCalledWith(asset().id));
  });

  it("writes a rename once, when the field is finished with", async () => {
    /*
     * The defect this replaces: the first version called
     * `PATCH /admin/media/{id}` from `onChange`. Fifteen characters were
     * fifteen requests, each answering with the server's row and replacing the
     * value under the cursor — the field fought the typist.
     *
     * Typing must therefore cost **nothing**, and blur must cost exactly one.
     */
    const adminDescribeMedia = vi.fn(async () => asset({ title: "Intro" }));
    render(
      <MediaLibrary client={client({ adminDescribeMedia } as Partial<ApiClient>)} />,
    );

    const field = await screen.findByLabelText("Titel");
    fireEvent.change(field, { target: { value: "I" } });
    fireEvent.change(field, { target: { value: "In" } });
    fireEvent.change(field, { target: { value: "Intro" } });

    expect(adminDescribeMedia).not.toHaveBeenCalled();

    fireEvent.blur(field);
    await waitFor(() => expect(adminDescribeMedia).toHaveBeenCalledTimes(1));
    expect(adminDescribeMedia).toHaveBeenCalledWith(asset().id, {
      title: "Intro",
      altText: "",
    });
  });

  it("does not spend a request on a field somebody only tabbed through", async () => {
    const adminDescribeMedia = vi.fn(async () => asset());
    render(
      <MediaLibrary client={client({ adminDescribeMedia } as Partial<ApiClient>)} />,
    );

    const field = await screen.findByLabelText("Titel");
    // Touched and left unchanged — a draft exists, and it matches what is
    // stored. A PATCH here would be an audit row for nothing.
    fireEvent.change(field, { target: { value: "x" } });
    fireEvent.change(field, { target: { value: "" } });
    fireEvent.blur(field);

    await waitFor(() => expect(screen.getByLabelText("Titel")).toBeTruthy());
    expect(adminDescribeMedia).not.toHaveBeenCalled();
  });

  it("names a preview it could not load rather than leaving a blank frame", async () => {
    // §9.4. A grey rectangle where a video should be is indistinguishable from
    // a feature that was never built, and the honest cause here is ordinary:
    // this deployment has no object storage.
    render(<MediaLibrary client={client()} />);

    expect(await screen.findByText("Keine Vorschau verfügbar")).toBeTruthy();
  });

  it("tells an empty library from an empty filter", async () => {
    /*
     * Two different states that render the same way if nobody separates them.
     * "Nothing matches this search" is a thing to undo; "you have not uploaded
     * anything" is a thing to explain.
     */
    render(
      <MediaLibrary
        client={client({ adminListMedia: vi.fn(async () => []) } as Partial<ApiClient>)}
      />,
    );

    expect(
      await screen.findByText(/Für diesen Kunden wurde noch keine Datei/u),
    ).toBeTruthy();

    cleanup();

    render(<MediaLibrary client={client()} />);
    fireEvent.change(await screen.findByLabelText("Suchen"), {
      target: { value: "gibt-es-nicht" },
    });

    expect(
      await screen.findByText(/Zu dieser Auswahl gibt es keine Datei/u),
    ).toBeTruthy();
  });
});
