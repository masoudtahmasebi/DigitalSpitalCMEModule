/**
 * EIV-FOBI as an `AccreditationReporter` (ADR-0010).
 *
 * This file is what makes the extension seam real rather than aspirational: a
 * package outside `apps/api` implements a capability contract, and the API
 * composes it in without knowing anything about EIV-FOBI beyond the interface.
 * A second Ärztekammer interface is a second file exactly like this one.
 *
 * It is deliberately thin. Everything that decides anything — whether a
 * submission is due, how many retries remain, whether a failure is permanent —
 * is in `@ds/domain` and stays there; a reporter that made those calls would be
 * a second opinion on a deadline that cannot be reopened.
 */

import type {
  AccreditationReporter,
  ParticipationReport,
  ReportOutcome,
} from "@ds/plugin-api";
import { EivClient } from "./client.js";

/** The credential key this reporter reads out of `report.credentials`. */
export const EIV_PASSWORD_KEY = "vnrPassword";

export class MissingEivCredentialError extends Error {
  constructor() {
    // Names the key, not the value — this message reaches the audit log.
    super(`no ${EIV_PASSWORD_KEY} in credentials`);
    this.name = "MissingEivCredentialError";
  }
}

export class EivAccreditationReporter implements AccreditationReporter {
  readonly id = "eiv-fobi";

  /**
   * Idempotent per `(efn, vnr)` because EIV-FOBI is: re-pushing a Teilnahme it
   * has already accepted returns the original reference rather than filing a
   * second one. That property is what lets the submission worker retry a
   * request whose response never arrived, and it is the reason this class holds
   * no state of its own — a per-instance "already sent" cache would be a second,
   * weaker answer that a process restart would lose.
   */
  async report(report: ParticipationReport): Promise<ReportOutcome> {
    const vnrPassword = report.credentials[EIV_PASSWORD_KEY];
    if (vnrPassword === undefined || vnrPassword === "") {
      throw new MissingEivCredentialError();
    }

    const client = new EivClient({
      baseUrl: report.endpoint,
      vnr: report.vnr,
      vnrPassword,
    });

    const { push } = await client.submit(report.efn);
    return {
      accepted: push.accepted,
      ...(push.reference === undefined ? {} : { reference: push.reference }),
    };
  }
}
