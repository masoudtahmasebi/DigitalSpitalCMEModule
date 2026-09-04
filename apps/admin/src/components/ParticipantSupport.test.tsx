/**
 * The support panel (P179), on the screen.
 *
 * These are the half an API test structurally cannot reach (§9.13): that the
 * console *offers* the right controls and withholds the ones the server would
 * refuse. The integration suite proves each route answers correctly; nothing
 * there can prove a button exists, or that the one that can only fail is absent.
 *
 * `resendable` is the case that earned its own tests. P118-02 added three
 * abandoned reasons precisely because the console had been offering **Erneut
 * senden** for all of them, and for two it can only produce the same error —
 * which looks like a decision to whoever clicks it (§9.2).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ApiClient, ParticipantRow } from "@ds/sdk";
import { ParticipantSupport } from "./ParticipantSupport.js";
import { de } from "../locale/de.js";

afterEach(cleanup);

const CERT_ID = "11111111-1111-4111-8111-111111111111";

function row(over: Partial<ParticipantRow> = {}): ParticipantRow {
  return {
    enrolmentId: "22222222-2222-4222-8222-222222222222",
    participantName: "PD Dr. med. Lorem Muster",
    email: null,
    efnPresent: true,
    watchedPercent: 100,
    quizPassed: true,
    evaluationSubmitted: true,
    progressPercent: 100,
    courseComplete: true,
    complete: true,
    completedAt: "2026-09-03T10:00:00.000Z",
    courseCompletedAt: "2026-09-03T10:00:00.000Z",
    eivState: "queued",
    eivAttempts: 0,
    eivReportDueAt: null,
    certificateState: "bounced",
    certificate: {
      id: CERT_ID,
      abandonedReason: "attempts_exhausted",
      lastError: "SMTP 450",
      attemptCount: 5,
      firstAttemptAt: "2026-09-03T10:05:00.000Z",
      nextAttemptAt: null,
    },
    efnMasked: "•••••••••••2345",
    efnDivergesFromReport: false,
    ...over,
  } as ParticipantRow;
}

function mount(over: Partial<ParticipantRow> = {}, client: Partial<ApiClient> = {}) {
  const onChanged = vi.fn();
  /*
   * The panel reads the delivery address on mount (P183-04). Every case here
   * would otherwise fail on `adminReadDeliveryEmail is not a function`, which
   * says nothing about the case — so the default is a stub each test may
   * override, and the address cases pass their own.
   */
  const withDefaults: Partial<ApiClient> = {
    adminReadDeliveryEmail: async () => ({ email: null, accountEmail: null }),
    ...client,
  };
  render(
    <ParticipantSupport
      client={withDefaults as ApiClient}
      courseSlug="ds-test"
      row={row(over)}
      onChanged={onChanged}
    />,
  );
  return onChanged;
}

describe("the sentence the whole panel exists for", () => {
  it("says a bounce is about the e-mail and not about the entitlement", () => {
    mount();

    // `delivery.service.ts` is explicit that a failed delivery must never
    // affect whether a physician can have their certificate. An operator who
    // does not know that will tell them they have lost it.
    expect(screen.getByText(de.participants.support.bouncedExplained)).toBeTruthy();
  });

  it("names the cause instead of leaving the operator with one word", () => {
    mount();
    expect(
      screen.getByText(de.participants.support.reasons.attempts_exhausted),
    ).toBeTruthy();
  });

  it("falls back to a sentence when the cause is one this version does not know", () => {
    // The API narrows an unrecognised `delivery_abandoned_reason` to null
    // rather than passing it through, and this is the other half: null renders
    // an honest sentence, not an empty space where a cause should be.
    mount({ certificate: { ...row().certificate!, abandonedReason: null } });
    expect(screen.getByText(de.participants.support.reasonUnknown)).toBeTruthy();
  });

  it("shows the transport's own words, the attempts and that none is due", () => {
    mount();

    expect(screen.getByText("SMTP 450")).toBeTruthy();
    expect(screen.getByText("5")).toBeTruthy();
    expect(screen.getByText(de.participants.support.nextAttemptNone)).toBeTruthy();
  });
});

describe("resending is offered only where it could land", () => {
  it("offers it when the attempts merely ran out", () => {
    mount();
    expect(screen.getByText(de.participants.support.resend)).toBeTruthy();
    expect(screen.queryByText(de.participants.support.resendBlocked)).toBeNull();
  });

  for (const reason of ["no_recipient", "permanent_rejection"] as const) {
    it(`withholds it, with the reason, for ${reason}`, () => {
      mount({ certificate: { ...row().certificate!, abandonedReason: reason } });

      // Absent, not disabled: a control that can only produce the same error
      // is worse than no control, and the cause says what to do instead.
      expect(screen.queryByText(de.participants.support.resend)).toBeNull();
      expect(screen.getByText(de.participants.support.resendBlocked)).toBeTruthy();
      expect(screen.getByText(de.participants.support.reasons[reason])).toBeTruthy();
    });
  }

  it("sends the certificate id the row carries, not the enrolment's", async () => {
    // The row keys two different things and handing the wrong one to the API
    // is a 404 an operator cannot diagnose.
    const adminResendCertificate = vi.fn(async () => undefined);
    const onChanged = mount({}, { adminResendCertificate } as Partial<ApiClient>);

    fireEvent.click(screen.getByText(de.participants.support.resend));

    await waitFor(() => expect(adminResendCertificate).toHaveBeenCalledWith(CERT_ID));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });
});

describe("a revoked certificate", () => {
  it("offers nothing and says why", () => {
    mount({ certificateState: "revoked" });

    expect(screen.getByText(de.participants.support.revokedCertificate)).toBeTruthy();
    expect(screen.queryByText(de.participants.support.download)).toBeNull();
    expect(screen.queryByText(de.participants.support.resend)).toBeNull();
    expect(screen.queryByText(de.participants.support.regenerate)).toBeNull();
  });
});

