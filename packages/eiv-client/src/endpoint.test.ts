/**
 * Which endpoint needs consent before a Punktemeldung (P104-01).
 *
 * The case that earns the file is `backend-test.eiv-fobi.de`. The old guard
 * matched `*eiv-fobi.de*`, so reaching EIV's **test** system — the one they
 * instruct integrators to use — required `EIV_ALLOW_LIVE=yes`. A safety flag
 * that has to be switched off to do the safe thing gets switched off and stays
 * off, and then it is not protecting the production register either.
 */

import { describe, expect, it } from "vitest";
import { eivEndpointTier, requiresLiveConsent } from "./endpoint.js";

describe("eivEndpointTier", () => {
  it.each([
    "http://127.0.0.1:4010",
    "http://localhost:4010",
    "http://[::1]:4010",
    // The compose service name — the API reaches the mock over the internal
    // network, not over loopback.
    "http://eiv-mock:4010",
  ])("%s is the mock", (url) => expect(eivEndpointTier(url)).toBe("mock"));

  it("names EIV's test system as test, not live", () => {
    // The whole ticket.
    expect(eivEndpointTier("https://backend-test.eiv-fobi.de")).toBe("test");
  });

  it("names the production register as live", () => {
    expect(eivEndpointTier("https://backend.eiv-fobi.de")).toBe("live");
    expect(eivEndpointTier("https://punktemeldung.eiv-fobi.de/")).toBe("live");
  });

  it("does not let a lookalike host borrow the test tier", () => {
    // `backend-test.eiv-fobi.de.example.com` is somebody else's domain.
    expect(eivEndpointTier("https://backend-test.eiv-fobi.de.example.com")).toBe(
      "unknown",
    );
  });

  it("treats an unrecognised host as unknown, not as safe", () => {
    expect(eivEndpointTier("https://proxy.internal")).toBe("unknown");
    expect(eivEndpointTier("not a url")).toBe("unknown");
  });
});

describe("requiresLiveConsent", () => {
  it("lets the mock and the test system through", () => {
    expect(requiresLiveConsent("http://127.0.0.1:4010")).toBe(false);
    expect(requiresLiveConsent("https://backend-test.eiv-fobi.de")).toBe(false);
  });

  it("holds the production register", () => {
    expect(requiresLiveConsent("https://backend.eiv-fobi.de")).toBe(true);
  });

  it("holds anything it does not recognise", () => {
    /*
     * Refusing an unknown host costs an operator one environment variable.
     * Guessing wrong costs a false CME credit on a real physician's record and
     * a correction to the Ärztekammer that stays on the file — so the unknown
     * case fails closed.
     */
    expect(requiresLiveConsent("https://proxy.internal")).toBe(true);
    expect(requiresLiveConsent("")).toBe(true);
  });
});
