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

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Console } from "./App.js";
import type { StaffProfile } from "./staff-auth.js";
import { de } from "./locale/de.js";

afterEach(cleanup);

// The chosen customer is remembered in `localStorage` (P22-08), so a test that
// selected one would otherwise hand it to the next — which is a fresh browser
// in every case that matters.
afterEach(() => window.localStorage.clear());

// Same argument, for the address bar. Since P42-01 the console writes its screen
// into the fragment, and jsdom keeps one URL for the whole file — so a test that
// navigated would leave the next one mounting on that screen instead of the
// course list. This surfaced as "Neue Fortbildung is not on the page", which
// reads like a rendering bug and is not one.
afterEach(() => window.history.replaceState(null, "", "/"));

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
    // The screens each section mounts read more than the shell does. Empty
    // lists rather than rejections: what is under test here is the frame, and
    // a screen erroring would prove the error state keeps the layout rather
    // than the screen doing so.
    adminListDepartments: vi.fn().mockResolvedValue([]),
    adminListProjects: vi.fn().mockResolvedValue([]),
    adminListLearners: vi.fn().mockResolvedValue([]),
    adminListCertificates: vi.fn().mockResolvedValue([]),
    adminListStaff: vi.fn().mockResolvedValue([]),
    adminGetFont: vi.fn().mockResolvedValue({
      fontFamilyName: null,
      fontVersion: null,
      fontBytes: null,
    }),
    adminGetBranding: vi.fn().mockResolvedValue({}),
    adminGetSecondFactorPolicy: vi
      .fn()
      .mockResolvedValue({ platform: "required", customers: [] }),
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

describe("the chosen customer survives a reload (P22-08)", () => {
  it("remembers it, scoped to this operator", async () => {
    // It was component state, so every reload dropped it and a super
    // administrator landed back on "pick a customer" — which is every reload,
    // and there are plenty while setting a customer up.
    const platform = fakeClient({
      adminListCustomers: vi.fn().mockResolvedValue([MEDICE]),
    });
    const { unmount } = renderConsole({ platform });

    await waitFor(() => expect(screen.getByRole("combobox")).toBeTruthy());
    fireEvent.change(screen.getByRole("combobox"), { target: { value: MEDICE.id } });

    await waitFor(() =>
      expect(window.localStorage.getItem(`ds.admin.customer.${SUPER_ADMIN.id}`)).toBe(
        MEDICE.id,
      ),
    );

    // Remount, which is what a reload is from the component's point of view.
    unmount();
    const again = fakeClient({
      adminListCustomers: vi.fn().mockResolvedValue([MEDICE]),
    });
    const admin = fakeClient();
    renderConsole({ admin, platform: again });

    // Straight to that customer's courses, with no second selection.
    await waitFor(() =>
      expect(
        (admin as never as { adminListCourses: { mock: { calls: unknown[] } } })
          .adminListCourses.mock.calls.length,
      ).toBe(1),
    );
  });

  it("does not carry one operator's choice to another account", async () => {
    // A super admin and their own customer-scoped account are different
    // scopes; switching between them on one browser must not inherit.
    window.localStorage.setItem("ds.admin.customer.somebody-else", MEDICE.id);

    const admin = fakeClient();
    const platform = fakeClient({
      adminListCustomers: vi.fn().mockResolvedValue([MEDICE]),
    });
    renderConsole({ admin, platform });

    await waitFor(() => expect(screen.getByRole("combobox")).toBeTruthy());
    expect(
      (admin as never as { adminListCourses: { mock: { calls: unknown[] } } })
        .adminListCourses.mock.calls.length,
    ).toBe(0);
  });
});

