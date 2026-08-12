/**
 * The Punktemeldung screen (layout page 13) — and specifically the EFN, which
 * is the one field on it that cannot be corrected after submission.
 *
 * This file did not exist before P54-02, which is its own finding: the screen
 * that captures a physician's Fortbildungsnummer, their attested name and their
 * consent had no component test at all. What is asserted here is what a
 * physician can *see and do* about the number that will be reported for them:
 *
 * - it is shown back, in full — a masked EFN cannot be checked, and checking it
 *   is the entire reason the read exists (ADR-0004, amended);
 * - it is read from the API, not from the enrolment state, which carries only
 *   `efnPresent: boolean`;
 * - a correction goes through `setEfn` and not through `completeCourse`, which
 *   would submit the whole form as a side effect of fixing a digit.
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient, EnrolmentState } from "@ds/sdk";
import type { Branding } from "@ds/domain";
import { CompletionScreen } from "./CompletionScreen.js";

afterEach(cleanup);

const EFN = "123456789012345";
const CORRECTED = "999888777666555";

const branding = { primaryColour: "#000000" } as unknown as Branding;

function stateWith(overrides: Partial<EnrolmentState>): EnrolmentState {
  return {
    courseSlug: "adhs-akademie-adult",
    efnPresent: true,
    evaluationSubmitted: true,
    quizPassed: true,
    achievedWatchPercent: 100,
    requiredWatchPercent: 100,
    completedAt: null,
    courseCompletedAt: null,
    outstanding: [],
    ...overrides,
  } as unknown as EnrolmentState;
}

function clientWith(overrides: Partial<ApiClient> = {}) {
  return {
    getEfn: vi.fn(async () => ({ efn: EFN })),
    setEfn: vi.fn(async () => undefined),
    completeCourse: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as ApiClient;
}

function renderScreen(client: ApiClient, state: EnrolmentState) {
  return render(
    <CompletionScreen
      client={client}
      courseSlug="adhs-akademie-adult"
      state={state}
      branding={branding}
      onCompleted={() => undefined}
    />,
  );
}

describe("an EFN already on file", () => {
  it("shows which number will be reported, not merely that one exists", async () => {
    renderScreen(clientWith(), stateWith({}));

    // "Ihre EFN ist hinterlegt" was the old answer and is true of every wrong
    // EFN as well as every right one.
    expect(await screen.findByText(new RegExp(EFN, "u"))).toBeTruthy();
  });

  it("reads it from the API rather than from the enrolment state", async () => {
    // `EnrolmentState` carries `efnPresent: boolean` and never the value
    // (ADR-0004); a screen that rendered an EFN without this call would be
    // rendering one it invented.
    const client = clientWith();

    renderScreen(client, stateWith({}));

    await waitFor(() => expect(client.getEfn).toHaveBeenCalledTimes(1));
  });

  it("does not ask when there is nothing stored to read", async () => {
    const client = clientWith();

    renderScreen(client, stateWith({ efnPresent: false, outstanding: ["efn"] }));

    // Give the effect the same chance to run as the cases above.
    await waitFor(() => expect(screen.getByLabelText(/EFN/u)).toBeTruthy());
    expect(client.getEfn).not.toHaveBeenCalled();
  });

  it("still says an EFN is on file when the read fails", async () => {
    // The physician's task here is to submit their completion. A failed read
    // decorated the page; it must not block the screen or shout at them.
    const client = clientWith({
      getEfn: vi.fn(async () => Promise.reject(new Error("nope"))),
    });

    renderScreen(client, stateWith({}));

    expect(await screen.findByText(/hinterlegt/u)).toBeTruthy();
  });
});

describe("correcting a stored EFN", () => {
  it("sends it through setEfn and not by submitting the whole form", async () => {
    /*
     * The distinction the one-form-one-request rule turns on. `completeCourse`
     * queues a Punktemeldung; a physician fixing a typo has not asked for that
     * and may not yet have the rest of the form filled in.
     */
    const client = clientWith();

    renderScreen(client, stateWith({}));
    fireEvent.click(await screen.findByText("EFN korrigieren"));
    fireEvent.change(screen.getByLabelText(/EFN/u), { target: { value: CORRECTED } });
    fireEvent.click(screen.getByText("EFN speichern"));

    await waitFor(() => expect(client.setEfn).toHaveBeenCalledWith(CORRECTED));
    expect(client.completeCourse).not.toHaveBeenCalled();
  });

  it("shows the corrected number afterwards, without a reload", async () => {
    const client = clientWith();

    renderScreen(client, stateWith({}));
    fireEvent.click(await screen.findByText("EFN korrigieren"));
    fireEvent.change(screen.getByLabelText(/EFN/u), { target: { value: CORRECTED } });
    fireEvent.click(screen.getByText("EFN speichern"));

    expect(await screen.findByText(new RegExp(CORRECTED, "u"))).toBeTruthy();
  });

  it("refuses to save anything that is not 15 digits", async () => {
    const client = clientWith();

    renderScreen(client, stateWith({}));
    fireEvent.click(await screen.findByText("EFN korrigieren"));
    fireEvent.change(screen.getByLabelText(/EFN/u), { target: { value: "12345" } });
    fireEvent.click(screen.getByText("EFN speichern"));

    expect(client.setEfn).not.toHaveBeenCalled();
  });
});

