/**
 * The participant list (P9-06) and its CSV export (P9-07).
 *
 * A list, not a dashboard. There is no chart here and none is coming — the
 * backlog says so explicitly, and the useful thing on this screen is not a
 * trend line but a row an admin has to act on today.
 *
 * ## The banner at the top is the reason this screen exists
 *
 * A submission still unresolved after the automatic retries will not fix
 * itself. The Bescheid allows the Ärztekammer to take the Punktemeldung from
 * an Original-Anwesenheitsliste in written-justified exceptional cases — but
 * only within 8 days of the Teilnahme. So the window in which a human can
 * rescue a failed submission is short and closes silently. Burying those rows
 * in a generic failed count is how a physician quietly loses their points.
 */

import { useState } from "react";
import { formatBerlinDate } from "@ds/domain";
import type { ApiClient, ParticipantList, ParticipantRow } from "@ds/sdk";
import { de } from "../locale/de.js";
import { describeError } from "../api.js";
import { Badge, Button, Notice, Table } from "./ui.js";

type Filter = "all" | "complete" | "awaiting" | "open" | "attention";

export function Participants(props: {
  client: ApiClient;
  courseSlug: string;
  list: ParticipantList;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();

  const attention = props.list.rows.filter(
    (row) => row.eivState === "needs_attention",
  ).length;

  const rows = props.list.rows.filter((row) => matches(row, filter));

  async function exportCsv(): Promise<void> {
    setBusy(true);
    setProblem(undefined);
    try {
      const { blob, filename } = await props.client.adminExportParticipants(
        props.courseSlug,
      );
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      // A live blob: URL is a readable copy of a participant list for as long
      // as it exists.
      URL.revokeObjectURL(url);
    } catch (error) {
      setProblem(describeError(error, de.error.generic));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-base font-semibold text-gray-900">{de.participants.title}</h3>
        <Button variant="secondary" disabled={busy} onClick={() => void exportCsv()}>
          {de.participants.export}
        </Button>
      </div>

      {attention > 0 ? (
        <Notice tone="error" title={de.participants.attentionBanner(attention)}>
          {de.participants.attentionHint}
        </Notice>
      ) : null}

      {problem === undefined ? null : <Notice tone="error">{problem}</Notice>}

      <div className="flex flex-wrap gap-2">
        {(
          [
            ["all", de.participants.filterAll],
            ["complete", de.participants.filterComplete],
            ["awaiting", de.participants.filterAwaiting],
            ["open", de.participants.filterOpen],
            ["attention", de.participants.filterAttention],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
            className={`rounded-full px-3 py-1 text-sm ${
              filter === value
                ? "bg-brand-600 text-white"
                : "border border-gray-300 text-gray-700"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-gray-600">{de.participants.empty}</p>
      ) : (
        <Table
          headers={[
            de.participants.columnName,
            de.participants.columnEmail,
            de.participants.columnProgress,
            de.participants.columnWatched,
            de.participants.columnQuiz,
            de.participants.columnEvaluation,
            de.participants.columnEfn,
            de.participants.columnCourseComplete,
            de.participants.columnComplete,
            de.participants.columnEiv,
            de.participants.columnCertificate,
          ]}
        >
          {rows.map((row) => (
            <tr key={row.enrolmentId} className="border-b border-gray-100">
              <td className="px-3 py-2 text-gray-900">{row.participantName}</td>
              <td className="px-3 py-2 text-gray-600">{row.email ?? "—"}</td>
              <td className="px-3 py-2">{row.progressPercent} %</td>
              <td className="px-3 py-2">{row.watchedPercent} %</td>
              <td className="px-3 py-2">
                {row.quizPassed ? de.participants.passed : de.participants.notPassed}
              </td>
              <td className="px-3 py-2">
                {row.evaluationSubmitted ? de.participants.yes : de.participants.no}
              </td>
              <td className="px-3 py-2">
                {/* Presence only. The EFN itself is never returned by the API. */}
                {row.efnPresent ? de.participants.yes : de.participants.no}
              </td>
              <td className="px-3 py-2">{courseCompletion(row)}</td>
              <td className="px-3 py-2">{formatDate(row.completedAt)}</td>
              <td className="px-3 py-2">
                <Badge tone={eivTone(row.eivState)}>
                  {de.participants.eiv[row.eivState]}
                </Badge>
              </td>
              <td className="px-3 py-2">
                {de.participants.certificate[row.certificateState]}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}

function matches(row: ParticipantRow, filter: Filter): boolean {
  switch (filter) {
    case "complete":
      return row.complete;
    // Finished the course, waiting only on the evaluation or the EFN (P51-01).
    // The list somebody actually works through.
    case "awaiting":
      return row.courseComplete && !row.complete;
    case "open":
      return !row.courseComplete;
    case "attention":
      return row.eivState === "needs_attention";
    default:
      return true;
  }
}

/**
 * When the Fortbildung itself was finished.
 *
 * Three answers, not two. A row completed before migration 0037 is complete
 * with no date, and printing "—" there would say "not finished" about somebody
 * who has a certificate — so the word is shown instead of a date we never
 * recorded. Inventing one would be worse (see the migration).
 */
function courseCompletion(row: ParticipantRow): string {
  if (row.courseCompletedAt !== null) return formatDate(row.courseCompletedAt);
  return row.courseComplete ? de.participants.completedUndated : "—";
}

function eivTone(state: ParticipantRow["eivState"]): "ok" | "warn" | "muted" {
  if (state === "submitted") return "ok";
  if (state === "needs_attention" || state === "failed" || state === "abandoned") {
    return "warn";
  }
  return "muted";
}

/**
 * German dates, in Berlin time — these are read against German deadlines, and
 * the same instant must render as the same day here, on the certificate and in
 * the CSV export. `@ds/domain` owns that decision.
 */
function formatDate(iso: string | null): string {
  return iso === null ? "—" : formatBerlinDate(new Date(iso));
}
