/**
 * The participant-accounts screen, rendered (P21-04).
 *
 * ## Why this file exists in this shape
 *
 * The last two features in this project each shipped a bug that every unit test
 * passed and a browser found in ten seconds: a widget that rendered "nicht
 * korrekt eingebunden" into a closed shadow root, and a route that answered 403
 * after a successful sign-in. Both were *rendering* failures on a screen whose
 * logic was tested.
 *
 * So the assertions here are about what an administrator sees and can click.
 *
 * ## What is stubbed, and what deliberately is not
 *
 * The client is a plain object, not a mock proxy — a method the component
 * starts calling and this file does not provide is a `TypeError` here rather
 * than a silently-recorded call that passes. The API itself is tested for real
 * in `participants.integration.test.ts`, over HTTP, against Postgres; what only
 * this file can check is that the screen shows the password exactly once, and
 * that it does not offer buttons which could only 409.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ApiClient, ParticipantAccount } from "@ds/sdk";
import { ParticipantAccounts } from "./ParticipantAccounts.js";

afterEach(cleanup);

function account(overrides: Partial<ParticipantAccount> = {}): ParticipantAccount {
  return {
    userId: "0198f4c1-7a2e-7000-8000-0000000000b1",
    email: "arzt@praxis.de",
    firstName: "Anna",
    lastName: "Schmidt",
    credential: { mustChange: false, disabled: false, lockedUntil: null },
    enrolmentCount: 2,
    completedCount: 1,
    createdAt: "2026-08-01T10:00:00.000Z",
    ...overrides,
  };
}

function clientWith(
  rows: readonly ParticipantAccount[],
  overrides: Partial<Record<string, unknown>> = {},
): ApiClient {
  return {
    adminListParticipantAccounts: vi.fn(async () => rows),
    adminCreateParticipant: vi.fn(async () => ({
      userId: "new-id",
      temporaryPassword: "geheim-und-nur-einmal",
    })),
    adminResetParticipantPassword: vi.fn(async () => ({
      temporaryPassword: "neu-und-nur-einmal",
    })),
    adminSetParticipantDisabled: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as ApiClient;
}

describe("the list", () => {
  it("shows a person, their progress and their status", async () => {
    render(<ParticipantAccounts client={clientWith([account()])} />);

    expect(await screen.findByText("Anna Schmidt")).toBeTruthy();
    expect(screen.getByText("arzt@praxis.de")).toBeTruthy();
    // Completed / enrolled, not a percentage: an administrator acts on "has
    // this person finished", and a rounded percentage hides 0 of 1.
    expect(screen.getByText("1 / 2")).toBeTruthy();
    expect(screen.getByText("Aktiv")).toBeTruthy();
  });

  it("names the next step when there is nobody yet", async () => {
    // The state this screen is in the first time anybody opens it. "Keine
    // Daten" would be true and useless.
    render(<ParticipantAccounts client={clientWith([])} />);

    expect(await screen.findByText(/Zugang anlegen/)).toBeTruthy();
  });

  it("marks somebody who has not yet chosen their own password", async () => {
    render(
      <ParticipantAccounts
        client={clientWith([
          account({
            credential: { mustChange: true, disabled: false, lockedUntil: null },
          }),
        ])}
      />,
    );
    expect(await screen.findByText("Passwort noch nicht geändert")).toBeTruthy();
  });

  it("distinguishes an administrative block from the automatic lockout", async () => {
    // Two different things that both mean "cannot sign in", and only one of
    // them is somebody's decision. Showing them identically would have an
    // administrator hunting for a block nobody applied.
    render(
      <ParticipantAccounts
        client={clientWith([
          account({
            userId: "a",
            credential: { mustChange: false, disabled: true, lockedUntil: null },
          }),
          account({
            userId: "b",
            credential: {
              mustChange: false,
              disabled: false,
              lockedUntil: "2026-08-07T12:00:00.000Z",
            },
          }),
        ])}
      />,
    );

    expect(await screen.findByText("Gesperrt")).toBeTruthy();
    expect(screen.getByText("Vorübergehend gesperrt")).toBeTruthy();
  });
});

describe("a federated participant", () => {
  it("offers no password buttons, because they could only fail", async () => {
    // Their password lives at the customer's Keycloak. The API answers 409, and
    // a button whose only outcome is an error message is worse than no button.
    render(<ParticipantAccounts client={clientWith([account({ credential: null })])} />);

    expect(await screen.findByText("Externe Anmeldung")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Passwort zurücksetzen" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByRole("button", { name: "Sperren" })).toHaveProperty(
      "disabled",
      true,
    );
  });
});

describe("creating one", () => {
  it("shows the password once, and says that it will not be shown again", async () => {
    const client = clientWith([]);
    render(<ParticipantAccounts client={client} />);

    fireEvent.click(await screen.findByRole("button", { name: "Zugang anlegen" }));
    fireEvent.change(screen.getByLabelText("Vorname"), { target: { value: "Neue" } });
    fireEvent.change(screen.getByLabelText("Nachname"), { target: { value: "Ärztin" } });
    fireEvent.change(screen.getByLabelText("E-Mail-Adresse"), {
      target: { value: "neu@example.org" },
    });

    const buttons = screen.getAllByRole("button", { name: "Zugang anlegen" });
    fireEvent.click(buttons[buttons.length - 1]!);

    expect(await screen.findByText("geheim-und-nur-einmal")).toBeTruthy();
    // The warning is the point. Somebody who closes this without copying has
    // to reset, and a quiet grey line is how that happens.
    expect(screen.getByText(/nur einmal angezeigt/)).toBeTruthy();
  });

  it("will not submit without both names", async () => {
    // A Teilnahmebescheinigung prints a name and cannot be issued without one.
    // The API refuses too; the disabled button is so nobody discovers that at
    // the end of a course.
    render(<ParticipantAccounts client={clientWith([])} />);

    fireEvent.click(await screen.findByRole("button", { name: "Zugang anlegen" }));
    fireEvent.change(screen.getByLabelText("E-Mail-Adresse"), {
      target: { value: "neu@example.org" },
    });

    const buttons = screen.getAllByRole("button", { name: "Zugang anlegen" });
    expect(buttons[buttons.length - 1]).toHaveProperty("disabled", true);
  });

  it("reports a refusal in German rather than silently doing nothing", async () => {
    const client = clientWith([], {
      adminCreateParticipant: vi.fn(async () => {
        throw new Error("nope");
      }),
    });
    render(<ParticipantAccounts client={client} />);

    fireEvent.click(await screen.findByRole("button", { name: "Zugang anlegen" }));
    for (const [label, value] of [
      ["Vorname", "Neue"],
      ["Nachname", "Ärztin"],
      ["E-Mail-Adresse", "neu@example.org"],
    ] as const) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    }

    const buttons = screen.getAllByRole("button", { name: "Zugang anlegen" });
    fireEvent.click(buttons[buttons.length - 1]!);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeTruthy();
    });
  });
});

describe("resetting and blocking", () => {
  it("shows the new password after a reset", async () => {
    const client = clientWith([account()]);
    render(<ParticipantAccounts client={client} />);

    fireEvent.click(await screen.findByRole("button", { name: "Passwort zurücksetzen" }));
    expect(await screen.findByText("neu-und-nur-einmal")).toBeTruthy();
  });

  it("toggles rather than only ever blocking", async () => {
    // The button on a blocked account has to unblock it. A screen that can only
    // block is one where a mistake needs a database session to undo.
    const client = clientWith([
      account({ credential: { mustChange: false, disabled: true, lockedUntil: null } }),
    ]);
    render(<ParticipantAccounts client={client} />);

    fireEvent.click(await screen.findByRole("button", { name: "Entsperren" }));
    await waitFor(() => {
      expect(client.adminSetParticipantDisabled).toHaveBeenCalledWith(
        expect.any(String),
        false,
      );
    });
  });
});
