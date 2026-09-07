/**
 * Every API failure says something (P205-01).
 *
 * The client's question was not "why did this one delete fail silently" but
 * *"how is the error handling for the api errors in the whole application?"* —
 * so what is under test is the **net**, not a screen: a client method that
 * rejects must produce a visible sentence without any screen having arranged
 * for it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApiError } from "@ds/sdk";
import { ToastProvider } from "./toasts.js";
import { createAdminClient, toastPublisher } from "./api.js";

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
