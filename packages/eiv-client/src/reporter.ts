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
  AccreditedEvent,
  AuthorityQuery,
  ParticipationCredit,
  ParticipationReport,
  ReportedParticipation,
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
    const client = this.clientFor(report.endpoint, report.vnr, report.credentials);
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

  /**
   * Withdraw a Punktemeldung — the same endpoint with the points zeroed.
   *
   * `@ds/domain` has computed a 7-day correction window since week 1 and there
   * was no mechanism to correct anything; the specification supplied one
   * (P31-01) and this is it. EIV keeps the record: *"es handelt sich nicht um
   * eine physische Löschung des Datensatzes"*, which is the right shape for a
   * CME record — a physician whose points vanished with no trace would have no
   * way to find out why.
   *
   * `teilnahmedatum` is still checked against the accredited period, so a
   * withdrawal after that period closes is refused exactly like any other push.
   */
  async withdraw(report: ParticipationReport): Promise<ReportOutcome> {
    const client = this.clientFor(report.endpoint, report.vnr, report.credentials);
    const auth = await client.authenticate();

    const push = await client.retractTeilnahme(
      report.efn,
      formatBerlinIsoDate(report.completedAt),
      auth.token,
    );

    return { accepted: push.accepted };
  }

  /**
   * What EIV holds about the event behind this VNR.
   *
   * The accredited period is the one fact that decides whether *any* of a
   * course's completions can be reported, and it is knowable before the first
   * physician starts. Reading it at authoring time turns a 406 — arriving after
   * a learner has been shown a completed Zertifizierung — into a warning on a
   * settings screen.
   */
  async describeEvent(query: AuthorityQuery): Promise<AccreditedEvent> {
    const client = this.clientFor(query.endpoint, query.vnr, query.credentials);
    const auth = await client.authenticate();
    const { info } = await client.getVeranstaltung(auth.token);

    return {
      ...optional("title", info.thema),
      ...optional("validFrom", info.beginn),
      ...optional("validUntil", info.ende),
      ...optional("category", info.kategorie),
      ...optional("attendancePoints", info.punkteBasis),
      ...optional("assessmentPoints", info.punkteLernerfolg),
      ...optional("locked", info.gesperrtFuerVeranstalter),
    };
  }

  /** What EIV believes it already holds for this VNR. */
  async listReported(query: AuthorityQuery): Promise<readonly ReportedParticipation[]> {
    const client = this.clientFor(query.endpoint, query.vnr, query.credentials);
    const auth = await client.authenticate();
    const { rows } = await client.getGemeldetePunkte(auth.token);

    return rows.map((row) => ({
      ...optional("efn", row.efn),
      // EIV answers with 0/1 rather than a boolean. Normalised here so the
      // platform above never has to know which flavour of falsy it got.
      ...optional("attendance", flag(row.punkteBasisFlag)),
      ...optional("assessment", flag(row.punkteLernerfolgFlag)),
      ...optional("speaker", row.punkteReferent),
      ...optional("participatedOn", row.teilnahmedatum),
      ...optional("lastModified", row.lastModified),
    }));
  }

  /** One place that turns credentials into a client, so one place can refuse. */
  private clientFor(
    endpoint: string,
    vnr: string,
    credentials: Readonly<Record<string, string>>,
  ): EivClient {
    const vnrPassword = credentials[EIV_PASSWORD_KEY];
    if (vnrPassword === undefined || vnrPassword === "") {
      throw new MissingEivCredentialError();
    }

    return new EivClient({ baseUrl: endpoint, vnr, vnrPassword });
  }
}

function flag(value: number | undefined): boolean | undefined {
  return value === undefined ? undefined : value !== 0;
}

/** `exactOptionalPropertyTypes` forbids assigning `undefined` to an optional. */
function optional<K extends string, V>(
  key: K,
  value: V | undefined,
): Record<K, V> | Record<string, never> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
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
