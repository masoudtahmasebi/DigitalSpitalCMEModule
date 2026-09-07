/**
 * Every API failure says something (P205-01).
 *
 * The client's question was not "why did this one delete fail silently" but
 * *"how is the error handling for the api errors in the whole application?"* —
 * so what is under test is the **net**, not a screen: a client method that
 * rejects must produce a visible sentence without any screen having arranged
 * for it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApiError } from "@ds/sdk";
import { ToastProvider } from "./toasts.js";
import { createAdminClient, toastPublisher } from "./api.js";
import { App } from "./App.js";
import { de } from "./locale/de.js";

afterEach(cleanup);

describe("the failure net (P205)", () => {
  it("announces a rejection from the real client wrapper, with no screen involved", async () => {
    /*
     * Through `createAdminClient`, not a hand-rolled imitation of what the
     * wrapper does — the first version of this case published the message
     * itself and would have passed with `announcing` deleted (§9.7).
     *
     * A stubbed `fetch` answering 409 with problem-details, and the assertion
     * is that the sentence appears without any screen having caught anything.
     */
    const publishRef = { current: (_: string) => undefined };
    render(<ToastProvider publishRef={publishRef}>{null}</ToastProvider>);
    toastPublisher.current = publishRef.current;

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              type: "https://docs.ds-education.de/errors/conflict",
              title: "Conflict",
              status: 409,
              detail:
                "Dieses Kurs enthält noch 1 Module. Diese müssen zuerst gelöscht werden.",
              correlationId: "d61f7fc2-8332-4d84-b063-7fe360279a14",
            }),
            { status: 409, headers: { "content-type": "application/problem+json" } },
          ),
      ),
    );

    const client = createAdminClient(
      { apiBase: "http://api.test" } as never,
      "cust-1",
      () => undefined,
    );

    // Rejects as before — the wrapper re-throws, so every existing catch is
    // unaffected.
    await expect(client.adminDeleteCourse("test-ds-course")).rejects.toBeInstanceOf(
      ApiError,
    );

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("enthält noch 1 Module"),
    );
    // And the correlation id travels with it, so a report can name the request.
    expect(screen.getByRole("alert").textContent).toContain("d61f7fc2");
  });

  it("stays quiet for 401 and 403, which the console routes elsewhere", async () => {
    // A disappearing toast over the login form, or over the screen whose whole
    // job is to say "you are not an admin", is noise about something already
    // being explained.
    const publishRef = { current: (_: string) => undefined };
    render(<ToastProvider publishRef={publishRef}>{null}</ToastProvider>);
    toastPublisher.current = publishRef.current;

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ title: "Forbidden", status: 403 }), {
            status: 403,
            headers: { "content-type": "application/problem+json" },
          }),
      ),
    );

    const client = createAdminClient(
      { apiBase: "http://api.test" } as never,
      "cust-1",
      () => undefined,
    );
    await expect(client.adminListCourses()).rejects.toBeTruthy();

    /*
     * Absence, asserted through a sentinel rather than directly.
     *
     * `expect(queryByRole("alert")).toBeNull()` immediately after the rejection
     * passes whether or not a toast was published: React has not flushed the
     * state update yet, so "not there" and "not there *yet*" are the same
     * observation. Removing the 401/403 guard on purpose left that version
     * green — §9.1, in the test written to prove the guard.
     *
     * Publishing a known sentence afterwards and waiting for it gives React a
     * flush to ride on. When it appears, anything the 403 published would have
     * appeared too — so exactly one alert means the 403 published nothing.
     */
    publishRef.current("Sentinel");
    await waitFor(() => expect(screen.getByText("Sentinel")).toBeTruthy());

    expect(
      screen.getAllByRole("alert"),
      "a 403 was announced, over a screen already explaining it",
    ).toHaveLength(1);
  });

  it("shows one toast for the same sentence twice", async () => {
    // A screen retrying on a timer would otherwise stack the corner with
    // copies of one problem, which reads as several problems.
    const publishRef = { current: (_: string) => undefined };
    render(<ToastProvider publishRef={publishRef}>{null}</ToastProvider>);

    publishRef.current("Dasselbe Problem");
    publishRef.current("Dasselbe Problem");

    await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(1));
  });

  it("can be dismissed", async () => {
    const publishRef = { current: (_: string) => undefined };
    render(<ToastProvider publishRef={publishRef}>{null}</ToastProvider>);

    publishRef.current("Etwas ist schiefgegangen");
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /Schließen/u }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("renders nothing at all when there is nothing to say", () => {
    const publishRef = { current: (_: string) => undefined };
    render(<ToastProvider publishRef={publishRef}>{null}</ToastProvider>);

    // Not an empty container: a fixed, always-present box would sit over the
    // bottom-right of every screen and swallow clicks there.
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

/*
 * P205-02 — the host belongs to the layout, not to one branch.
 *
 * The client: *"shouldn't the toast and error handling be a general thing that
 * the layout has?"* It was not. `App` returns from three places — the
 * password-reset screen, the sign-in form, and the console — and only the last
 * had a host. A failure raised on either of the other two reached the default
 * no-op publisher and vanished, on the two screens where a failure is most
 * likely.
 *
 * Driven through `App` itself rather than by reading the source, because the
 * property is "every branch", and a branch is something you have to arrive at.
 */
describe("the host is on every branch of the shell (P205-02)", () => {
  beforeEach(() => {
    // `readConfig` reads `window.__DS_CONFIG__` and returns undefined without
    // it — App then renders a configuration error and neither branch below is
    // reached, which is how the first version of these two cases failed.
    (window as unknown as { __DS_CONFIG__: unknown }).__DS_CONFIG__ = {
      apiBase: "http://api.test",
    };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete (window as unknown as { __DS_CONFIG__?: unknown }).__DS_CONFIG__;
    window.history.replaceState(null, "", "#");
  });

  /** Nobody is signed in, and no reset token: the sign-in form. */
  it("is present on the sign-in screen", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 401 })),
    );

    render(<App />);
    // The sign-in form, not the console.
    await waitFor(() => expect(screen.getByLabelText(/E-Mail/u)).toBeTruthy());

    toastPublisher.current("Etwas ist schiefgegangen");
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
  });

  it("is present on the password-reset screen", async () => {
    window.history.replaceState(null, "", "#passwort-neu?token=abc123");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 401 })),
    );

    render(<App />);
    // On the reset branch, not the sign-in one — `newPasswordTitle` appears on
    // no other screen, so this cannot pass from the wrong branch.
    await waitFor(() => expect(screen.getByText(de.auth.newPasswordTitle)).toBeTruthy());

    toastPublisher.current("Etwas ist schiefgegangen");
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
  });
});
