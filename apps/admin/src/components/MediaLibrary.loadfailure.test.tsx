/**
 * The Mediathek after a failed load (P236-01).
 *
 * ## The report
 *
 * A screenshot of `verwaltung.digitalspital.com/#/mediathek` on `c2df963`:
 *
 * > Zu viele Anfragen. Bitte versuchen Sie es in Kürze erneut.
 * > (Referenz: 03121f5b-c6cd-4632-b966-8152151dd85e)
 * >
 * > Wird geladen …
 *
 * Both at once. The screen says the request was refused **and** that it is
 * still loading, and the second is the one an operator believes, because a
 * spinner is a promise that waiting will work. It never resolves: the list is
 * `undefined` for ever, so the eternal "loading" is the only state the screen
 * can reach from a failure.
 *
 * `useMediaLibrary`'s rejection handler sets `problem` and **never touches
 * `assets`**, and the render treats `assets === undefined` as "in flight". So
 * every failure of the first load lands here — the 429 above is only the one
 * that was reported.
 *
 * ## Why this is the Mediathek and not the other screens
 *
 * Seven screens already render `LoadFailure`, which P231-02 gave a required
 * `retryable` prop precisely so that every screen had to answer the question.
 * `useMediaLibrary` is not a screen and was never asked it.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { ApiError, type ApiClient } from "@ds/sdk";
import { MediaLibrary } from "./MediaLibrary.js";
import { MediaDialog } from "./MediaDialog.js";
import { de } from "../locale/de.js";

afterEach(cleanup);

/** A refusal shaped the way the SDK raises one, so `isRetryable` can read it. */
function failure(status: number): ApiError {
  return new ApiError(
    { type: "about:blank", title: "Failure", status } as never,
    new Response(null, { status }),
  );
}

function clientThatFails(status: number, onCall?: () => void) {
  return {
    adminListMedia: vi.fn(() => {
      onCall?.();
      return Promise.reject(failure(status));
    }),
  } as unknown as ApiClient;
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

describe("the Mediathek when the list cannot be loaded", () => {
  it("stops claiming to load, which is what the screenshot showed it doing", async () => {
    await act(async () => {
      render(<MediaLibrary client={clientThatFails(429)} />);
    });
    await settle();

    expect(
      screen.queryByText(de.loading),
      'the screen still says "Wird geladen …" after the load was refused, so an ' +
        "operator waits for a request that will never arrive",
    ).toBeNull();
  });

  it("offers a retry for a 429, because trying again is exactly what works", async () => {
    let calls = 0;
    const client = clientThatFails(429, () => {
      calls += 1;
    });
    await act(async () => {
      render(<MediaLibrary client={client} />);
    });
    await settle();

    const retry = screen.getByRole("button", { name: de.error.retry });
    const before = calls;
    await act(async () => {
      retry.click();
    });
    await settle();

    expect(
      calls,
      "the retry button did not reach the API, so it is a control that cannot work",
    ).toBeGreaterThan(before);
  });

  it("does not offer a retry for a 404, where there is no later that works", async () => {
    await act(async () => {
      render(<MediaLibrary client={clientThatFails(404)} />);
    });
    await settle();

    expect(
      screen.queryByRole("button", { name: de.error.retry }),
      "a 404 is not retryable — a disabled or useless retry says this is the " +
        "thing to do here, when it is not (§9.2)",
    ).toBeNull();
  });

  it("never shows the refusal as an empty library, which would be a lie", async () => {
    await act(async () => {
      render(<MediaLibrary client={clientThatFails(429)} />);
    });
    await settle();

    expect(
      screen.queryByText(de.media.empty),
      "a failed load rendered as 'you have uploaded nothing yet' — the one " +
        "wrong answer worse than the spinner, because it looks like data",
    ).toBeNull();
  });
});

/**
 * The same defect in the picker, which is the second and more disruptive
 * instance (§9.11 — fix the class, not the report).
 *
 * `MediaDialog` shares `useMediaLibrary` and had the identical render: an
 * error notice over an eternal `de.loading`. It matters more than the screen
 * does, because this box is opened *during* something — an author adding a
 * video to a course — so the stall is a step of their work that looks like it
 * is still going.
 */
describe("the Mediathek picker when the list cannot be loaded", () => {
  it("stops claiming to load, and offers the retry that would work", async () => {
    let calls = 0;
    const client = clientThatFails(429, () => {
      calls += 1;
    });

    await act(async () => {
      render(
        <MediaDialog
          client={client}
          kind="video"
          purpose="video"
          courseSlug="adhs"
          onPick={() => undefined}
          onClose={() => undefined}
        />,
      );
    });
    await settle();

    expect(
      screen.queryByText(de.loading),
      'the picker still says "Wird geladen …" after the load was refused, in a ' +
        "dialog an author opened in the middle of building a course",
    ).toBeNull();

    const before = calls;
    await act(async () => {
      screen.getByRole("button", { name: de.error.retry }).click();
    });
    await settle();
    expect(calls, "the picker's retry did not reach the API").toBeGreaterThan(before);
  });
});
