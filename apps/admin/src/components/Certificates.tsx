/**
 * Certificate moderation (P12-05).
 *
 * Three actions, and the difference between them is worth stating on the
 * screen because it is not obvious from the words:
 *
 * - **Neu erstellen** re-renders the document from the enrolment, picking up a
 *   corrected name. It reports nothing to the Ärztekammer — the certificate and
 *   the Punktemeldung share no code path.
 * - **Erneut senden** sends the *same* document again. For a bounced address,
 *   not for a wrong name — and not at all when the reason it bounced is one
 *   resending cannot change (P118-02).
 * - **Widerrufen** withdraws the document and keeps the record. The enrolment,
 *   the progress and any Punktemeldung stay exactly where they were.
 *
 * Which are available depends on status, and the API decides — a revoked
 * certificate refuses all three. The console mirrors that so the operator is
 * not offered a button that cannot work.
 */

import { useCallback, useEffect, useState } from "react";
import type { ApiClient, CertificateRecord } from "@ds/sdk";
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

type Status = CertificateRecord["status"];

type AbandonedReason = NonNullable<CertificateRecord["deliveryAbandonedReason"]>;

/**
 * Whether sending the same document again could possibly land (P118-02).
 *
 * `bounced` on its own says the email did not arrive, and the three reasons
 * behind it want three different things from the operator:
 *
 * | reason | what to do |
 * | --- | --- |
 * | `no_recipient` | there is no address on file — the participant supplies one |
 * | `permanent_rejection` | the address exists and was refused — correct it |
 * | `attempts_exhausted` | transient failures ran out of retries — resending is exactly right |
 *
 * Only the last is a resend. Offering the button for the other two is §9.2 — a
 * control that can only produce the same error, which looks like a decision to
 * whoever clicks it.
 */
function resendable(reason: string | null | undefined): boolean {
  return reason !== "no_recipient" && reason !== "permanent_rejection";
}

const TONE: Record<Status, "ok" | "warn" | "muted"> = {
  pending: "muted",
  issued: "ok",
  delivered: "ok",
  bounced: "warn",
  revoked: "warn",
};

export function Certificates(props: { client: ApiClient; courseSlug?: string }) {
  const { client, courseSlug } = props;
  const [rows, setRows] = useState<CertificateRecord[] | undefined>();
  const [problem, setProblem] = useState<string | undefined>();
  const [forbidden, setForbidden] = useState(false);

  const load = useCallback(async () => {
    setProblem(undefined);
    try {
      setRows(await client.adminListCertificates(courseSlug));
    } catch (error) {
      if (isForbidden(error)) setForbidden(true);
      else setProblem(describeError(error, de.certificates.loadFailed));
    }
  }, [client, courseSlug]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(run: () => Promise<void>): Promise<void> {
    setProblem(undefined);
    try {
      await run();
      await load();
    } catch (error) {
      setProblem(describeError(error, de.certificates.actionFailed));
    }
  }

  if (forbidden) {
    return (
      <Notice tone="warning" title={de.error.title}>
        {de.auth.forbidden}
      </Notice>
    );
  }

  if (rows === undefined) {
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

  return (
    <div className="space-y-5">
      {/* Heading and intro come from `Page` (P30-02). */}
      {problem === undefined ? null : (
        <Notice tone="error" title={de.error.title}>
          {problem}
        </Notice>
      )}

      {rows.length === 0 ? (
        <EmptyState
          title={de.certificates.empty}
          description={de.certificates.emptyHint}
        />
      ) : (
        <Table
          headers={[
            de.certificates.participant,
            de.certificates.status,
            de.certificates.issued,
            de.certificates.delivered,
            "",
          ]}
        >
          {rows.map((row) => {
            const revoked = row.status === "revoked";
            const issued = row.status !== "pending";
            const reason = row.deliveryAbandonedReason;
            const canResend = resendable(reason);
            return (
              <tr key={row.id} className="border-t border-gray-100">
                <td className="text-sm">{row.participantName}</td>
                <td className="text-sm">
                  <Badge tone={TONE[row.status]}>
                    {de.certificates.state[row.status]}
                  </Badge>
                  {/*
                   * The reason, under the status rather than in a tooltip.
                   * "Zustellung fehlgeschlagen" is the fact; this is the
                   * sentence saying what the operator does about it (§9.4),
                   * and until P118-02 the API returned it to nobody.
                   */}
                  {reason === null ? null : (
                    <p className="mt-1 text-xs text-gray-500">
                      {de.certificates.abandoned[reason as AbandonedReason] ?? reason}
                    </p>
                  )}
                </td>
                <td className="text-sm">{shortDate(row.issuedAt)}</td>
                <td className="text-sm">{shortDate(row.deliveredAt)}</td>
                <td>
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button
                      variant="secondary"
                      disabled={revoked}
                      onClick={() =>
                        void act(() => client.adminRegenerateCertificate(row.id))
                      }
                    >
                      {de.certificates.regenerate}
                    </Button>
                    <Button
                      variant="secondary"
                      // Disabled without a tooltip on purpose: the reason is
                      // already a sentence under the status, where somebody
                      // asking "why can I not send this?" is looking. A tooltip
                      // is the same text somewhere they have to discover (§9.4).
                      disabled={revoked || !issued || !canResend}
                      onClick={() =>
                        void act(() => client.adminResendCertificate(row.id))
                      }
                    >
                      {de.certificates.resend}
                    </Button>
                    <ConfirmButton
                      label={de.certificates.revoke}
                      confirmLabel={de.certificates.revokeConfirm}
                      cancelLabel={de.common.cancel}
                      disabledReason={
                        revoked
                          ? de.certificates.alreadyRevoked
                          : issued
                            ? undefined
                            : de.certificates.notIssued
                      }
                      onConfirm={() =>
                        void act(() => client.adminRevokeCertificate(row.id))
                      }
                    />
                  </div>
                </td>
              </tr>
            );
          })}
        </Table>
      )}
    </div>
  );
}

/** The date, not the instant — nobody moderating a certificate needs seconds. */
function shortDate(iso: string | null): string {
  return iso === null ? "—" : (iso.slice(0, 10) ?? "—");
}
