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
  "Abgeschlossen",
  "Abschlussdatum",
  "Punktemeldung",
  "Meldeversuche",
  "Meldefrist",
  "Teilnahmebescheinigung",
] as const;

/** German labels, so the file needs no legend. */
const EIV_LABELS: Record<ParticipantRow["eivState"], string> = {
  none: "keine",
  queued: "in Warteschlange",
  submitted: "gemeldet",
  failed: "fehlgeschlagen",
  needs_attention: "PRÜFEN",
  abandoned: "abgebrochen",
};

const CERTIFICATE_LABELS: Record<ParticipantRow["certificateState"], string> = {
  none: "keine",
  pending: "ausstehend",
  issued: "ausgestellt",
  delivered: "zugestellt",
  bounced: "unzustellbar",
};

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
        yesNo(row.complete),
        germanDateTime(row.completedAt),
        EIV_LABELS[row.eivState],
        String(row.eivAttempts),
        germanDateTime(row.eivReportDueAt),
        CERTIFICATE_LABELS[row.certificateState],
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
