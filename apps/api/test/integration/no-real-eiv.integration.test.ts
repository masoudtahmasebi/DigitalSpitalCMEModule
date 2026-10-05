/**
 * The guard in `support/no-real-eiv.ts` is installed and bites (P250-02).
 *
 * Without this file, removing the guard from `setupFiles` would leave every
 * suite green — the failure it prevents is a request nobody sees (§9.1).
 *
 * It deliberately does not import the guard: importing it installs it, and the
 * test would then pass with the guard gone from `setupFiles`. The refusal is
 * recognised by its error name instead.
 */

import { describe, expect, it } from "vitest";

describe("no integration test reaches a real EIV-FOBI system", () => {
  it.each([
    "https://backend.eiv-fobi.de/api/v1/punktemeldung",
    "https://backend-test.eiv-fobi.de/api/v1/veranstaltung",
    "https://eiv-fobi.de/",
  ])("refuses %s before any request is made", async (url) => {
    // An already-aborted signal: with the guard gone, `fetch` rejects with
    // AbortError before any I/O, so even this test's own red run sends
    // nothing to the register.
    await expect(fetch(url, { signal: AbortSignal.abort() })).rejects.toMatchObject({
      name: "RealEivRequestRefused",
    });
  });

  it("leaves the local mock reachable as an address", async () => {
    // Aborted before any I/O; the point is the rejection is the abort's, not
    // the guard's.
    const outcome = await fetch("http://127.0.0.1:9/", {
      signal: AbortSignal.abort(),
    }).then(
      () => "answered",
      (error: unknown) => error,
    );
    expect(outcome).not.toMatchObject({ name: "RealEivRequestRefused" });
  });
});
