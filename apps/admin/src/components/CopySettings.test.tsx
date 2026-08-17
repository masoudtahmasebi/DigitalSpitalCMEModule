/**
 * That Texte lists what a customer may change **and** what they may not
 * (P83-04).
 *
 * The property worth pinning is the one that was asked for after I described
 * the split badly: *"you can make both of them available and let the customer
 * only edit the editable parts."* A screen that quietly omitted the
 * interpolated sentences would look complete and be missing forty-two rows,
 * and nothing would say so — which is the failure §9.4 is about.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ApiClient } from "@ds/sdk";
import { CopySettings } from "./CopySettings.js";

/*
 * Unmounted between cases explicitly.
 *
 * Without it the previous test's tree stays in the document and every
 * `findByText` sees two of everything — which is how this file first failed,
 * with an error about duplicate keys that looked like a bug in the screen and
 * was a bug in the harness (§9.8's second half).
 */
afterEach(cleanup);

function client(): ApiClient {
  return {
    adminListProjects: vi.fn(async () => [
      {
        slug: "medice-adhs",
        name: "MEDICE",
        departmentSlug: "default",
        copyOverrides: { "tabs.library": "Materialien" },
      },
    ]),
  } as unknown as ApiClient;
}

describe("Texte", () => {
  it("lists an editable key with the customer's own text in the field", async () => {
    render(<CopySettings client={client()} />);

    const field = await screen.findByLabelText("tabs.library");
    expect((field as HTMLInputElement).value).toBe("Materialien");
  });

  it("shows the platform's default beside it, so the field never lies", async () => {
    render(<CopySettings client={client()} />);
    // `getAllBy`: more than one key happens to default to "Mediathek", which
    // is itself worth knowing — they are separate settings and each gets its
    // own field.
    expect((await screen.findAllByText(/Standard: Mediathek/u)).length).toBeGreaterThan(
      0,
    );
  });

  it("draws the fixed keys too, with the reason", async () => {
    /*
     * `media.covered` is `(percent) => \`${percent} % angesehen\``. It has no
     * field and it is not hidden: somebody looking for it finds out why it is
     * not theirs to change, instead of concluding the list is incomplete.
     */
    render(<CopySettings client={client()} />);

    expect(await screen.findByText("media.covered")).toBeTruthy();
    expect(screen.queryByLabelText("media.covered")).toBeNull();
    expect(screen.getAllByText("Nicht änderbar").length).toBeGreaterThan(0);
  });
});