describe("every screen renders inside the layout (P22-09)", () => {
  /**
   * The reported bug: *"the fortbuild page comes out of the layout"*.
   *
   * The course editor and the new-course form returned above the point where
   * the frame is built, so they drew with no sidebar and no app bar — content
   * to the left edge of the window and every navigation target gone at once.
   *
   * The cause is structural rather than a typo, which is why it gets a test
   * rather than only a fix: the frame is assembled halfway down a long
   * component, so *any* return above that line escapes it silently. This
   * asserts the property directly — whatever screen is open, the navigation is
   * on it — so the next screen added above that line fails here instead of in
   * somebody's browser.
   */
  async function openConsole() {
    const platform = fakeClient({
      adminListCustomers: vi.fn().mockResolvedValue([MEDICE]),
    });
    const admin = fakeClient({
      adminListCourses: vi.fn().mockResolvedValue([]),
    });
    renderConsole({ admin, platform });
    await waitFor(() => expect(screen.getByRole("combobox")).toBeTruthy());
    fireEvent.change(screen.getByRole("combobox"), { target: { value: MEDICE.id } });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Kunden" })).toBeTruthy(),
    );
  }

  /** The sidebar and the app bar, which together are "the layout". */
  function layoutIsPresent(): boolean {
    return (
      screen.queryAllByRole("button", { name: "Kunden" }).length > 0 &&
      screen.queryAllByRole("combobox").length > 0
    );
  }

  it("keeps the layout on the new-course screen", async () => {
    await openConsole();

    fireEvent.click(screen.getByRole("button", { name: /Neue Fortbildung/ }));
    await waitFor(() => expect(layoutIsPresent()).toBe(true));
  });

  it("keeps the layout on every top-level section", async () => {
    await openConsole();

    // Walking them all rather than picking one: the bug was a *class*, and any
    // section could join it the next time somebody adds an early return.
    for (const label of [
      "Organisation",
      "Erscheinungsbild",
      "Teilnehmende",
      "Bescheinigungen",
      "Konten",
      "Kunden",
      "Sicherheit",
      "Fortbildungen",
    ]) {
      fireEvent.click(screen.getAllByRole("button", { name: label })[0]!);
      await waitFor(() =>
        expect(layoutIsPresent(), `${label} rendered outside the layout`).toBe(true),
      );
    }
  });
});

describe("the screen is in the address bar (P42-01)", () => {
  /**
   * The reported bug: *"in the admin panel, with page changes, the route does
   * not change"*.
   *
   * `routes.test.ts` covers `encode`/`decode` exhaustively, and would have
   * passed on the broken console — because the console never called them. So
   * these assert the wiring rather than the functions: what the address bar says
   * after a click, and what is drawn when the address bar says it first.
   *
   * The three properties are the three things an operator lost: a linkable URL,
   * a reload that keeps your place, and a back button that moves within the
   * console instead of leaving it.
   */
  async function openConsole() {
    const platform = fakeClient({
      adminListCustomers: vi.fn().mockResolvedValue([MEDICE]),
    });
    const admin = fakeClient({ adminListCourses: vi.fn().mockResolvedValue([]) });
    renderConsole({ admin, platform });
    await waitFor(() => expect(screen.getByRole("combobox")).toBeTruthy());
    fireEvent.change(screen.getByRole("combobox"), { target: { value: MEDICE.id } });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Kunden" })).toBeTruthy(),
    );
  }

  it("writes the screen into the fragment when the operator navigates", async () => {
    await openConsole();

    fireEvent.click(screen.getAllByRole("button", { name: "Konten" })[0]!);
    await waitFor(() => expect(window.location.hash).toBe("#/konten"));

    fireEvent.click(screen.getAllByRole("button", { name: "Sicherheit" })[0]!);
    await waitFor(() => expect(window.location.hash).toBe("#/sicherheit"));
  });

  it("opens the screen the fragment names, so a reload keeps your place", async () => {
    // The half that a click test cannot reach: mounting *at* a route. Without
    // it the console could write fragments it then ignored on load, which is
    // worse than no fragment — the URL would be confidently wrong.
    window.history.replaceState(null, "", "#/bescheinigungen");
    await openConsole();

    await waitFor(() =>
      expect(screen.getAllByRole("heading", { name: "Bescheinigungen" }).length).toBe(1),
    );
  });

  it("moves back within the console rather than out of it", async () => {
    await openConsole();

    fireEvent.click(screen.getAllByRole("button", { name: "Konten" })[0]!);
    await waitFor(() => expect(window.location.hash).toBe("#/konten"));

    // jsdom does not run history traversal, so the event the browser would fire
    // is fired here. What is under test is the listener, not jsdom's history.
    window.history.replaceState(null, "", "#/teilnehmende");
    window.dispatchEvent(new PopStateEvent("popstate"));

    await waitFor(() =>
      expect(screen.getAllByRole("heading", { name: "Teilnehmende" }).length).toBe(1),
    );
  });
});

