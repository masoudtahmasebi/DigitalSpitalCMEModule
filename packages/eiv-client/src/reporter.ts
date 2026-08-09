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
  ParticipationCredit,
  ParticipationReport,
  ReportOutcome,
} from "@ds/plugin-api";
import { formatBerlinIsoDate } from "@ds/domain";
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
   * Idempotent per `(efn, vnr)` because EIV-FOBI says so in terms: a repeat
   * *updates the same record* rather than filing a second one, and a repeat
   * with an unchanged payload is explicitly safe after a 5xx whose outcome is
   * unknown. That property is what lets the submission worker retry a request
   * whose response never arrived, and it is why this class holds no state — a
   * per-instance "already sent" cache would be a second, weaker answer that a
   * process restart would lose.
   *
   * **No reference comes back.** EIV issues none; the previous version of this
   * file read a `referenz` field that does not exist (P31-01). `accepted` is
   * the HTTP status and nothing else, which is what the specification requires:
   * *"Maßgeblich … ist immer der HTTP-Statuscode, nicht einzelne interne
   * Response-Felder."*
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

    const credit = report.credit ?? DEFAULT_CREDIT;

    const { push } = await client.submit({
      efn: report.efn,
      punkteBasis: credit.attendance,
      punkteLernerfolg: credit.assessment,
      punkteReferent: credit.speaker,
      // The German calendar date, not the UTC one. EIV checks it against the
      // accredited period and refuses 406 outside it, so an evening completion
      // formatted in UTC would be reported against the following day.
      teilnahmedatum: formatBerlinIsoDate(report.completedAt),
    });

    return { accepted: push.accepted };
  }
}

/**
 * What a completion earns when the caller does not say — **and why claiming
 * both is the safer of two wrong answers** (S25).
 *
 * The Anerkennungsbescheid awards this Fortbildung 4 points in Kategorie D and
 * makes 70 % on the Lernerfolgskontrolle a condition of awarding them. A
 * completion on this platform already requires passing that assessment, so both
 * kinds of credit have plainly been earned. What is *not* confirmed is how the
 * Ärztekammer expects that to appear in the two flags — `GET
 * /fobi/veranstalter/veranstaltung` returns `punkte_basis` and
 * `punkte_lernerfolg` separately, and an event accredited for no Lernerfolg
 * points may refuse the flag.
 *
 * The choice between the two failure modes is what decides this default:
 *
 * - Claiming credit that the event does not carry is refused with a 406 or a
 *   422. Loud, logged, and in front of an operator inside the 8-day window.
 * - Not claiming credit that was earned is **accepted silently**, and the
 *   physician is short of points with nothing anywhere saying so until they
 *   check their Kammer account months later.
 *
 * A wrong answer that fails is recoverable; a wrong answer that succeeds is
 * not. Confirm against the test system before the first live submission —
 * `pnpm --filter @ds/eiv-harness veranstaltung` prints exactly the two numbers
 * that settle it.
 */
const DEFAULT_CREDIT: ParticipationCredit = {
  attendance: true,
  assessment: true,
  speaker: 0,
};
