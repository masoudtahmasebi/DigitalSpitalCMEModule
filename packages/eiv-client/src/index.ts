/**
 * The EIV-FOBI transport client (ADR-0005).
 *
 * A package rather than part of `apps/eiv-harness` because it has two
 * consumers: the harness CLI, which exercises the contract by hand, and the
 * API's submission worker (P7-06), which uses it in production. An app
 * importing another app would be an architecture violation — enforced by lint
 * since this move, see packages/config/eslint.config.js.
 *
 * It holds transport only. Every decision about *whether* to send — deadlines,
 * retry budget, permanent-failure classification — lives in `@ds/domain`,
 * which stays free of any network client so it remains exhaustively testable.
 */

export {
  EivClient,
  EivError,
  type AuthenticateResult,
  type EivClientOptions,
  type EivExchange,
  type EivFailureKind,
  type PushTeilnahmeResult,
  type TeilnahmeMeldung,
  type VeranstaltungsInfos,
  type GemeldeterPunkt,
} from "./client.js";

export {
  EivAccreditationReporter,
  MissingEivCredentialError,
  EIV_PASSWORD_KEY,
} from "./reporter.js";

export { redact } from "./redact.js";

export {
  startMockServer,
  type MockServer,
  type MockBehaviour,
  type MockOptions,
  type MockRecord,
} from "./mock/server.js";

export {
  eivEndpointTier,
  eivEnvironmentUrl,
  requiresLiveConsent,
  EIV_TEST_HOST,
  type EivEndpointTier,
  type EivEnvironment,
} from "./endpoint.js";
