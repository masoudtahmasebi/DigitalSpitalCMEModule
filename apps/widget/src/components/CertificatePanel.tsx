/**
 * The Teilnahmebescheinigung (P8).
 *
 * Shows the fields the Anerkennungsbescheid requires — so a learner can check
 * their own name and the VNR before downloading — and then fetches the PDF.
 *
 * The download goes through the SDK rather than a plain `<a href>` because the
 * endpoint needs a bearer token, which an anchor cannot carry. The blob URL is
 * revoked immediately after the click: a live `blob:` URL is a readable copy
 * of a named physician's participation record for as long as it exists.
 *
 * The creditability sentence is rendered from `creditSentence`, which the API
 * templated from the course's own points and category. Nothing here formats a
 * points figure — a widget that hardcoded "4 Punkten (Kategorie D)" would print
 * the wrong sentence the day a second course exists.
 */

import { useState } from "react";
import type { ApiClient, Certificate } from "@ds/sdk";
import { de } from "../locale/de.js";
import { describeError } from "../hooks.js";
import { Button, ErrorNotice } from "./primitives.js";

export function CertificatePanel(props: {
  client: ApiClient;
  courseSlug: string;
  certificate: Certificate;
}) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();

  async function download(): Promise<void> {
    setBusy(true);
    setProblem(undefined);
    try {
      const { blob, filename } = await props.client.downloadCertificate(props.courseSlug);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setProblem(
        describeError(error instanceof Error ? error : undefined, {
          unauthenticated: de.error.unauthenticated,
          generic: de.error.generic,
          noCourse: de.error.noCourse,
        }),
      );
    } finally {
      setBusy(false);
    }
  }

  const completedAt = new Date(props.certificate.completedAt);

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-gray-900">{de.certificate.title}</h2>

      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <Field label={de.certificate.participant} value={props.certificate.participantName} />
        <Field label={de.certificate.vnr} value={props.certificate.vnr} />
        <Field label={de.certificate.date} value={formatDate(completedAt)} />
        <Field label={de.certificate.time} value={formatTime(completedAt)} />
        <Field label={de.certificate.location} value={props.certificate.eventLocation} />
        <Field label={de.certificate.organizer} value={props.certificate.organizer} />
      </dl>

      <p className="rounded-md bg-gray-100 p-3 text-sm font-medium text-gray-900">
        {props.certificate.creditSentence}
      </p>

      {problem === undefined ? null : (
        <ErrorNotice title={de.error.title} message={problem} />
      )}

      <Button disabled={busy} onClick={() => void download()}>
        {busy ? de.certificate.downloading : de.certificate.download}
      </Button>
    </div>
  );
}

function Field(props: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-gray-500">{props.label}</dt>
      <dd className="text-gray-900">{props.value}</dd>
    </div>
  );
}

/**
 * German presentation of a UTC instant.
 *
 * `Europe/Berlin` is named explicitly rather than relying on the browser's
 * zone: the date on a Teilnahmebescheinigung is the German event date, and a
 * physician reading it from another timezone must see the same day the
 * Ärztekammer was told about — not their local rendering of the same instant.
 */
function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function formatTime(date: Date): string {
  return `${new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)} Uhr`;
}
