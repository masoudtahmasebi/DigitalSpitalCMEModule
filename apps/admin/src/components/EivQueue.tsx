/**
 * The Punktemeldung queue (P110-01).
 *
 * ## Why this had to exist
 *
 * Two routes have taken a submission's `enrolmentId` since P31-02 — requeue and
 * withdraw — and **nothing listed them**. An operator could act on a row only
 * if they had obtained its identifier from the database by hand. That is §9.2
 * in its second form: not a control the system will refuse, but a control
 * nobody can reach.
 *
 * It came up from two directions on the same day. The client asked whether a
 * moderator can see what the system is doing, and the answer for the one
 * subsystem with a **statutory deadline** was no. And arming the worker against
 * the live register turned out to flush whatever is already queued, which meant
 * the count of pending Punktemeldungen mattered urgently and appeared nowhere
 * but a deploy log.
 *
 * ## What it shows first
 *
 * The deadline. Rows are ordered by `reportDueAt` ascending, not by recency:
 * the row closest to the 8-day limit is the one an operator has to act on, and
 * it is rarely the newest. `dueNow` — how many rows the next sweep will file —
 * is counted across the whole queue rather than the page, because it is the
 * number somebody deciding whether to arm the worker needs and a figure that
 * changed when you paged would be worse than none.
 *
 * ## What it does not show
 *
 * The EFN. `efnMasked` carries the last four digits, the same shape
 * `EivReconciliationRow` uses and for the same reason (ADR-0004) — enough to
 * recognise a row beside a person you are already looking at, never a
 * disclosure. The full number does not exist in any shape this screen receives.
 *
 * And it never contacts EIV. `Abgleich` on the course screen asks the authority
 * what *they* hold; this is what *we* hold. Keeping them apart means the queue
 * still opens when EIV is down, which is exactly when an operator needs it.
 */

import { useCallback, useEffect, useState } from "react";
import type { ApiClient, EivSubmissionPage, EivSubmissionRow } from "@ds/sdk";
import { de } from "../locale/de.js";
import { describeError, isForbidden } from "../api.js";
import {
  Badge,
  Button,
  ConfirmButton,
  LoadFailure,
  Notice,
  Spinner,
  Table,
} from "./ui.js";
import { EmptyState } from "./page.js";

type Status = EivSubmissionRow["status"];

/**
 * Three tones, seven states.
 *
 * `warn` is reserved for the states an operator has to *do* something about.
 * `failed_retryable` is deliberately muted: the worker is still trying, and
 * colouring every transient failure would train somebody to ignore the colour
 * by the time a `failed_permanent` appears.
 */
const TONE: Record<Status, "ok" | "warn" | "muted"> = {
  queued: "muted",
  held: "muted",
  submitted: "ok",
  failed_retryable: "muted",
  failed_permanent: "warn",
  window_closed: "warn",
  withdrawn: "muted",
};

/** Every state, plus "all" — so the filter can be cleared without a reload. */
const FILTERS: readonly (Status | "all")[] = [
  "all",
  "queued",
  "failed_retryable",
  "failed_permanent",
  "window_closed",
  "submitted",
  "held",
  "withdrawn",
];

const PER_PAGE = 25;

