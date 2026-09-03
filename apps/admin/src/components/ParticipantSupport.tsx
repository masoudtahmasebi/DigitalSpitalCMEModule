/**
 * What a support operator can do about one participant's certificate and
 * Punktemeldung (P179).
 *
 * ## Why this screen exists
 *
 * The participant list said `unzustellbar` and stopped. The client, on that
 * one word:
 *
 *   > what does `undeliverable` mean, i need a retry button, i need error
 *   > handling, i need debugging, i need to be able to change efn if it is
 *   > incorrect […] how can an admin download the certificate of a person to
 *   > send it to them as a support person, this part is quite weak!
 *
 * Every fact in this panel had been in the database since P8-03 or P118-02 and
 * was returned by nothing, and two of the three actions existed on a *different
 * screen* the person in the middle of a support call had no reason to be on.
 * That is CLAUDE.md §9.3 and §9.8 in one place: a diagnosis nobody can read,
 * and a remedy with no address where the problem is.
 *
 * ## A panel, not more columns
 *
 * The table already carries eleven columns. The delivery cause, the mail
 * server's reply, the attempt count and three controls would make it
 * unreadable for the ninety-nine rows out of a hundred where nothing is wrong.
 * So the row opens.
 *
 * ## The one sentence that matters most
 *
 * `bouncedExplained`. A failed delivery says nothing about the entitlement —
 * `delivery.service.ts` is explicit that it must not — and an operator who does
 * not know that will tell a physician they have lost their Teilnahmebescheinigung.
 *
 * ## What is offered, and what is deliberately not
 *
 * **Resending is withheld** for `no_recipient` and `permanent_rejection`,
 * because it can only produce the same error (§9.2, P118-02). The cause is
 * printed in its place, saying what to do instead.
 *
 * **Correcting the EFN edits the Punktemeldung, never the profile.** The
 * physician's EFN is theirs — `efn_profiles`'s row-level `WITH CHECK` admits
 * only the subject — and the hint at the control says so, because an operator
 * who believes they have fixed the person's record has not fixed anything.
 */

import { useState } from "react";
import { formatBerlinDateTime } from "@ds/domain";
import type { ApiClient, ParticipantRow } from "@ds/sdk";
import { de } from "../locale/de.js";
import { describeError } from "../api.js";
import { Button, Field, Notice, TextInput } from "./ui.js";

type Reason = NonNullable<NonNullable<ParticipantRow["certificate"]>["abandonedReason"]>;

/**
 * Whether sending the same document again could possibly land (P118-02).
 *
 * The same rule the Bescheinigungen screen applies, and it is duplicated here
 * on purpose rather than shared: `Certificates.tsx` reads a `CertificateRecord`
 * and this reads a `ParticipantRow`, so a shared helper would take a third
 * shape neither of them has. What must not diverge is the *rule*, and it is one
 * line long with the reason written above it in both places.
 *
 * `attempts_exhausted` is the only resendable cause: transient failures ran out
 * of retries and the address was never refused.
 */
function resendable(reason: Reason | null): boolean {
  return reason !== "no_recipient" && reason !== "permanent_rejection";
}

