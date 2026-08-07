/**
 * The console shell, which had no tests at all until four bugs in a row shipped
 * from it (P22-05).
 *
 * ## Why this file exists, stated plainly
 *
 * The console's only tests were for two pure helpers — `media-duration` and
 * `structure-order`. Nothing rendered a component. So the API had 253
 * integration tests and the layer the operator actually touches had none, and
 * every one of these reached production:
 *
 * | Bug | What it was |
 * | --- | --- |
 * | P22-03 | A tenant screen fetched with no customer chosen and got a 422 |
 * | P22-03 | The resulting error replaced the whole page, hiding the picker that would have fixed it |
 * | P22-04 | A reloaded tab had no CSRF token and could read but not write |
 * | P22-05 | Creating a customer did not refresh the picker, so the console insisted no customer existed |
 *
 * Every one is a **state** bug in the shell, and every one is cheap to catch
 * here. None of them would have been caught by a test that checked markup — so
 * these assert behaviour: what is requested, what is rendered after a change,
 * and what survives a failure.
 *
 * ## What is deliberately not tested
 *
 * Appearance. Whether a heading is `text-lg` is not a property worth freezing,
 * and a test that asserts it fails on every visual change while catching none
 * of the above.
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Console } from "./App.js";
import type { StaffProfile } from "./staff-auth.js";

afterEach(cleanup);

const SUPER_ADMIN: StaffProfile = {
  id: "admin-1",
  email: "testing@digitalspital.de",
  displayName: "Testing",
  role: "super_admin",
  secondFactorEnrolled: true,
  capabilities: [
    "customer",
    "department",
    "project",
    "course",
    "content",
    "staff_user",
    "learner_record",
    "certificate",
  ],
  // A super administrator belongs to no customer, which is the case that makes
  // the picker necessary and is the state a fresh installation starts in.
  grants: [{ role: "super_admin", customerId: null, departmentId: null }],
};

const MEDICE = {
  id: "cust-medice",
  slug: "medice",
  name: "Medice",
  createdAt: "2026-08-07T00:00:00Z",
  departmentCount: 0,
  projectCount: 0,
  courseCount: 0,
};

/**
 * A fake `ApiClient` recording what the console asked for.
 *
 * Only the methods the shell reaches for. A full double would be a second
 * implementation of the SDK to keep in step, and the SDK's own contract is
 * covered by `routes.test.ts` — path and verb against `openapi.yaml`.
 */
function fakeClient(over: Partial<Record<string, unknown>> = {}) {
  return {
    adminListCourses: vi.fn().mockResolvedValue([]),
    adminListCustomers: vi.fn().mockResolvedValue([]),
    adminCreateCustomer: vi.fn().mockResolvedValue(MEDICE),
    adminDeleteCustomer: vi.fn().mockResolvedValue(undefined),
    ...over,
  } as never;
}

function renderConsole(clients: { admin?: unknown; platform?: unknown } = {}) {
  const admin = clients.admin ?? fakeClient();
  const platform = clients.platform ?? fakeClient();
  return {
    admin,
    platform,
    ...render(
      <Console
        config={{ apiBase: "http://api.test" }}
        profile={SUPER_ADMIN}
        onExpired={() => undefined}
        // Injected rather than constructed inside, so a test can see what the
        // console asked for. The production path builds them from `config`.
        makeAdminClient={() => admin as never}
        makePlatformClient={() => platform as never}
      />,
    ),
  };
}

