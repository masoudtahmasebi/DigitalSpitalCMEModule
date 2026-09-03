/**
 * CSV export of the participant list (P9-07).
 *
 * Roadmap §4 defers "exports beyond CSV" — CSV is the whole export story, and
 * this file is deliberately the whole of it.
 *
 * ## Three things a naive CSV writer gets wrong here
 *
 * **Formula injection.** A cell starting `=`, `+`, `-`, `@`, a tab or a
 * carriage return is executed as a formula when the file is opened in Excel or
 * LibreOffice. `=cmd|'/c calc'!A1` in a participant's name is a remote code
 * execution against whoever opens the export. Names in this file come from
 * learner input (the attested name, ADR-0004 §6.5), so this is reachable, not
 * theoretical. Every risky cell is prefixed with a single quote, which the
 * spreadsheet strips on display and never evaluates.
 *
 * **German characters.** MEDICE opens these in Excel, which reads a CSV as the
 * system codepage unless it finds a UTF-8 BOM. Without one, "Müller" arrives as
 * "MÃ¼ller". The BOM is three bytes and removes the entire class of complaint.
 *
 * **The separator.** Excel in a German locale splits on `;`, not `,` — a
 * comma-separated file opens as one column per row. `sep=;` on the first line
 * is the documented way to say so, and other readers treat it as a comment.
 *
 * ## What is not in it
 *
 * No EFN. It is reported to the Ärztekammer and read back by nobody (ADR-0004),
 * so the export carries `efnPresent` as ja/nein and not the number itself. An
 * export is precisely where personal data leaves the system's control — a
 * spreadsheet on a laptop is outside every access control this platform has.
 */

import { formatBerlinDateTime } from "@ds/domain";
import type { ParticipantRow } from "./admin.dto.js";

const SEPARATOR = ";";
const BOM = "﻿";

/** Excel executes a cell beginning with any of these. */
const FORMULA_LEADERS = new Set(["=", "+", "-", "@", "\t", "\r"]);

const COLUMNS = [
  "Teilnehmende Person",
  "E-Mail",
  "EFN hinterlegt",
  "Fortschritt %",
  "Video angesehen %",
  "Lernerfolgskontrolle bestanden",
  "Evaluation abgegeben",
  "Fortbildung abgeschlossen",
  "Datum Fortbildungsabschluss",
  "Zertifiziert",
  "Zertifizierungsdatum",
  "Punktemeldung",
  "Meldeversuche",
  "Meldefrist",
  "Teilnahmebescheinigung",
  /*
   * Why it did not arrive, and how often we tried (P179-01).
   *
   * The export is what a support person opens when several people report a
   * missing Bescheinigung at once, and "unzustellbar" fifteen times in a column
   * does not say whether the cause is fifteen wrong addresses or one
   * unconfigured SMTP host. `lastError` is a fixed vocabulary — see
   * `certificateDeliverySchema` — so it carries no address into the
   * spreadsheet.
   */
  "Zustellungsproblem",
  "Zustellversuche",
] as const;

/** German labels, so the file needs no legend. */
const EIV_LABELS: Record<ParticipantRow["eivState"], string> = {
  none: "keine",
  queued: "in Warteschlange",
  submitted: "gemeldet",
  failed: "fehlgeschlagen",
  needs_attention: "PRÜFEN",
  abandoned: "abgebrochen",
  withdrawn: "widerrufen",
};

const CERTIFICATE_LABELS: Record<ParticipantRow["certificateState"], string> = {
  none: "keine",
  pending: "ausstehend",
  issued: "ausgestellt",
  delivered: "zugestellt",
  bounced: "unzustellbar",
  // Missing until P179-01, and the `Record` is why this is a compile error
  // rather than an empty cell: `certificates` has had the state since
  // migration 0023.
  revoked: "widerrufen",
};

/**
 * Why delivery was given up on, in the words of somebody who has to fix it.
 *
 * Each names the action rather than the condition — a support person reading a
 * spreadsheet at 22:00 needs to know which of the three piles a row is in, and
 * "permanent_rejection" is a state where "Adresse wurde abgelehnt" is a task.
 */
const ABANDONED_LABELS: Record<string, string> = {
  no_recipient: "keine E-Mail-Adresse hinterlegt",
  permanent_rejection: "Adresse wurde dauerhaft abgelehnt",
  attempts_exhausted: "Zustellversuche erschöpft",
};

/** The delivery problem as one cell: the cause, and the channel's own words. */
function deliveryProblem(row: ParticipantRow): string {
  const certificate = row.certificate;
  if (certificate === null) return "";

  const cause =
    certificate.abandonedReason === null
      ? undefined
      : (ABANDONED_LABELS[certificate.abandonedReason] ?? certificate.abandonedReason);
  const detail = certificate.lastError ?? undefined;

  return [cause, detail].filter((part) => part !== undefined).join(" — ");
}

export function participantsToCsv(rows: readonly ParticipantRow[]): string {
  const lines = [
    `sep=${SEPARATOR}`,
    COLUMNS.map(cell).join(SEPARATOR),
    ...rows.map((row) =>
      [
        row.participantName,
        row.email ?? "",
        yesNo(row.efnPresent),
        String(row.progressPercent),
        String(row.watchedPercent),
        yesNo(row.quizPassed),
        yesNo(row.evaluationSubmitted),
        // Two milestones, two columns (P51-01). One "Abgeschlossen" column
        // reported everybody still owing an Evaluationsbogen as unfinished,
        // which for a course whose paperwork trails the study by days is most
        // of the list on any given morning.
        yesNo(row.courseComplete),
        germanDateTime(row.courseCompletedAt),
        yesNo(row.complete),
        germanDateTime(row.completedAt),
        EIV_LABELS[row.eivState],
        String(row.eivAttempts),
        germanDateTime(row.eivReportDueAt),
        CERTIFICATE_LABELS[row.certificateState],
        deliveryProblem(row),
        String(row.certificate?.attemptCount ?? 0),
      ]
        .map(cell)
        .join(SEPARATOR),
    ),
  ];

  // CRLF: the line ending every spreadsheet on Windows expects.
  return BOM + lines.join("\r\n") + "\r\n";
}

/**
 * One cell: neutralised against formula injection, then quoted.
 *
 * The quote comes first in the output but the neutralising prefix comes first
 * in the value — `"'=1+1"` is inert, `"=1+1"` is not. Quoting alone does not
 * help: Excel evaluates the contents of a quoted cell just the same.
 */
function cell(value: string): string {
  const leader = value.charAt(0);
  const safe = FORMULA_LEADERS.has(leader) ? `'${value}` : value;
  // RFC 4180: double the quotes, wrap the field.
  return `"${safe.replaceAll('"', '""')}"`;
}

function yesNo(value: boolean): string {
  return value ? "ja" : "nein";
}

/**
 * German local presentation of a UTC instant.
 *
 * `formatBerlinDateTime` rather than a local `Intl` call: these dates are read
 * against the Ärztekammer's deadlines, and the certificate, the admin list and
 * the widget must show the same day for the same instant. Four files used to
 * decide that independently.
 */
function germanDateTime(iso: string | null): string {
  return iso === null ? "" : formatBerlinDateTime(new Date(iso));
}
