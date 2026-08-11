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