describe("a super admin with no customer chosen (P22-03)", () => {
  it("does not ask for courses at all", async () => {
    const admin = fakeClient();
    renderConsole({ admin });

    // Wait for the shell to have settled, then assert on what was *not* asked.
    await waitFor(() => expect(screen.getByRole("combobox")).toBeTruthy());

    // The bug: the fetch went out anyway and the API answered 422, correctly.
    // Not asking is the fix; the guard on the *screen* alone was half of it.
    expect(
      (admin as never as { adminListCourses: { mock: { calls: unknown[] } } })
        .adminListCourses.mock.calls.length,
    ).toBe(0);
  });

  it("says a customer must be created when none exists", async () => {
    renderConsole();
    await waitFor(() =>
      expect(screen.getByText(/noch kein Kunde angelegt/)).toBeTruthy(),
    );
  });

  it("says a customer must be chosen when some exist", async () => {
    const platform = fakeClient({
      adminListCustomers: vi.fn().mockResolvedValue([MEDICE]),
    });
    renderConsole({ platform });

    // Different advice, because "pick one above" is unhelpful when there is
    // nothing to pick and "create one" is wrong when there is.
    await waitFor(() =>
      expect(screen.getByText(/wählen Sie oben einen Kunden/)).toBeTruthy(),
    );
  });

  it("keeps the navigation and the picker visible while a request fails", async () => {
    // The bug this pins: the error replaced the whole page, so the customer
    // picker — the control that would have cleared it — was behind the error,
    // and the only way out was signing out.
    const platform = fakeClient({
      adminListCustomers: vi.fn().mockResolvedValue([MEDICE]),
    });
    const admin = fakeClient({
      adminListCourses: vi.fn().mockRejectedValue(new Error("boom")),
    });
    renderConsole({ admin, platform });

    await waitFor(() => expect(screen.getByRole("combobox")).toBeTruthy());
    fireEvent.change(screen.getByRole("combobox"), { target: { value: MEDICE.id } });

    await waitFor(() => expect(screen.getByText(/Fehler/)).toBeTruthy());
    // Both still on screen, next to the error.
    expect(screen.getByRole("combobox")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Kunden" })).toBeTruthy();
  });
});

describe("choosing a customer (P22-03)", () => {
  it("loads that customer's courses once it is chosen", async () => {
    const platform = fakeClient({
      adminListCustomers: vi.fn().mockResolvedValue([MEDICE]),
    });
    const admin = fakeClient();
    renderConsole({ admin, platform });

    await waitFor(() => expect(screen.getByRole("combobox")).toBeTruthy());
    fireEvent.change(screen.getByRole("combobox"), { target: { value: MEDICE.id } });

    await waitFor(() =>
      expect(
        (admin as never as { adminListCourses: { mock: { calls: unknown[] } } })
          .adminListCourses.mock.calls.length,
      ).toBe(1),
    );
  });

  it("offers every customer the registry returned", async () => {
    const platform = fakeClient({
      adminListCustomers: vi
        .fn()
        .mockResolvedValue([
          MEDICE,
          { ...MEDICE, id: "cust-ds", slug: "ds", name: "DS" },
        ]),
    });
    renderConsole({ platform });

    await waitFor(() => expect(screen.getByRole("combobox")).toBeTruthy());
    const options = [...screen.getByRole("combobox").querySelectorAll("option")].map(
      (o) => o.textContent,
    );
    expect(options).toContain("Medice");
    expect(options).toContain("DS");
  });
});

describe("creating a customer refreshes the picker (P22-05)", () => {
  it("offers the new customer without a page reload", async () => {
    // The reported bug, exactly: the Kunden table listed the customer that had
    // just been created and every other screen went on insisting none existed,
    // because the shell and that screen each held their own copy of the list.
    const list = vi.fn().mockResolvedValueOnce([]).mockResolvedValue([MEDICE]);
    const platform = fakeClient({
      adminListCustomers: list,
      adminCreateCustomer: vi.fn().mockResolvedValue(MEDICE),
    });
    renderConsole({ platform });

    await waitFor(() =>
      expect(screen.getByText(/noch kein Kunde angelegt/)).toBeTruthy(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Kunden" }));
    await waitFor(() => expect(screen.getByLabelText("Name")).toBeTruthy());

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Medice" } });
    fireEvent.change(screen.getByLabelText("Kürzel"), { target: { value: "medice" } });
    fireEvent.click(screen.getByRole("button", { name: "Kunde anlegen" }));

    // The shell's own list must have been re-read — one fetch on mount, one
    // after the create — and the picker must now offer it.
    await waitFor(() => expect(list.mock.calls.length).toBeGreaterThanOrEqual(2));
    await waitFor(() => {
      const options = [...screen.getByRole("combobox").querySelectorAll("option")].map(
        (o) => o.textContent,
      );
      expect(options).toContain("Medice");
    });
  });
});
