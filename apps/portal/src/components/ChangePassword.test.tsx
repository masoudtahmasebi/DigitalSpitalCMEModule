/**
 * The forced password change, rendered (P21-04).
 *
 * The screen's whole job is to be unavoidable, so the assertions are about
 * refusing to submit rather than about submitting: a mismatch, a password too
 * short, and a server refusal each have to stop and say why in German. A form
 * that silently does nothing is how somebody concludes the platform is broken
 * and telephones instead.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ChangePassword } from "./ChangePassword.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function fill(current: string, next: string, confirm: string) {
  fireEvent.change(screen.getByLabelText("Aktuelles Passwort"), {
    target: { value: current },
  });
  fireEvent.change(screen.getByLabelText("Neues Passwort"), { target: { value: next } });
  fireEvent.change(screen.getByLabelText("Neues Passwort wiederholen"), {
    target: { value: confirm },
  });
}

function renderForm(onChanged = vi.fn()) {
  render(
    <ChangePassword
      apiBase="https://api.test"
      projectSlug="medice"
      onChanged={onChanged}
    />,
  );
  return onChanged;
}

function stubFetch(status: number) {
  // Typed with the real `fetch` signature, so `mock.calls[0][1]` is the
  // `RequestInit` the component actually passed rather than `never` — which is
  // what the assertion about `credentials: "include"` needs to be able to read.
  const fetchMock = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(null, { status }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("what it refuses without asking the server", () => {
  it("stops when the two new passwords differ", async () => {
    // The API has no second copy to compare against, so it cannot catch this —
    // and a typo here sets a password nobody knows, on an account whose old
    // password is about to stop working.
    const fetchMock = stubFetch(204);
    renderForm();

    fill("altes-passwort", "Ein-Langes-Passwort", "Ein-Anderes-Passwort");
    fireEvent.click(screen.getByRole("button", { name: "Passwort speichern" }));

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Die beiden Passwörter stimmen nicht überein.",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stops on something obviously too short", async () => {
    // A hint, not the policy — the server checks more. Catching the easy case
    // here saves a round trip and reads as a form that is paying attention.
    const fetchMock = stubFetch(204);
    renderForm();

    fill("altes-passwort", "kurz", "kurz");
    fireEvent.click(screen.getByRole("button", { name: "Passwort speichern" }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("what the server decides", () => {
  it("sends the change with the session cookie attached", async () => {
    // `credentials: "include"` is what makes this an authenticated request at
    // all. Without it the API sees an anonymous caller and answers 401, and the
    // form would report a wrong current password that was perfectly correct.
    const fetchMock = stubFetch(204);
    const onChanged = renderForm();

    fill("altes-passwort", "Ein-Langes-Passwort", "Ein-Langes-Passwort");
    fireEvent.click(screen.getByRole("button", { name: "Passwort speichern" }));

    await waitFor(() => {
      expect(onChanged).toHaveBeenCalled();
    });

    const init = fetchMock.mock.calls[0]?.[1];
    expect(init).toBeDefined();
    expect(init?.credentials).toBe("include");
    expect((init?.headers as Record<string, string>)["x-ds-project"]).toBe("medice");
  });

  it("reports a wrong current password", async () => {
    stubFetch(401);
    renderForm();

    fill("falsch", "Ein-Langes-Passwort", "Ein-Langes-Passwort");
    fireEvent.click(screen.getByRole("button", { name: "Passwort speichern" }));

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Das aktuelle Passwort ist nicht korrekt.",
    );
  });

  it("reports the server's own policy refusal distinctly", async () => {
    // 422 means the password passed the length hint here and still failed the
    // real policy — most likely because it contains the account's own name or
    // address. "Wrong current password" would send somebody hunting for the
    // wrong problem.
    stubFetch(422);
    renderForm();

    fill("altes-passwort", "anna.schmidt-2026", "anna.schmidt-2026");
    fireEvent.click(screen.getByRole("button", { name: "Passwort speichern" }));

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      expect.stringContaining("Anforderungen"),
    );
  });

  it("distinguishes an unreachable API from a refusal", async () => {
    // One is "check your password", the other is "this is not your fault".
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
        throw new Error("network");
      }),
    );
    renderForm();

    fill("altes-passwort", "Ein-Langes-Passwort", "Ein-Langes-Passwort");
    fireEvent.click(screen.getByRole("button", { name: "Passwort speichern" }));

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      expect.stringContaining("nicht erreichbar"),
    );
  });
});
