/**
 * Which EIV endpoint is the one you cannot take back (P104-01).
 *
 * ## The flaw this replaces
 *
 * The guard used to be `EIV_BASE_URL contains "eiv-fobi.de"` — which is true of
 * the **test** system as well, because EIV name it `backend-test.eiv-fobi.de`.
 * So configuring the platform against the system EIV explicitly tell you to
 * develop against (*"Bitte nutzen Sie für die Entwicklung ausschließlich das
 * Test-System"*) required setting `EIV_ALLOW_LIVE=yes`.
 *
 * That is the worst shape a safety flag can have: it must be switched off to do
 * the ordinary, safe thing. An operator who sets it to reach the test system
 * has a platform that will also submit to the production register the moment
 * somebody edits a URL — and they set it for a reason that had nothing to do
 * with consenting to that. A gate that has to be disabled for routine work is a
 * gate that is always disabled (§9.1's cousin).
 *
 * ## The rule
 *
 * Three tiers, and only the third needs consent:
 *
 * | Endpoint                     | Tier      | Consent |
 * | ---------------------------- | --------- | ------- |
 * | loopback (the mock)          | `mock`    | no      |
 * | `backend-test.eiv-fobi.de`   | `test`    | no      |
 * | anything else on eiv-fobi.de | `live`    | **yes** |
 * | any other host               | `unknown` | **yes** |
 *
 * `unknown` requires consent deliberately. A hostname this file does not
 * recognise might be a proxy in front of the real register, and the failure of
 * guessing wrong is a false CME credit on a real physician's record. Refusing
 * costs somebody one environment variable; guessing costs a correction to the
 * Ärztekammer that stays on the file.
 *
 * Pure, and exported so the deploy script's shell copy has one definition to be
 * checked against rather than a second opinion (`infra/deploy/eiv-endpoint.sh`).
 */

/** EIV's own test system, which is the one they ask integrators to use. */
export const EIV_TEST_HOST = "backend-test.eiv-fobi.de";

export type EivEndpointTier = "mock" | "test" | "live" | "unknown";

export function eivEndpointTier(baseUrl: string): EivEndpointTier {
  let host: string;
  try {
    host = new URL(baseUrl).hostname.toLowerCase();
  } catch {
    // Not a URL. Nothing can be submitted to it, but calling it `mock` would
    // let a typo through the guard, so it is treated as unrecognised.
    return "unknown";
  }

  // `new URL("http://[::1]:4010").hostname` keeps the brackets, so both forms
  // are matched rather than the one that reads naturally.
  if (
    host === "127.0.0.1" ||
    host === "localhost" ||
    host === "::1" ||
    host === "[::1]" ||
    // The compose service name. The API reaches the mock over the internal
    // network, where it is not on loopback at all — omitting this made the
    // dev stack's own mock an unrecognised host, which fails closed and would
    // have stopped the worker submitting to it.
    host === "eiv-mock"
  ) {
    return "mock";
  }
  if (host === EIV_TEST_HOST) return "test";
  if (host === "eiv-fobi.de" || host.endsWith(".eiv-fobi.de")) return "live";
  return "unknown";
}

/**
 * May a **submission** go to this endpoint without explicit consent?
 *
 * Named for the dangerous operation rather than for the address, because that
 * is what the flag is actually about. Reading an event or listing already
 * reported points is safe against every tier and is deliberately not gated by
 * this — an operator proving their VNR works must not have to arm the worker to
 * do it, which is precisely the trade the old guard forced.
 */
export function requiresLiveConsent(baseUrl: string): boolean {
  const tier = eivEndpointTier(baseUrl);
  return tier === "live" || tier === "unknown";
}