describe("a participation with no certificate yet", () => {
  it("explains rather than drawing an empty panel", () => {
    mount({ certificateState: "none", certificate: null });

    expect(screen.getByText(de.participants.support.noCertificate)).toBeTruthy();
    expect(screen.queryByText(de.participants.support.download)).toBeNull();
  });
});

describe("the EFN", () => {
  it("shows only the mask, and says why", () => {
    mount();

    expect(screen.getByText("•••••••••••2345")).toBeTruthy();
    expect(screen.getByText(de.participants.support.efnMaskHint)).toBeTruthy();
  });

  it("warns when the queued Meldung would report a different number", () => {
    // The finding the panel exists to surface: two copies of one value, and
    // until P179-03 no screen anywhere could tell you they had drifted apart.
    mount({ efnDivergesFromReport: true });
    expect(screen.getByText(de.participants.support.efnDiverges)).toBeTruthy();
  });

  it("says at the control that it corrects the report and not the person", () => {
    mount();

    // §9.4. An operator who believes they have fixed the physician's record
    // has not fixed anything, and would not go on to ask them to correct it.
    expect(screen.getByText(de.participants.support.efnCorrectHint)).toBeTruthy();
  });

  it("refuses to enable the button until fifteen digits are present", () => {
    mount();

    const field = screen.getByLabelText(de.participants.support.efnCorrectField);
    const button = screen.getByText(de.participants.support.efnCorrectAction);

    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(field, { target: { value: "12345" } });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(field, { target: { value: "802760699000001" } });
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it("sends the trimmed value", async () => {
    const adminCorrectSubmissionEfn = vi.fn(async () => undefined);
    mount({}, { adminCorrectSubmissionEfn } as Partial<ApiClient>);

    fireEvent.change(screen.getByLabelText(de.participants.support.efnCorrectField), {
      target: { value: " 802760699000001 " },
    });
    fireEvent.click(screen.getByText(de.participants.support.efnCorrectAction));

    await waitFor(() =>
      expect(adminCorrectSubmissionEfn).toHaveBeenCalledWith(
        row().enrolmentId,
        "802760699000001",
      ),
    );
  });

  for (const state of ["submitted", "withdrawn"] as const) {
    it(`offers no field once the Meldung is ${state}`, () => {
      // The API refuses it too. Saying so here is what stops an operator
      // typing fifteen digits to discover it (§9.2).
      mount({ eivState: state });

      expect(screen.getByText(de.participants.support.efnCorrectLocked)).toBeTruthy();
      expect(screen.queryByLabelText(de.participants.support.efnCorrectField)).toBeNull();
    });
  }

  it("says there is nothing to correct when no Meldung exists", () => {
    mount({ eivState: "none" });
    expect(screen.getByText(de.participants.support.efnCorrectUnavailable)).toBeTruthy();
  });
});

describe("the delivery address (P183-04)", () => {
  it("names the account address a send would use", async () => {
    mount({}, {
      adminReadDeliveryEmail: async () => ({
        email: null,
        accountEmail: "konto@example.de",
      }),
    } as Partial<ApiClient>);

    expect(await screen.findByText(/konto@example\.de/u)).toBeTruthy();
  });

  // The distinction the panel turns on: an override must be visibly an
  // override, or an operator reads it as the person's own address.
  it("says when the address is not the account's", async () => {
    mount({}, {
      adminReadDeliveryEmail: async () => ({
        email: "praxis@example.de",
        accountEmail: "konto@example.de",
      }),
    } as Partial<ApiClient>);

    expect(await screen.findByText(/praxis@example\.de/u)).toBeTruthy();
    expect(screen.getByText(/abweichend vom Konto/u)).toBeTruthy();
  });

  // The client's screenshot, in a test: neither address anywhere.
  it("says plainly when there is no address at all", async () => {
    mount({}, {} as Partial<ApiClient>);

    expect(await screen.findByText(/weder im Konto noch hier/u)).toBeTruthy();
  });

  it("sends what was typed, and shows what the server accepted", async () => {
    const adminSetDeliveryEmail = vi.fn(async () => ({ email: "neu@example.de" }));
    mount({}, { adminSetDeliveryEmail } as unknown as Partial<ApiClient>);

    const field = await screen.findByLabelText(/Abweichende Zustelladresse/u);
    fireEvent.change(field, { target: { value: "  neu@example.de " } });
    fireEvent.click(screen.getByRole("button", { name: /Adresse speichern/u }));

    await waitFor(() => expect(adminSetDeliveryEmail).toHaveBeenCalledTimes(1));
    // The enrolment id, not the certificate id — they are different columns and
    // this route takes the enrolment (P179-02 recorded the same trap).
    //
    // The value arrives already trimmed, and that is the *browser*, not this
    // component: an `<input type="email">` applies HTML's value sanitisation
    // and strips surrounding whitespace before anything reads it. So the
    // pasted-with-a-newline case cannot be exercised through this control at
    // all — it is covered where it can actually happen, in
    // `deliveryAddress`'s own tests, for a caller that reaches the API
    // directly.
    expect(adminSetDeliveryEmail).toHaveBeenCalledWith(
      "22222222-2222-4222-8222-222222222222",
      "neu@example.de",
    );
  });

  it("says that saving an address does not itself send anything", async () => {
    mount(
      { certificate: { ...row().certificate!, abandonedReason: "no_recipient" } },
      {} as Partial<ApiClient>,
    );

    expect(
      await screen.findByText(/Das Speichern allein versendet nichts/u),
    ).toBeTruthy();
  });
});
