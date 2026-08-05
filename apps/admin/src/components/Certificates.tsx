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
 *   not for a wrong name.
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

type Status = CertificateRecord["status"];

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
      <p className="text-sm text-gray-700">{de.certificates.intro}</p>

      {problem === undefined ? null : (
        <Notice tone="error" title={de.error.title}>
          {problem}
        </Notice>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-gray-600">{de.certificates.empty}</p>
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
            return (
              <tr key={row.id} className="border-t border-gray-100">
                <td className="px-3 py-2 text-sm">{row.participantName}</td>
                <td className="px-3 py-2 text-sm">
                  <Badge tone={TONE[row.status]}>
                    {de.certificates.state[row.status]}
                  </Badge>
                </td>
                <td className="px-3 py-2 text-sm">{shortDate(row.issuedAt)}</td>
                <td className="px-3 py-2 text-sm">{shortDate(row.deliveredAt)}</td>
                <td className="px-3 py-2">
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
                      disabled={revoked || !issued}
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
