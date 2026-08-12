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
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ApiClient, StaffAccount } from "@ds/sdk";
import { StaffAccounts } from "./StaffAccounts.js";
import { de } from "../locale/de.js";

afterEach(cleanup);

const OWN_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";
const CUSTOMER_ID = "33333333-3333-4333-8333-333333333333";

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

function renderScreen(
  rows: StaffAccount[],
  extra: Partial<Record<string, unknown>> = {},
  /*
   * The inviter's own customer. `null` means a super admin who spans them, and
   * then every non-super invitation has to name one — so a test that leaves it
   * null and supplies no customers renders a form whose submit button is
   * correctly disabled, and asserts nothing.
   */
  customerId: string | null = null,
) {
  const client = {
    adminListStaff: vi.fn(async () => rows),
    ...extra,
  } as unknown as ApiClient;

  render(
    <StaffAccounts
      client={client}
      ownAccountId={OWN_ID}
      customerId={customerId}
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

/*
 * Creating an account with a password, and changing one (P64-01).
 *
 * These two were impossible before, and the reason they were impossible was not
 * visible on the screen — the form had no password field and no row had a
 * password control, so "how do I do this" had no answer to read. So what is
 * asserted here is that the controls exist, are labelled in German, and reach
 * the API method they claim to.
 */
it("sends the password when one is typed, and confirms without an invitation link", async () => {
  const adminInviteStaff = vi.fn(async () => ({
    status: "created",
    token: null,
    delivered: false,
  }));
  renderScreen([account()], { adminInviteStaff }, CUSTOMER_ID);

  fireEvent.change(await screen.findByLabelText(de.staff.name), {
    target: { value: "Neuer Operator" },
  });
  fireEvent.change(screen.getByLabelText(de.staff.email), {
    target: { value: "neu@ds.example" },
  });
  fireEvent.change(screen.getByLabelText(de.staff.password), {
    target: { value: "Sommerregen-Iserlohn-2026" },
  });

  // The button says which of the two things is about to happen. That is the
  // whole affordance: the form's behaviour changes with a field, and the label
  // is where somebody finds that out before clicking.
  fireEvent.click(screen.getByRole("button", { name: de.staff.createWithPassword }));

  await waitFor(() => {
    expect(adminInviteStaff).toHaveBeenCalledWith(
      expect.objectContaining({ password: "Sommerregen-Iserlohn-2026" }),
    );
  });

  // `token: null` came back, so there is nothing to hand over and the
  // invitation box must not appear pretending otherwise.
  expect(await screen.findByText(de.staff.createdTitle)).toBeTruthy();
  expect(screen.queryByText(de.staff.inviteCreated)).toBeNull();
});

it("omits the password entirely when the field is left empty, and invites instead", async () => {
  // The API chooses its path on the field's *presence*. An empty string is a
  // password somebody typed nothing into, not a request to invite.
  const adminInviteStaff = vi.fn(async (_input: { password?: string }) => ({
    status: "invited",
    token: "a-token",
    delivered: false,
  }));
  renderScreen([account()], { adminInviteStaff }, CUSTOMER_ID);

  fireEvent.change(await screen.findByLabelText(de.staff.name), {
    target: { value: "Eingeladene Person" },
  });
  fireEvent.change(screen.getByLabelText(de.staff.email), {
    target: { value: "einladung@ds.example" },
  });
  fireEvent.click(screen.getByRole("button", { name: de.staff.invite }));

  await waitFor(() => {
    expect(adminInviteStaff).toHaveBeenCalledTimes(1);
  });
  expect(adminInviteStaff.mock.calls.at(0)?.at(0)).not.toHaveProperty("password");
});

it("offers a password change on every row, including the signed-in operator's own", async () => {
  /*
   * The mirror of the second-factor rule above, and deliberately the opposite
   * answer. A self-reset of the second factor is refused by the API, so
   * offering it is offering an error. Changing your own password is permitted,
   * ordinary, and something somebody will look for on their own row — so
   * hiding it there would be the same defect pointing the other way.
   */
  const adminSetStaffPassword = vi.fn(async () => undefined);
  renderScreen([account(), account({ id: OTHER_ID, email: "andere@ds.example" })], {
    adminSetStaffPassword,
  });

  const own = await rowFor("testing@digitalspital.example");
  // By its accessible name, not its visible text: the button carries an
  // `ariaLabel` naming the account, because a column of identical "Passwort
  // setzen" buttons reads to a screen reader as one repeated control.
  fireEvent.click(
    within(own).getByRole("button", {
      name: de.staff.setPasswordFor("testing@digitalspital.example"),
    }),
  );
  fireEvent.change(within(own).getByLabelText(de.staff.newPassword), {
    target: { value: "Ganz-Anderes-Passwort-2026" },
  });
  fireEvent.click(within(own).getByRole("button", { name: de.common.save }));

  await waitFor(() => {
    expect(adminSetStaffPassword).toHaveBeenCalledWith(
      OWN_ID,
      "Ganz-Anderes-Passwort-2026",
    );
  });
});