/**
 * The Anschrift (P60-03).
 *
 * The renderer has had an "Anschrift:" line since P8 and nothing ever supplied
 * a value — CLAUDE.md §9.3, a rule written is not a rule enforced. These cases
 * are about the half that closes it: the screen asks, and what it asks for
 * reaches the request in the shape the API expects.
 */
describe("the postal address", () => {
  const filled = () => stateWith({ efnPresent: true });

  function fillNames(): void {
    fireEvent.change(screen.getByLabelText(/Vorname/), { target: { value: "Anna" } });
    fireEvent.change(screen.getByLabelText(/Nachname/), { target: { value: "Müller" } });
  }

  it("is offered, and says it may be left empty", async () => {
    // An unlabelled optional field on a form that otherwise wants only an EFN
    // invites the question "must I?" — so the answer is at the field.
    const client = clientWith();
    renderScreen(client, filled());

    const field = await screen.findByLabelText(/Anschrift/);
    expect(field).toBeTruthy();
    expect((field as HTMLInputElement).required).toBe(false);
    expect(screen.getByText(/ohne Angabe bleibt die Zeile leer/i)).toBeTruthy();
  });

  it("sends what was typed", async () => {
    const client = clientWith();
    renderScreen(client, filled());

    fillNames();
    fireEvent.change(await screen.findByLabelText(/Anschrift/), {
      target: { value: "Musterstraße 1, 58638 Iserlohn" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Daten übermitteln/ }));

    await waitFor(() => {
      expect(client.completeCourse).toHaveBeenCalledWith(
        "adhs-akademie-adult",
        expect.objectContaining({ attestedAddress: "Musterstraße 1, 58638 Iserlohn" }),
      );
    });
  });

  it("omits the field entirely when it was left empty", async () => {
    // Not `""`. The API reads an absent field as "not supplied in this
    // request" and leaves whatever is stored; an empty string is a value, and
    // would blank an address a learner gave on an earlier attempt.
    const client = clientWith();
    renderScreen(client, filled());

    fillNames();
    fireEvent.click(screen.getByRole("button", { name: /Daten übermitteln/ }));

    await waitFor(() => {
      expect(client.completeCourse).toHaveBeenCalled();
    });
    const [, payload] = (
      client.completeCourse as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls[0]!;
    expect(Object.keys(payload as object)).not.toContain("attestedAddress");
  });

  it("does not make the address a condition of finishing", async () => {
    // S12 is open with the ÄKWL. Until it is answered, a physician who does not
    // want to give a postal address must still be able to claim their points.
    const client = clientWith();
    renderScreen(client, filled());

    fillNames();
    const submit = screen.getByRole("button", { name: /Daten übermitteln/ });
    expect((submit as HTMLButtonElement).disabled).toBe(false);
  });
});
