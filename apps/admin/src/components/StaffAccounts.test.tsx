/**
 * The Konten screen, and the one button that must not appear on your own row
 * (P38-07).
 *
 * ## The defect this is here to keep fixed
 *
 * `POST /admin/staff/{id}/second-factor/reset` is the **lost-device** path. It
 * deliberately does not consult the second-factor policy — an operator whose
 * phone is gone has to be let back in whatever the policy says — and that is
 * exactly why `canResetSecondFactorOf` refuses it for one's own account: a path
 * that ignores policy must not be reachable by the account it would weaken, or
 * a stolen session could permanently strip its own second factor.
 *
 * The console rendered the button on every enrolled row, including yours. The
 * comment above it said "never for your own"; the code had no such condition.
 * So the most obvious control on the screen answered 403 every time, with
 * "Die Aktion konnte nicht ausgeführt werden" and no hint of where to go
 * instead — which is the Sicherheit screen, where removing your own factor is
 * governed by the policy that applies to you.
 *
 * Offering a control that cannot succeed is the same defect as offering a
 * navigation entry that can only error, and it is worth a test for the same
 * reason: nothing else fails when the condition is dropped.
 *
 * The client is a plain object rather than a mock proxy, on
 * `ParticipantAccounts.test.tsx`'s reasoning: a method the component starts
 * calling and this file does not provide should be a `TypeError` here, not a
 * silently recorded call that passes.
 */

import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import type { ApiClient, StaffAccount } from "@ds/sdk";
import { StaffAccounts } from "./StaffAccounts.js";
import { de } from "../locale/de.js";

afterEach(cleanup);

const OWN_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";

function account(overrides: Partial<StaffAccount> = {}): StaffAccount {
  return {
    id: OWN_ID,
    email: "testing@digitalspital.example",
    displayName: "testingDS",
    disabledAt: null,
    lastLoginAt: "2026-08-10T09:00:00.000Z",
    totpEnrolled: true,
    grants: [{ role: "super_admin", customerId: null, departmentId: null }],
    ...overrides,
  };
}

function renderScreen(rows: StaffAccount[]) {
  const client = {
    adminListStaff: vi.fn(async () => rows),
  } as unknown as ApiClient;

  render(
    <StaffAccounts
      client={client}
      ownAccountId={OWN_ID}
      customerId={null}
      customers={[]}
    />,
  );

  return client;
}

/** The row for one account, found by the address shown in it. */
async function rowFor(email: string): Promise<HTMLElement> {
  const cell = await screen.findByText(email);
  const row = cell.closest("tr");
  if (row === null) throw new Error(`no row around ${email}`);
  return row;
}

it("does not offer a second-factor reset on the signed-in operator's own row", async () => {
  renderScreen([account()]);

  const own = await rowFor("testing@digitalspital.example");

  // The row is there and usable — this is not "the screen failed to render".
  expect(
    within(own).getByRole("button", { name: de.staff.signOutEverywhere }),
  ).toBeTruthy();

  expect(
    within(own).queryByRole("button", { name: de.staff.resetSecondFactor }),
  ).toBeNull();
});

it("still offers it on somebody else's row, which is what the button is for", async () => {
  renderScreen([
    account(),
    account({
      id: OTHER_ID,
      email: "kollegin@digitalspital.example",
      displayName: "Kollegin",
      grants: [{ role: "customer_admin", customerId: OWN_ID, departmentId: null }],
    }),
  ]);

  const other = await rowFor("kollegin@digitalspital.example");
  await waitFor(() => {
    expect(
      within(other).getByRole("button", { name: de.staff.resetSecondFactor }),
    ).toBeTruthy();
  });
});

it("offers it on nobody's row who has no factor to reset", async () => {
  renderScreen([
    account({
      id: OTHER_ID,
      email: "neu@digitalspital.example",
      displayName: "Neu",
      totpEnrolled: false,
      grants: [{ role: "customer_admin", customerId: OWN_ID, departmentId: null }],
    }),
  ]);

  const row = await rowFor("neu@digitalspital.example");
  expect(
    within(row).queryByRole("button", { name: de.staff.resetSecondFactor }),
  ).toBeNull();
});
