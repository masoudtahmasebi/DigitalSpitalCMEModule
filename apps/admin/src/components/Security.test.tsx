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
import { applicableSecondFactorPolicy, governingSecondFactorScopes } from "@ds/domain";
import type { ApiClient, SecondFactorPolicy } from "@ds/sdk";
import { Security } from "./Security.js";

afterEach(cleanup);

const CUSTOMER = { id: "11111111-1111-4111-8111-111111111111", name: "MEDICE" };

/**
 * A plain object rather than a mock framework's proxy: a method the screen
 * starts calling and this file does not provide is a `TypeError` here, not a
 * silently recorded call.
 *
 * `own` is **derived from the grants**, through the same two domain functions
 * the API calls, rather than written out per case (P74-01). A hand-written
 * `own` would let a test assert that the screen points at a row while the fixed
 * fixture quietly disagreed with the policy table beside it — which is the
 * class of defect this whole ticket is about.
 */
function client(options: {
  platform: SecondFactorPolicy;
  customer: SecondFactorPolicy;
  grants: readonly { customerId: string | null }[];
  mayChange: boolean;
}) {
  const perCustomer = new Map([[CUSTOMER.id, options.customer]]);
  const own = {
    policy: applicableSecondFactorPolicy(options.grants, options.platform, perCustomer),
    scopes: governingSecondFactorScopes(
      options.grants,
      options.platform,
      perCustomer,
    ).map((customerId) => ({
      customerId,
      name: customerId === null ? null : CUSTOMER.name,
      mayChange: options.mayChange,
    })),
  };

  return {
    adminGetSecondFactorPolicy: () =>
      Promise.resolve({
        platform: options.platform,
        customers: [{ customerId: CUSTOMER.id, policy: options.customer }],
        own,
      }),
    adminRemoveOwnSecondFactor: vi.fn(() => Promise.resolve(undefined)),
    adminSetSecondFactorPolicy: vi.fn(() => Promise.resolve(undefined)),
  } as unknown as ApiClient;
}

async function renderScreen(options: {
  platform: SecondFactorPolicy;
  customer?: SecondFactorPolicy;
  isSuperAdmin: boolean;
  /** What the console may offer this operator; defaults to the customer list. */
  customers?: readonly { id: string; name: string }[];
  mayChange?: boolean;
}) {
  const api = client({
    platform: options.platform,
    customer: options.customer ?? "optional",
    // A super administrator belongs to no customer; everybody else here holds a
    // grant in MEDICE. This is the distinction the screen used to guess at.
    grants: options.isSuperAdmin ? [{ customerId: null }] : [{ customerId: CUSTOMER.id }],
    mayChange: options.mayChange ?? true,
  });
  await act(async () => {
    render(
      <Security
        client={api}
        apiBase="http://api.test"
        isSuperAdmin={options.isSuperAdmin}
        ownSecondFactorEnrolled={true}
        customers={options.customers ?? [CUSTOMER]}
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

/**
 * Which rule, and which row (P74-01).
 *
 * > _"why is this like this still? i want to remove it!"_
 *
 * The notice above was already correct and already said what to do. What it did
 * not say is **where** — the screen draws a platform row and a customer row and
 * the sentence said "oben die Regel", so the obvious move for a super
 * administrator is to relax the customer row directly under the cursor, which
 * changes nothing about their own account.
 */
describe("which rule governs the reader", () => {
  it("marks the platform row for a super administrator, and not the customer row", async () => {
    await renderScreen({
      platform: "required",
      customer: "required",
      isSuperAdmin: true,
    });

    expect(
      screen.getByLabelText(/Plattform \(Super-Administration\) — für Sie maßgeblich/u),
    ).toBeDefined();
    expect(screen.queryByLabelText(/Kunde: MEDICE — für Sie maßgeblich/u)).toBeNull();
  });

  it("marks the customer row for an operator inside that customer", async () => {
    await renderScreen({
      platform: "required",
      customer: "required",
      isSuperAdmin: false,
    });

    expect(screen.getByLabelText(/Kunde: MEDICE — für Sie maßgeblich/u)).toBeDefined();
    expect(
      screen.queryByLabelText(/Plattform \(Super-Administration\) — für Sie maßgeblich/u),
    ).toBeNull();
  });

  it("names that scope in the sentence that tells them to change it", async () => {
    await renderScreen({
      platform: "disabled",
      customer: "required",
      isSuperAdmin: false,
    });

    // Not "oben die Regel": the words the reader has to find on the screen.
    expect(screen.getByText(/aus Kunde: MEDICE/u)).toBeDefined();
    expect(
      screen.getByText(/zuerst oben Kunde: MEDICE auf „Freigestellt“/u),
    ).toBeDefined();
  });

  /*
   * The row for a scope the console's own customer list does not contain.
   *
   * That list is fetched only for an operator holding the `customer`
   * capability, so for a customer administrator it is empty — and the screen
   * drew the platform row, which is not theirs, and no row at all for the rule
   * that actually governed them. The sentence then pointed "oben" at somebody
   * else's rule.
   */
  it("draws a row for the governing scope even when the console has no customer list", async () => {
    await renderScreen({
      platform: "disabled",
      customer: "required",
      isSuperAdmin: false,
      customers: [],
    });

    expect(screen.getByLabelText(/Kunde: MEDICE — für Sie maßgeblich/u)).toBeDefined();
  });

  /*
   * And the case where the instruction would be a dead end: a role that may not
   * set policies at all. CLAUDE.md §9.2 — never offer what the system refuses —
   * and §9.4: say why, where somebody looks for it.
   */
  it("says who to ask instead when this operator may not change that rule", async () => {
    await renderScreen({
      platform: "disabled",
      customer: "required",
      isSuperAdmin: false,
      mayChange: false,
    });

    expect(screen.getByText(/Diese Regel dürfen Sie nicht ändern/u)).toBeDefined();
    expect(screen.queryByText(/auf „Freigestellt“/u)).toBeNull();
    // The row is still shown — the reader has to be able to see the rule they
    // are under — but as a value rather than as a control they cannot use.
    expect(screen.getByText(/Kunde: MEDICE — für Sie maßgeblich/u)).toBeDefined();
    expect(screen.queryByLabelText(/Kunde: MEDICE — für Sie maßgeblich/u)).toBeNull();
  });
});
