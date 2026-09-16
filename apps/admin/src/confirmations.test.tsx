/**
 * The console says when something worked, and it does so without any screen
 * having arranged for it (P238-01).
 *
 * ## Why this file exists
 *
 * `useSaver` has computed a `"saved"` state since P9-02, and the audit before
 * this change found **four of the nine screens that own a saver rendered it**.
 * The other five — the authoring tree, the EIV check, the learner corrections,
 * the new-course form and the whole Organisation screen, eleven of the fifteen
 * `useSaver` instances between them — set the flag and drew nothing. Delete a
 * module, erase a participant's record, create a project: no acknowledgement at
 * all. The client's words were *"not even a toast for success"*, and the audit
 * is the reason that is a statement about the architecture rather than about
 * one screen.
 *
 * `toasts.tsx` had exported `useToasts` since the day it was written **and
 * nothing called it** — the host had exactly one publisher, the failure net in
 * `api.ts`. §9.3 in the file whose whole job is to prevent silence.
 *
 * ## What is under test, and what would pass without it
 *
 * Three layers, because each is green while the next is broken:
 *
 * 1. `run` publishes — the net itself. Green on a console where no screen calls
 *    `run`, so on its own it proves nothing about the product (§9.7).
 * 2. A **real previously-silent screen** produces the sentence. This is the
 *    caller, and the reason the file renders `Organisation` rather than a
 *    harness: it is one of the five that said nothing.
 * 3. The two kinds are announced **differently**. A confirmation routed through
 *    `role="alert"` in an assertive region interrupts a screen reader
 *    mid-sentence to report that a save worked, and a screenshot cannot see
 *    that any more than it can see a missing label.
 *
 * `journey.spec.ts` is the fourth layer and the only one that watches a browser
 * do it (§9.13).
 */

import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ApiClient, DepartmentSummary, ProjectSummary } from "@ds/sdk";
import { ToastProvider, type Publish } from "./toasts.js";
import { useSaver } from "./hooks.js";
import { Organisation } from "./components/Organisation.js";
import { de } from "./locale/de.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** A host for the toasts, with whatever the case wants to render inside it. */
function mount(children: React.ReactNode) {
  const publishRef: { current: Publish } = { current: () => undefined };
  return render(<ToastProvider publishRef={publishRef}>{children}</ToastProvider>);
}

describe("the confirmation net", () => {
  function Screen(props: { action: () => Promise<unknown> }) {
    const saver = useSaver();
    return (
      <button
        type="button"
        onClick={() => void saver.run("Es hat geklappt.", props.action)}
      >
        speichern
      </button>
    );
  }

  it("announces a mutation that worked, with no screen having arranged for it", async () => {
    mount(<Screen action={async () => undefined} />);
    fireEvent.click(screen.getByText("speichern"));

    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain("Es hat geklappt."),
    );
  });

  it("says nothing when the mutation failed", async () => {
    /*
     * The case the whole change could have got backwards. `run` resolves
     * `false` on a rejection and the screen shows `problem` — a green
     * "Gespeichert." over a refused save is worse than the silence this
     * replaces, because it is an answer rather than an absence.
     *
     * The failure's own toast comes from the net in `api.ts`, which this
     * action does not go through, so the absence asserted here is complete.
     */
    mount(
      <Screen
        action={async () => {
          throw new Error("nope");
        }}
      />,
    );
    fireEvent.click(screen.getByText("speichern"));

    await waitFor(() => expect(screen.queryByText("speichern")).toBeTruthy());
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("does not announce to a screen the operator has already left", async () => {
    /*
     * A slow save whose screen unmounts first. The confirmation would be a
     * message about something no longer on screen, and `alive` is what stops
     * it — the same guard the `setState` below it has had since P9-02.
     *
     * ## The host has to outlive the screen, or this proves nothing
     *
     * The first version of this case called `view.unmount()`, which takes the
     * `ToastProvider` down with the screen — so there was nowhere for a toast
     * to appear and the assertion held whether the guard existed or not.
     * Caught by sabotage: removing the guard left all five cases green (§9.1).
     *
     * So only the child is unmounted, by a switch the provider owns, which is
     * also the shape of the real case — the shell keeps its toast host while
     * the operator navigates between screens.
     */
    let finish = (): void => undefined;
    let leave = (): void => undefined;

    function Shell() {
      const [here, setHere] = useState(true);
      leave = () => setHere(false);
      return here ? (
        <Screen action={() => new Promise<void>((resolve) => (finish = resolve))} />
      ) : (
        <p>woanders</p>
      );
    }

    mount(<Shell />);
    fireEvent.click(screen.getByText("speichern"));
    act(() => leave());
    expect(screen.getByText("woanders")).toBeTruthy();

    await act(async () => {
      finish();
    });
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("how the two kinds are announced", () => {
  it("puts a confirmation in a polite region and a failure in an assertive one", async () => {
    /*
     * A live region's urgency belongs to the region, not to what is put in it,
     * so this is the assertion that one shared container cannot satisfy.
     */
    const publishRef: { current: Publish } = { current: () => undefined };
    render(<ToastProvider publishRef={publishRef}>{null}</ToastProvider>);

    act(() => {
      publishRef.current("Gespeichert.", "success");
      publishRef.current("Abgelehnt.", "error");
    });

    const ok = await screen.findByRole("status");
    const bad = await screen.findByRole("alert");

    expect(ok.textContent).toContain("Gespeichert.");
    expect(bad.textContent).toContain("Abgelehnt.");
    expect(ok.closest("[aria-live]")?.getAttribute("aria-live")).toBe("polite");
    expect(bad.closest("[aria-live]")?.getAttribute("aria-live")).toBe("assertive");
  });
});

describe("a screen that said nothing before", () => {
  const DEPARTMENT: DepartmentSummary = {
    slug: "default",
    name: "Standard",
    projectCount: 1,
  };

  function project(): ProjectSummary {
    return {
      slug: "medice",
      name: "MEDICE",
      departmentSlug: "default",
      copyOverrides: {},
      identityProvider: "keycloak",
      loginUrl: null,
      docCheckLoginAllowed: false,
      keycloakLoginAllowed: true,
      keycloakIssuer: "https://auth.example.de/realms/medice",
      keycloakAudience: "ds-widget",
      keycloakRealm: "medice",
      embedOrigins: [],
      smtpHost: null,
      smtpPort: null,
      smtpUsername: null,
      smtpFromAddress: null,
      smtpFromName: null,
      hasSmtpPassword: false,
      branding: {},
      courseCount: 1,
    };
  }

  it("confirms a created project, which Organisation never did", async () => {
    /*
     * `Organisation` owns four savers and rendered no success signal for any
     * of them — `grep -c 'tone="success"'` returns 0 on the file before this
     * change. It is here rather than a harness because a harness would pass on
     * a console where `Organisation` still called nothing.
     */
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 403 })),
    );
    const client = {
      adminListDepartments: vi.fn(async () => [DEPARTMENT]),
      adminListProjects: vi.fn(async () => [project()]),
      adminCreateProject: vi.fn(async () => [project()]),
    } as unknown as ApiClient;

    mount(<Organisation apiBase="https://api.example.de" client={client} />);

    fireEvent.click(await screen.findByText(de.organisation.newProject));
    fireEvent.change(screen.getByLabelText(de.common.name), {
      target: { value: "Portal" },
    });
    fireEvent.click(screen.getByText(de.common.add));

    await waitFor(() => expect(client.adminCreateProject).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain(de.confirm.projectCreated),
    );
  });
});
