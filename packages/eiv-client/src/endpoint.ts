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

/**
 * Which register a diagnostic run talks to (P157-01).
 *
 * ## The request, and the thing that makes it dangerous
 *
 * > i want to be able to test either against the prod or test, i know this
 * > already exists, i can not choose which backend, and enter a test vnr, test
 * > efn
 *
 * A control that picks the register is a control that can pick the **live**
 * one, and a Punktemeldung cannot be unfiled — only withdrawn, which leaves its
 * own entry on a physician's record. So the choice exists, and the browser is
 * never the thing that makes it into an address.
 *
 * The wire carries one of two words. This function turns that into a URL from a
 * list the module owns, so a request body naming `https://attacker.example` or
 * the live register changes nothing: there is no branch that returns its second
 * argument except for `configured`, which is the installation's own setting and
 * was never the caller's to choose.
 *
 * `configured` may itself be the test system — an installation pointed at
 * `backend-test.eiv-fobi.de` is the supported way to exercise the whole chain,
 * and `docs/eiv-test-system.md` describes it. `test` is EIV's own test register
 * regardless of what the installation is pointed at, which is what makes a
 * diagnostic safe to run on a production installation.
 *
 * What this does **not** decide is whether a submission may go to the resolved
 * address. That is `requiresLiveConsent` above, and for synthetic test data it
 * is a refusal rather than a consent — see the diagnostic route.
 */
export type EivEnvironment = "configured" | "test";

export function eivEnvironmentUrl(
  environment: EivEnvironment,
  configuredBaseUrl: string,
): string {
  return environment === "test" ? `https://${EIV_TEST_HOST}` : configuredBaseUrl;
}
