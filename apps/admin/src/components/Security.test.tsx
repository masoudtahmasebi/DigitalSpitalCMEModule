/**
 * "Entfernen" says what it will actually do (P69-01).
 *
 * ## The report
 *
 * > _"i removed the 2factor for an account, and again after login, it is asking
 * > for setting a 2factor auth."_
 *
 * Both halves are true. Under a `required` policy the removal succeeds and the
 * **policy does not change**, so `secondFactorStep(required, enrolled: false)`
 * answers `must_enrol` and the next sign-in goes to the QR code. That is a
 * rotation, which is exactly what a device change needs — and it is not what
 * the button's label led anybody to expect.
 *
 * The security behaviour is right and stays: a removal that also relaxed the
 * rule would let anybody holding a live session turn the second factor off
 * permanently. What was wrong is that the screen said nothing, so P66-02 made
 * the control *work* without making its meaning match its name — CLAUDE.md
 * §9.2 and §9.4, on the same control for the third time.
 *
 * ## What these tests hold
 *
 * That the sentence is on screen **before** the click, that the confirmation
 * says what it is confirming, and that the message afterwards distinguishes a
 * rotation from a removal. And the negative: under `optional` none of that
 * appears, because there the button means what it says.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ApiClient, SecondFactorPolicy } from "@ds/sdk";
import { Security } from "./Security.js";

afterEach(cleanup);

const CUSTOMER = { id: "11111111-1111-4111-8111-111111111111", name: "MEDICE" };

/**
 * A plain object rather than a mock framework's proxy: a method the screen
 * starts calling and this file does not provide is a `TypeError` here, not a
 * silently recorded call.
 */
function client(platform: SecondFactorPolicy, customer: SecondFactorPolicy) {
  return {
    adminGetSecondFactorPolicy: () =>
      Promise.resolve({
        platform,
        customers: [{ customerId: CUSTOMER.id, policy: customer }],
      }),
    adminRemoveOwnSecondFactor: vi.fn(() => Promise.resolve(undefined)),
    adminSetSecondFactorPolicy: vi.fn(() => Promise.resolve(undefined)),
  } as unknown as ApiClient;
}

async function renderScreen(options: {
  platform: SecondFactorPolicy;
  customer?: SecondFactorPolicy;
  isSuperAdmin: boolean;
}) {
  const api = client(options.platform, options.customer ?? "optional");
  await act(async () => {
    render(
      <Security
        client={api}
        apiBase="http://api.test"
        isSuperAdmin={options.isSuperAdmin}
        ownSecondFactorEnrolled={true}
        customers={[CUSTOMER]}
      />,
    );
  });
  return api;
}

describe("removing your own second factor under a required policy", () => {
  it("says it is a rotation before the button is pressed", async () => {
    await renderScreen({ platform: "required", isSuperAdmin: true });

    expect(
      screen.getByText(/Ein Entfernen setzt den zweiten Faktor deshalb nur zurück/u),
    ).toBeDefined();
  });

  it("confirms what it is really confirming", async () => {
    await renderScreen({ platform: "required", isSuperAdmin: true });

    fireEvent.click(
      screen.getByRole("button", { name: "Eigenen zweiten Faktor entfernen" }),
    );

    expect(
      screen.getByRole("button", { name: "Zurücksetzen und neu einrichten" }),
    ).toBeDefined();
  });

  it("says afterwards that the next sign-in will ask for a new one", async () => {
    const api = await renderScreen({ platform: "required", isSuperAdmin: true });

    fireEvent.click(
      screen.getByRole("button", { name: "Eigenen zweiten Faktor entfernen" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Zurücksetzen und neu einrichten" }),
    );

    await waitFor(() =>
      expect(
        screen.getByText(/Beim nächsten Anmelden richten Sie einen neuen ein/u),
      ).toBeDefined(),
    );
    expect(api.adminRemoveOwnSecondFactor).toHaveBeenCalledTimes(1);
  });

  /*
   * The negative, and the reason the three above are about the *policy* rather
   * than about a string being present: under `optional` the button means what
   * it says, and a screen that warned anyway would be crying wolf on the one
   * path where removal is really removal.
   */
  it("says none of that when the rule is optional", async () => {
    await renderScreen({ platform: "optional", isSuperAdmin: true });

    expect(screen.queryByText(/nur zurück/u)).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Eigenen zweiten Faktor entfernen" }),
    );
    expect(screen.getByRole("button", { name: "Wirklich entfernen" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Wirklich entfernen" }));

    await waitFor(() =>
      expect(
        screen.getByText(/Sie melden sich künftig nur mit Passwort an/u),
      ).toBeDefined(),
    );
  });

  /*
   * And the case that is not the platform's: a customer administrator is under
   * their customer's rule, not the platform's, so the warning has to follow
   * `applicableSecondFactorPolicy` rather than `policies.platform`.
   */
  it("follows the customer's rule for an operator who is not a super administrator", async () => {
    await renderScreen({
      platform: "disabled",
      customer: "required",
      isSuperAdmin: false,
    });

    expect(
      screen.getByText(/Ein Entfernen setzt den zweiten Faktor deshalb nur zurück/u),
    ).toBeDefined();
  });
});