describe("one page frame, on every screen (P30-02)", () => {
  /**
   * The redesign's whole claim is that the console is one thing rather than ten.
   * These assert the properties that claim rests on, because each of them was
   * false before and each is cheap to break again by adding a screen that draws
   * its own heading.
   */
  async function openConsole() {
    const platform = fakeClient({
      adminListCustomers: vi.fn().mockResolvedValue([MEDICE]),
    });
    const admin = fakeClient({ adminListCourses: vi.fn().mockResolvedValue([]) });
    renderConsole({ admin, platform });
    await waitFor(() => expect(screen.getByRole("combobox")).toBeTruthy());
    fireEvent.change(screen.getByRole("combobox"), { target: { value: MEDICE.id } });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Kunden" })).toBeTruthy(),
    );
  }

  it("groups the navigation, and labels each group", async () => {
    await openConsole();

    // Ten flat destinations is a list re-read top to bottom every time. The
    // groups are what make the shape of the console legible at a glance.
    for (const group of ["Angebot", "Teilnahme", "Einstellungen"]) {
      expect(screen.getByRole("list", { name: group })).toBeTruthy();
    }
  });

  it("draws exactly one page heading per screen", async () => {
    await openConsole();

    /*
     * The defect this pins: several screens drew their own `h2` on top of the
     * one the frame draws, so the operator read the same words twice in two
     * different sizes — and three others drew none at all. The sidebar's group
     * labels used to be `h2` too, which is why they are now a labelled list.
     */
    for (const [label, title] of [
      ["Organisation", "Organisation"],
      ["Erscheinungsbild", "Erscheinungsbild"],
      ["Zugänge", "Zugänge"],
      ["Teilnehmende", "Teilnehmende"],
      ["Bescheinigungen", "Bescheinigungen"],
      ["Konten", "Konten"],
      ["Kunden", "Kunden"],
      ["Sicherheit", "Sicherheit"],
      ["Fortbildungen", "Fortbildungen"],
    ] as const) {
      fireEvent.click(screen.getAllByRole("button", { name: label })[0]!);
      await waitFor(() => {
        const headings = screen.getAllByRole("heading", { level: 2 });
        expect(headings.length, `${label} drew ${headings.length} headings`).toBe(1);
        expect(headings[0]!.textContent).toBe(title);
      });
    }
  });

  it("offers the create button once, not twice, on an empty list", async () => {
    await openConsole();

    // The empty state carries the invitation, so the header action stands down.
    // Two buttons with one accessible name is both a pointless choice and an
    // a11y defect.
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: /Neue Fortbildung/ }).length).toBe(1),
    );
  });

  it("puts a trail on the new-course form that leads back to the list", async () => {
    await openConsole();

    fireEvent.click(screen.getByRole("button", { name: /Neue Fortbildung/ }));
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(
        "Neue Fortbildung anlegen",
      ),
    );

    // The trail is the way back. It replaced a "Zurück" button that did not say
    // where back was.
    const trail = screen.getByRole("navigation", { name: "Pfad" });
    const back = within(trail).getByRole("button", { name: "Fortbildungen" });
    fireEvent.click(back);

    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Fortbildungen"),
    );
  });
});

/**
 * The build footer is *drawn*, not merely importable (P46-01).
 *
 * CLAUDE.md §9.7: `@ds/build-info` has thirteen unit tests and every one of
 * them would stay green on a console that never rendered the component. The
 * property that matters here is the wiring — that `Shell` puts it on the page,
 * and that it reaches the API for the second number — so it needs its own test
 * at the call site.
 *
 * Confirmed by deleting the `<BuildFooter …/>` line from `Shell` and watching
 * both cases fail.
 */
describe("the build footer (P46-01)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete window.__DS_CONFIG__;
  });

  function stubHealth(commit: string) {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: "ok", database: true, commit }),
      }),
    );
  }

  it("shows this bundle's commit, in the short form docker images prints", async () => {
    window.__DS_CONFIG__ = { apiBase: "http://api.test", commit: "4601f19aaaaaaa" };
    stubHealth("4601f19aaaaaaa");

    renderConsole();

    expect(await screen.findByText("4601f19")).toBeTruthy();
  });

  it("names a version skew in German — the case it exists for", async () => {
    // A deploy that rebuilt the API and not the console. The console then shows
    // a screen the API does not serve, and every report about it is a report
    // about the wrong build (CLAUDE.md §9.9).
    window.__DS_CONFIG__ = { apiBase: "http://api.test", commit: "4601f19aaaaaaa" };
    stubHealth("e258c8dbbbbbbb");

    renderConsole();

    expect(await screen.findByText(de.build.skew)).toBeTruthy();
  });

  it("still renders when the API cannot be reached", async () => {
    // The state somebody is most likely reading the footer in. The console's
    // own build is still the useful half of the answer.
    window.__DS_CONFIG__ = { apiBase: "http://api.test", commit: "4601f19aaaaaaa" };
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("refused")));

    renderConsole();

    expect(await screen.findByText("4601f19")).toBeTruthy();
    expect(screen.queryByText(de.build.skew)).toBeNull();
  });
});
