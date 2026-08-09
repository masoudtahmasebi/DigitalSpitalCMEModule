/**
 * The extension surface (ADR-0010).
 *
 * Two files, and the split matters: `capabilities.ts` says what may be replaced
 * and — at greater length — what may not, and `registry.ts` says how exactly one
 * implementation of each is chosen.
 *
 * Nothing in this package does anything. It is contracts and a map, deliberately
 * with no dependencies, so that an implementation can live in any workspace
 * without dragging the platform in behind it.
 */

export type {
  AccreditationReporter,
  CertificateRenderer,
  ContentIngestor,
  DeliveryChannel,
  DeliveryOutcome,
  OutboundMessage,
  ParticipationCredit,
  ParticipationReport,
  ReportOutcome,
} from "./capabilities.js";

export {
  createPluginRegistry,
  PluginError,
  type Capabilities,
  type CapabilityName,
  type PluginRegistry,
} from "./registry.js";
