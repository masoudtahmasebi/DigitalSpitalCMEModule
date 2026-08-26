/**
 * The Bescheinigungen screen's refusal to offer a pointless resend (P118-02).
 *
 * The defect these cover is not that the screen rendered wrongly — it rendered
 * exactly what it was given, which was a status and nothing else.
 * `delivery_abandoned_reason` had been written since P8-03 and returned by no
 * API, so "unzustellbar" was the whole story and **Erneut senden** was offered
 * for all three causes. For two of them it can only fail again, which is §9.2:
 * a control that looks like a decision and never could have been one.
 *
 * So each case here asserts a pair — the sentence naming what to do, and
 * whether the button that looks like the answer is available.
 */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ApiClient, CertificateRecord } from "@ds/sdk";
import { Certificates } from "./Certificates.js";
import { de } from "../locale/de.js";

afterEach(cleanup);

function record(overrides: Partial<CertificateRecord> = {}): CertificateRecord {
  return {
    id: "cccccccc-0000-4000-8000-00000000000c",
    enrolmentId: "eeeeeeee-0000-4000-8000-00000000000e",
    participantName: "Dr. med. Anna Müller",
    status: "bounced",
    issuedAt: "2026-08-26T09:00:00.000Z",
    deliveredAt: null,
    deliveryAbandonedReason: null,
    ...overrides,
  };
}

function client(row: CertificateRecord): ApiClient {
  return {
    adminListCertificates: vi.fn(async () => [row]),
    adminRegenerateCertificate: vi.fn(async () => undefined),
    adminResendCertificate: vi.fn(async () => undefined),
    adminRevokeCertificate: vi.fn(async () => undefined),
  } as unknown as ApiClient;
}

async function show(row: CertificateRecord): Promise<HTMLButtonElement> {
  render(<Certificates client={client(row)} />);
  await waitFor(() => screen.getByText("Dr. med. Anna Müller"));
  return screen.getByRole("button", {
    name: de.certificates.resend,
  }) as HTMLButtonElement;
}

describe("a certificate whose delivery was abandoned", () => {
  it("names the missing address, and does not offer a resend", async () => {
    const resend = await show(record({ deliveryAbandonedReason: "no_recipient" }));

    expect(screen.getByText(de.certificates.abandoned.no_recipient)).toBeTruthy();
    expect(resend.disabled).toBe(true);
  });

  it("names a refused address, and does not offer a resend", async () => {
    const resend = await show(record({ deliveryAbandonedReason: "permanent_rejection" }));

    expect(screen.getByText(de.certificates.abandoned.permanent_rejection)).toBeTruthy();
    expect(resend.disabled).toBe(true);
  });

  /*
   * The control, and the case that keeps the other two honest: exhausted
   * retries are precisely what Erneut senden is for, so a screen that disabled
   * the button for every abandoned row would be a refusal with no defect behind
   * it — §9.2 in the other direction.
   */
  it("offers the resend when the failures were transient", async () => {
    const resend = await show(record({ deliveryAbandonedReason: "attempts_exhausted" }));

    expect(screen.getByText(de.certificates.abandoned.attempts_exhausted)).toBeTruthy();
    expect(resend.disabled).toBe(false);
  });

  it("says nothing extra when there is no reason to give", async () => {
    const resend = await show(record({ status: "issued" }));

    expect(screen.queryByText(de.certificates.abandoned.no_recipient)).toBeNull();
    expect(resend.disabled).toBe(false);
  });
});