export function EivQueue(props: { client: ApiClient }) {
  const { client } = props;
  const [status, setStatus] = useState<Status | "all">("all");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<EivSubmissionPage | undefined>();
  const [problem, setProblem] = useState<string | undefined>();
  const [forbidden, setForbidden] = useState(false);

  const load = useCallback(async () => {
    setProblem(undefined);
    try {
      setData(
        await client.adminListEivSubmissions({
          ...(status === "all" ? {} : { status }),
          page,
          perPage: PER_PAGE,
        }),
      );
    } catch (error) {
      if (isForbidden(error)) setForbidden(true);
      else setProblem(describeError(error, de.eivQueue.loadFailed));
    }
  }, [client, status, page]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(run: () => Promise<void>): Promise<void> {
    setProblem(undefined);
    try {
      await run();
      await load();
    } catch (error) {
      setProblem(describeError(error, de.eivQueue.actionFailed));
    }
  }

  if (forbidden) {
    return (
      <Notice tone="warning" title={de.error.title}>
        {de.auth.forbidden}
      </Notice>
    );
  }

  if (data === undefined) {
    return problem === undefined ? (
      <Spinner label={de.loading} />
    ) : (
      <LoadFailure
        title={de.error.title}
        retryLabel={de.error.retry}
        problem={problem}
        onRetry={() => void load()}
      />
    );
  }

  const lastPage = Math.max(1, Math.ceil(data.total / PER_PAGE));

  return (
    <div className="space-y-5">
      {problem === undefined ? null : (
        <Notice tone="error" title={de.error.title}>
          {problem}
        </Notice>
      )}

      {/*
        The figure the deploy prints, in the place an operator actually looks.
        Shown only when it is not zero: a standing "0 fällig" is a line somebody
        stops reading, and then does not read on the day it says 14.
      */}
      {data.dueNow === 0 ? null : (
        <Notice tone="info" title={de.eivQueue.dueTitle}>
          {de.eivQueue.dueBody(data.dueNow)}
        </Notice>
      )}

      <div className="flex flex-wrap gap-2" role="group" aria-label={de.eivQueue.filter}>
        {FILTERS.map((value) => (
          <Button
            key={value}
            variant={value === status ? "primary" : "secondary"}
            onClick={() => {
              setStatus(value);
              // A filter change starts at page 1: narrowing while on page 3
              // otherwise lands on an empty page of a shorter result set, which
              // reads as "nothing matches" for a filter that matches plenty.
              setPage(1);
            }}
          >
            {value === "all" ? de.eivQueue.statusAll : de.eivQueue.status[value]}
          </Button>
        ))}
      </div>

      {/*
        Whether anything will actually be filed (P121-01).

        This screen's entire meaning turns on it, and until now it could not
        say: both inputs sat in the API's configuration and surfaced only inside
        an EIV-Abgleich result — a check somebody has to know to run, on a
        course that already has a VNR. Anybody without a shell on the host had
        no way to establish it at all, which is precisely the person testing.

        Rendered whichever way it reads. A banner that appears only when
        reporting is off would leave "no banner" meaning both "reporting is
        live" and "this build is too old to say", and those are the two states
        it most matters to tell apart (§9.1).
      */}
      {data?.reporting === undefined ? null : (
        <Notice
          tone={data.reporting.willFile ? "warning" : "info"}
          title={
            data.reporting.willFile
              ? de.eivQueue.reporting.liveTitle
              : de.eivQueue.reporting.offTitle
          }
        >
          {data.reporting.willFile
            ? de.eivQueue.reporting.live
            : de.eivQueue.reporting.off}{" "}
          {de.eivQueue.reporting.endpoint[data.reporting.tier]}
        </Notice>
      )}

      {data.items.length === 0 ? (
        <EmptyState title={de.eivQueue.empty} description={de.eivQueue.emptyHint} />
      ) : (
        <Table
          headers={[
            de.eivQueue.participant,
            de.eivQueue.course,
            de.eivQueue.status_,
            de.eivQueue.due,
            de.eivQueue.attempts,
            "",
          ]}
        >
          {data.items.map((row) => (
            <tr key={row.enrolmentId}>
              <td className="px-3 py-2 font-mono text-xs">{row.efnMasked}</td>
              <td className="px-3 py-2">
                <div>{row.courseTitle ?? row.courseSlug}</div>
                <div className="text-xs text-gray-500">
                  {de.eivQueue.vnr}&nbsp;{row.vnr}
                </div>
              </td>
              <td className="px-3 py-2">
                <Badge tone={TONE[row.status]}>{de.eivQueue.status[row.status]}</Badge>
                {/*
                  What EIV actually said, as a sentence naming who can fix it
                  (P119-03).

                  `lastError` below is the worker's reasoning and stays folded
                  away, because it is a technical string. This is the other
                  question — *who acts* — and it is the one an operator opened
                  this screen to answer. Until P119-01 the two were the same
                  column and `permanent_rejection` was the answer to both, which
                  is no answer to either.
                */}
                {row.failureKind === null ? null : (
                  <p className="mt-1 max-w-md text-xs text-gray-600">
                    {de.eivQueue.failureKind[
                      row.failureKind as keyof typeof de.eivQueue.failureKind
                    ] ?? row.failureKind}
                  </p>
                )}
                {row.lastError === null ? null : (
                  /*
                    The worker's own last error, folded away. It is already
                    redacted of credentials by the EIV client and never carries
                    the EFN — but it is a technical string, and putting it in
                    the row would make every failed line unreadable.
                  */
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs text-gray-500">
                      {de.eivQueue.lastError}
                    </summary>
                    <p className="mt-1 max-w-md whitespace-pre-wrap break-words text-xs text-gray-600">
                      {row.lastError}
                    </p>
                  </details>
                )}
              </td>
              <td className="px-3 py-2 text-sm tabular-nums">
                {formatBerlin(row.reportDueAt)}
                {row.dueNow ? (
                  <div className="text-xs font-medium text-brand-700">
                    {de.eivQueue.dueNow}
                  </div>
                ) : null}
              </td>
              <td className="px-3 py-2 tabular-nums">{row.attemptCount}</td>
              <td className="px-3 py-2">
                <div className="flex justify-end gap-2">
                  {/*
                    Requeue is offered only where the worker has actually given
                    up. On a row it is still retrying, the button would do
                    nothing an operator could observe and would read as a fix
                    that did not work (§9.2).
                  */}
                  {row.status === "failed_permanent" || row.status === "held" ? (
                    <Button
                      variant="secondary"
                      onClick={() =>
                        void act(() => client.adminRequeueEivSubmission(row.enrolmentId))
                      }
                    >
                      {de.eivQueue.requeue}
                    </Button>
                  ) : null}

                  {/*
                    Withdrawing is a statutory correction, not a delete: EIV
                    keeps the record with the points zeroed. Offered only on a
                    row the authority has actually accepted, because there is
                    nothing to correct otherwise.
                  */}
                  {row.status === "submitted" ? (
                    <ConfirmButton
                      label={de.eivQueue.withdraw}
                      confirmLabel={de.eivQueue.withdrawConfirm}
                      cancelLabel={de.eivQueue.withdrawCancel}
                      ariaLabel={de.eivQueue.withdrawFor(row.efnMasked)}
                      onConfirm={() =>
                        void act(() =>
                          client.adminWithdrawEivSubmission(
                            row.enrolmentId,
                            de.eivQueue.withdrawReason,
                          ),
                        )
                      }
                    />
                  ) : null}
                </div>
              </td>
            </tr>
          ))}
        </Table>
      )}

      {lastPage <= 1 ? null : (
        <div className="flex items-center gap-3 text-sm">
          <Button
            variant="secondary"
            disabled={page <= 1}
            onClick={() => setPage((n) => Math.max(1, n - 1))}
          >
            {de.eivQueue.previous}
          </Button>
          <span className="tabular-nums text-gray-600">
            {de.eivQueue.pageOf(page, lastPage)}
          </span>
          <Button
            variant="secondary"
            disabled={page >= lastPage}
            onClick={() => setPage((n) => Math.min(lastPage, n + 1))}
          >
            {de.eivQueue.next}
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * German local time, which is what the deadline is actually reckoned in.
 *
 * The EIV check screen printed raw UTC ISO strings and it is how a one-day
 * accreditation window went unnoticed for a fortnight — `2025-10-12T22:00:00Z`
 * does not read as "13. Oktober" to anybody. Timestamps are stored and
 * transported as UTC; presenting them is a presentation concern (§5).
 */
function formatBerlin(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "—";
  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Berlin",
  }).format(at);
}