export function ParticipantSupport(props: {
  client: ApiClient;
  courseSlug: string;
  row: ParticipantRow;
  /** Re-reads the list, so the panel reflects the server rather than a guess. */
  onChanged: () => void;
}) {
  const { client, row } = props;
  const certificate = row.certificate;

  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();
  const [done, setDone] = useState<string | undefined>();
  const [efn, setEfn] = useState("");

  async function act(run: () => Promise<void>, success?: string): Promise<void> {
    setBusy(true);
    setProblem(undefined);
    setDone(undefined);
    try {
      await run();
      if (success !== undefined) setDone(success);
      props.onChanged();
    } catch (error) {
      setProblem(describeError(error, de.error.generic));
    } finally {
      setBusy(false);
    }
  }

  async function download(): Promise<void> {
    if (certificate === null) return;
    await act(async () => {
      const { blob, filename } = await client.adminDownloadCertificate(certificate.id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      // A live blob: URL is a readable copy of a named physician's
      // participation record for as long as it exists.
      URL.revokeObjectURL(url);
    });
  }

  const state = row.certificateState;
  const reason = certificate?.abandonedReason ?? null;

  return (
    <div className="space-y-5 rounded-xl border border-gray-200 bg-gray-50/70 p-4">
      {problem === undefined ? null : <Notice tone="error">{problem}</Notice>}
      {done === undefined ? null : <Notice tone="success">{done}</Notice>}

      <section className="space-y-2">
        <h4 className="text-sm font-semibold text-gray-900">
          {de.participants.support.certificateHeading}
        </h4>

        {state === "none" ? (
          <p className="text-sm text-gray-600">{de.participants.support.noCertificate}</p>
        ) : null}
        {state === "pending" ? (
          <p className="text-sm text-gray-600">
            {de.participants.support.pendingCertificate}
          </p>
        ) : null}
        {state === "revoked" ? (
          <Notice tone="warning">{de.participants.support.revokedCertificate}</Notice>
        ) : null}

        {state === "bounced" ? (
          <>
            <Notice tone="warning">{de.participants.support.bouncedExplained}</Notice>
            <Detail label={de.participants.support.reasonLabel}>
              {reason === null
                ? de.participants.support.reasonUnknown
                : de.participants.support.reasons[reason]}
            </Detail>
          </>
        ) : null}

        {certificate === null ? null : (
          <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            {certificate.lastError === null ? null : (
              <Detail
                label={de.participants.support.lastErrorLabel}
                hint={de.participants.support.lastErrorHint}
              >
                <code className="rounded bg-white px-1.5 py-0.5 text-xs text-gray-800">
                  {certificate.lastError}
                </code>
              </Detail>
            )}
            <Detail label={de.participants.support.attemptsLabel}>
              {certificate.attemptCount}
            </Detail>
            {certificate.firstAttemptAt === null ? null : (
              <Detail label={de.participants.support.firstAttemptLabel}>
                {formatBerlinDateTime(new Date(certificate.firstAttemptAt))}
              </Detail>
            )}
            <Detail label={de.participants.support.nextAttemptLabel}>
              {certificate.nextAttemptAt === null
                ? de.participants.support.nextAttemptNone
                : formatBerlinDateTime(new Date(certificate.nextAttemptAt))}
            </Detail>
          </dl>
        )}

        {certificate === null || state === "revoked" ? null : (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {state === "pending" ? null : (
              <Button variant="secondary" disabled={busy} onClick={() => void download()}>
                {de.participants.support.download}
              </Button>
            )}

            {state === "pending" ? null : resendable(reason) ? (
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  void act(
                    () => client.adminResendCertificate(certificate.id),
                    de.participants.support.resent,
                  )
                }
              >
                {de.participants.support.resend}
              </Button>
            ) : (
              // Not a disabled button: the sentence says why, and a control
              // that can only fail looks like a decision to whoever clicks it.
              <p className="text-xs text-gray-600">
                {de.participants.support.resendBlocked}
              </p>
            )}

            <Button
              variant="secondary"
              disabled={busy}
              onClick={() =>
                void act(
                  () => client.adminRegenerateCertificate(certificate.id),
                  de.participants.support.regenerated,
                )
              }
            >
              {de.participants.support.regenerate}
            </Button>
          </div>
        )}

        {certificate === null || state === "revoked" || state === "pending" ? null : (
          <p className="text-xs text-gray-600">{de.participants.support.downloadHint}</p>
        )}
      </section>

      <section className="space-y-2 border-t border-gray-200 pt-4">
        <h4 className="text-sm font-semibold text-gray-900">
          {de.participants.support.efnHeading}
        </h4>

        {row.efnMasked === null ? (
          <p className="text-sm text-gray-600">{de.participants.support.efnNone}</p>
        ) : (
          <>
            <Detail
              label={de.participants.support.efnStored}
              hint={de.participants.support.efnMaskHint}
            >
              <code className="rounded bg-white px-1.5 py-0.5 text-xs tracking-widest text-gray-800">
                {row.efnMasked}
              </code>
            </Detail>

            {row.efnDivergesFromReport === true ? (
              <Notice tone="error">{de.participants.support.efnDiverges}</Notice>
            ) : row.efnDivergesFromReport === false ? (
              <p className="text-xs text-gray-600">{de.participants.support.efnAgrees}</p>
            ) : null}
          </>
        )}

        {row.eivState === "none" ? (
          <p className="text-sm text-gray-600">
            {de.participants.support.efnCorrectUnavailable}
          </p>
        ) : row.eivState === "submitted" || row.eivState === "withdrawn" ? (
          // Refused by the API too, and said here so the operator is not left
          // to discover it by typing fifteen digits (§9.2, §9.4).
          <Notice tone="warning">{de.participants.support.efnCorrectLocked}</Notice>
        ) : (
          <div className="space-y-2">
            <Field
              label={de.participants.support.efnCorrectField}
              hint={de.participants.support.efnCorrectHint}
              htmlFor={`efn-${row.enrolmentId}`}
            >
              <TextInput
                id={`efn-${row.enrolmentId}`}
                value={efn}
                maxLength={15}
                // An EFN is the key a physician's CME points are credited
                // against; letting a browser store it for autofill elsewhere is
                // a disclosure nobody asked for.
                autoComplete="off"
                inputMode="numeric"
                onChange={setEfn}
              />
            </Field>
            <Button
              variant="secondary"
              disabled={busy || !/^\s*[0-9]{15}\s*$/u.test(efn)}
              onClick={() =>
                void act(async () => {
                  await client.adminCorrectSubmissionEfn(row.enrolmentId, efn.trim());
                  setEfn("");
                }, de.participants.support.efnCorrected)
              }
            >
              {de.participants.support.efnCorrectAction}
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}

function Detail(props: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="py-0.5">
      <dt className="text-xs font-medium text-gray-500">{props.label}</dt>
      <dd className="text-sm text-gray-900">{props.children}</dd>
      {props.hint === undefined ? null : (
        <p className="mt-0.5 text-xs text-gray-500">{props.hint}</p>
      )}
    </div>
  );
}
