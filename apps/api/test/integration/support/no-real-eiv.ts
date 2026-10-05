/**
 * No integration test may reach a real EIV-FOBI system (P250-02).
 *
 * ## What went wrong
 *
 * Migration 0053 made `platform_settings.eiv_endpoint` default to `live`, and
 * `reset.ts` restores that default for every file. Its consent gate guards the
 * **worker** only: the console's EIV routes — check, describe, reconcile and
 * withdraw — build their client from the setting, armed or not. So the first
 * run of P250's HTTP test for those routes sent requests, a withdrawal among
 * them, to `backend.eiv-fobi.de`. The register refused at authentication
 * because the credentials were the fixture's, which is luck, not a control.
 *
 * Pinning `mock` in that one file fixed that file. This fixes the class: every
 * integration file runs with `fetch` refusing any host the EIV client would
 * classify as `live` or `test`, so a suite that forgets to pin the endpoint —
 * today's or next year's — fails here, by name, instead of talking to the
 * Ärztekammer. The test system is refused too: it is a shared service with
 * real accounts, not a fixture.
 *
 * The EIV client calls the global `fetch` (`packages/eiv-client/src/client.ts`)
 * and the integration suites run the application in this process, so wrapping
 * it here covers every path the application can take to the register.
 */

import { eivEndpointTier } from "@ds/eiv-client";

export class RealEivRequestRefused extends Error {
  constructor(url: string) {
    super(
      `integration test tried to reach a real EIV-FOBI system (${new URL(url).host}); ` +
        "pin platform_settings.eiv_endpoint to 'mock' for this suite (P250-02)",
    );
    this.name = "RealEivRequestRefused";
  }
}

export function refusingRealEiv(inner: typeof fetch): typeof fetch {
  return (input, init) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    // Only EIV's own hosts: `unknown` is every other address in the suite (the
    // fake bucket, mock JWKS servers), which this guard has no business with.
    const tier = eivEndpointTier(url);
    if (tier === "live" || tier === "test") {
      return Promise.reject(new RealEivRequestRefused(url));
    }
    return inner(input, init);
  };
}

globalThis.fetch = refusingRealEiv(globalThis.fetch);
