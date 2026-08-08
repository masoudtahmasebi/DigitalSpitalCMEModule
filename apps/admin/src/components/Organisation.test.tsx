/**
 * The organisation screen, rendered — specifically the one control that
 * decides how a project's participants sign in (P28-02).
 *
 * ## Why this file exists
 *
 * `identity_provider` was in the schema, in a CHECK constraint, and read on
 * every learner request, and **nothing could write it**. Fixing that in the API
 * left the same bug one layer up for an afternoon: the endpoint accepted the
 * value and the console had no way to send it, so a customer who wanted the
 * standalone portal still got a `keycloak` project whose participants cannot
 * sign in at all.
 *
 * An integration test cannot see that. It calls the endpoint directly, which is
 * exactly the step the operator does not have. So the assertions here are about
 * what an operator can pick and what is actually sent.
 *
 * The client is a plain object rather than a mock proxy, for the reason given
 * in `ParticipantAccounts.test.tsx`: a method the component starts calling and
 * this file does not provide should be a `TypeError` here, not a silently
 * recorded call that passes.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ApiClient, DepartmentSummary, ProjectSummary } from "@ds/sdk";
import { Organisation } from "./Organisation.js";
import { de } from "../locale/de.js";

afterEach(cleanup);

const DEPARTMENT: DepartmentSummary = {
  slug: "default",
  name: "Standard",
  projectCount: 1,
};

function project(overrides: Partial<ProjectSummary> = {}): ProjectSummary {
  return {
    slug: "medice",
    name: "MEDICE",
    departmentSlug: "default",
    identityProvider: "keycloak",
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
    ...overrides,
  };
}

function clientWith(
  projects: readonly ProjectSummary[],
  overrides: Partial<Record<string, unknown>> = {},
): ApiClient {
  return {
    adminListDepartments: vi.fn(async () => [DEPARTMENT]),
    adminListProjects: vi.fn(async () => projects),
    adminCreateProject: vi.fn(async () => [...projects]),
    adminUpdateProject: vi.fn(async () => [...projects]),
    ...overrides,
  } as unknown as ApiClient;
}

/** Open the "new project" form and fill in the name, which drives the slug. */
async function openNewProject(): Promise<void> {
  fireEvent.click(await screen.findByText(de.organisation.newProject));
  fireEvent.change(screen.getByLabelText(de.common.name), {
    target: { value: "Portal" },
  });
}

describe("creating a project", () => {
  it("offers both sign-in methods, and defaults to Keycloak", async () => {
    render(<Organisation client={clientWith([project()])} />);
    await openNewProject();

    const select = screen.getByLabelText(
      de.organisation.identityProvider,
    ) as HTMLSelectElement;

    // Keycloak first and preselected: it is what every existing project is, and
    // a default that silently changes what a form does is its own bug.
    expect(select.value).toBe("keycloak");
    expect([...select.options].map((option) => option.value)).toEqual([
      "keycloak",
      "local",
    ]);
  });

  it("sends `local` when the operator picks the portal", async () => {
    const client = clientWith([project()]);
    render(<Organisation client={client} />);
    await openNewProject();

    fireEvent.change(screen.getByLabelText(de.organisation.identityProvider), {
      target: { value: "local" },
    });
    fireEvent.click(screen.getByText(de.common.add));

    await waitFor(() => {
      expect(client.adminCreateProject).toHaveBeenCalledWith(
        expect.objectContaining({ identityProvider: "local" }),
      );
    });
  });
});

describe("editing a project", () => {
  /**
   * Expand the settings form for the one project in the list.
   *
   * By accessible name, not by the visible "Bearbeiten": the department row has
   * one of those too, and a query that matched both would resolve to whichever
   * came first in the DOM — the department — making every assertion below
   * silently about the wrong form.
   *
   * Writing the test this way is also what surfaced the real defect: two
   * buttons whose accessible name is the bare word "Bearbeiten" are two buttons
   * a screen reader cannot tell apart. `ariaLabel` on `Button` is the fix; this
   * query is what keeps it.
   */
  async function openSettings(): Promise<void> {
    fireEvent.click(await screen.findByLabelText(de.common.editProject("MEDICE")));
  }

  it("shows the method the project actually has", async () => {
    render(
      <Organisation client={clientWith([project({ identityProvider: "local" })])} />,
    );
    await openSettings();

    const select = screen.getByLabelText(
      de.organisation.identityProvider,
    ) as HTMLSelectElement;
    expect(select.value).toBe("local");
  });

  it("says the Keycloak fields are unused for a local project", async () => {
    render(
      <Organisation client={clientWith([project({ identityProvider: "local" })])} />,
    );
    await openSettings();

    // The three inputs still exist — switching back must not lose what was
    // typed — but the operator is told they are not read, rather than being
    // warned that a wrong value locks everyone out of a realm nobody consults.
    expect(screen.getByText(de.organisation.identityProviderLocalNote)).toBeTruthy();
    expect(screen.queryByText(de.organisation.keycloakWarning)).toBeNull();
  });

  it("warns about the realm for a Keycloak project", async () => {
    render(<Organisation client={clientWith([project()])} />);
    await openSettings();

    expect(screen.getByText(de.organisation.keycloakWarning)).toBeTruthy();
    expect(screen.queryByText(de.organisation.identityProviderLocalNote)).toBeNull();
  });

  it("sends the switch, and keeps the Keycloak values it was given", async () => {
    const client = clientWith([project()]);
    render(<Organisation client={client} />);
    await openSettings();

    fireEvent.change(screen.getByLabelText(de.organisation.identityProvider), {
      target: { value: "local" },
    });
    fireEvent.click(screen.getByText(de.common.save));

    await waitFor(() => {
      expect(client.adminUpdateProject).toHaveBeenCalledWith(
        "medice",
        expect.objectContaining({
          identityProvider: "local",
          // Not cleared. A switch is reversible, and blanking the issuer on the
          // way out would make the way back a re-typing exercise.
          keycloakIssuer: "https://auth.example.de/realms/medice",
        }),
      );
    });
  });
});
