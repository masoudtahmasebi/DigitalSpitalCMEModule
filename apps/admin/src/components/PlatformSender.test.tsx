/**
 * The platform sender's test message, as the operator experiences it (P77-01).
 *
 * ## Why these are the assertions
 *
 * The whole reason this control exists is that the previous way to find out
 * whether SMTP worked — trigger a real password reset and wait — is
 * *deliberately* silent about the outcome, because that flow must not be an
 * account-enumeration oracle (§9.5). So a mistyped host produced no error
 * anywhere an operator could see it, and the first evidence was a colleague
 * who never got their invitation.
 *
 * That makes the failure text the feature, not decoration. These tests hold:
 *
 * 1. the SMTP server's **own words** reach the screen, unparaphrased — `535
 *    authentication failed` and `ENOTFOUND` are two different afternoons;
 * 2. "not configured" and "the send failed" are told apart, because they have
 *    different fixes;
 * 3. the button is **not offered** against a sender that cannot send, which is
 *    §9.2 — a control that can only produce an error is worse than none;
 * 4. success names the address, since an operator may hold more than one
 *    console account.
 *
 * These live in their own file because they mock `../staff-auth.js`, and
 * `Security.test.tsx` needs the real module.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { applicableSecondFactorPolicy, governingSecondFactorScopes } from "@ds/domain";
import type { ApiClient } from "@ds/sdk";

const readPlatformSender = vi.fn();
const sendPlatformTestMail = vi.fn();
const writePlatformSender = vi.fn((..._args: unknown[]) => Promise.resolve(true));

vi.mock("../staff-auth.js", () => ({
  readPlatformSender: (...args: unknown[]) => readPlatformSender(...args),
  sendPlatformTestMail: (...args: unknown[]) => sendPlatformTestMail(...args),
  writePlatformSender: (...args: unknown[]) => writePlatformSender(...args),
}));

const { Security } = await import("./Security.js");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** A sender complete enough that the server would actually try to send. */
function configured(overrides: Record<string, unknown> = {}) {
  return {
    host: "smtp.example.test",
    port: 587,
    username: "noreply@digitalspital.com",
    hasPassword: true,
    secure: false,
    fromAddress: "noreply@digitalspital.com",
    fromName: "DS Education",
    canSend: true,
    ...overrides,
  };
}

function client() {
  const grants = [{ customerId: null }];
  const perCustomer = new Map<string, "optional">();
  return {
    adminGetSecondFactorPolicy: () =>
      Promise.resolve({
        platform: "optional",
        customers: [],
        own: {
          policy: applicableSecondFactorPolicy(grants, "optional", perCustomer),
          scopes: governingSecondFactorScopes(grants, "optional", perCustomer).map(
            (customerId) => ({ customerId, name: null, mayChange: true }),
          ),
        },
      }),
    adminRemoveOwnSecondFactor: vi.fn(() => Promise.resolve(undefined)),
    adminSetSecondFactorPolicy: vi.fn(() => Promise.resolve(undefined)),
  } as unknown as ApiClient;
}

async function renderPanel() {
  await act(async () => {
    render(
      <Security
        client={client()}
        apiBase="http://api.test"
        isSuperAdmin={true}
        ownSecondFactorEnrolled={true}
        customers={[]}
      />,
    );
  });
}

function testButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: "Test-E-Mail senden" }) as HTMLButtonElement;
}

describe("the Test-E-Mail control", () => {
  it("is not offered while the stored sender could not send anything", async () => {
    // §9.2: a control whose only possible outcome is an error is worse than an
    // absent one — it looks like a decision and never could have worked.
    readPlatformSender.mockResolvedValue(configured({ canSend: false, host: null }));
    await renderPanel();

    expect(testButton().disabled).toBe(true);
    expect(sendPlatformTestMail).not.toHaveBeenCalled();
  });

  it("sends with the stored settings and names the address it reached", async () => {
    readPlatformSender.mockResolvedValue(configured());
    sendPlatformTestMail.mockResolvedValue({
      status: "sent",
      sentTo: "operator@digitalspital.com",
    });
    await renderPanel();

    fireEvent.click(testButton());

    await waitFor(() => {
      expect(screen.getByText(/operator@digitalspital.com/u)).toBeDefined();
    });
    // And it says to check the spam folder, which is the half of "did it work"
    // that a 250 from the SMTP server cannot answer.
    expect(screen.getByText(/Spam-Ordner/u)).toBeDefined();
    expect(sendPlatformTestMail).toHaveBeenCalledWith("http://api.test");
  });

  it("shows the SMTP server's own words when the send fails", async () => {
    readPlatformSender.mockResolvedValue(configured());
    sendPlatformTestMail.mockResolvedValue({
      status: "failed",
      reason: "535 5.7.8 Authentication credentials invalid",
    });
    await renderPanel();

    fireEvent.click(testButton());

    // Unparaphrased: the response code is the whole diagnostic value.
    await waitFor(() => {
      expect(
        screen.getByText(/535 5\.7\.8 Authentication credentials invalid/u),
      ).toBeDefined();
    });
  });

  it("tells a missing configuration apart from a failed send", async () => {
    // The two have different fixes — fill the form, versus fix the credentials
    // — so one message for both would send an operator to the wrong place.
    readPlatformSender.mockResolvedValue(configured());
    sendPlatformTestMail.mockResolvedValue({ status: "not_configured" });
    await renderPanel();

    fireEvent.click(testButton());

    await waitFor(() => {
      expect(screen.getByText(/kein Versand eingerichtet/u)).toBeDefined();
    });
  });

  it("says so when the console could not even ask", async () => {
    readPlatformSender.mockResolvedValue(configured());
    sendPlatformTestMail.mockResolvedValue({ status: "unreachable" });
    await renderPanel();

    fireEvent.click(testButton());

    await waitFor(() => {
      expect(screen.getByText(/konnte nicht gestellt werden/u)).toBeDefined();
    });
  });
});
