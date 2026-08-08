/**
 * Course settings (P9-03) and the certificate assets (P8).
 *
 * ## The threshold field is the point of this screen
 *
 * `passThresholdPercent` is a condition of the Anerkennungsbescheid, not a
 * difficulty knob. The form says what the number does, warns before the value
 * becomes invalid, and requires an explicit tick — and the server refuses
 * without that tick regardless, because a confirmation the client can skip is
 * not a confirmation. The checkbox here is a courtesy that prevents a
 * surprising 409, not the control itself.
 *
 * ## And the sentence about retroactivity
 *
 * Enrolments snapshot their thresholds (P3-01), so an edit never invalidates
 * work already done. That is stated plainly rather than left to be discovered,
 * because an admin who lowers a threshold to help somebody already enrolled
 * will otherwise think it worked.
 */

import { useEffect, useState } from "react";
import type { AdminCourseDetail, ApiClient } from "@ds/sdk";
import { de } from "../locale/de.js";
import { describeError } from "../api.js";
import { Badge, Button, Field, Notice, TextInput } from "./ui.js";

/** Mirrors `ACCREDITED_MIN_PASS_PERCENT` on the server, which is the authority. */
const ACCREDITED_MIN_PASS_PERCENT = 70;

export function CourseSettings(props: {
  client: ApiClient;
  course: AdminCourseDetail;
  onSaved: (course: AdminCourseDetail) => void;
}) {
  const { course } = props;

  const [form, setForm] = useState(() => initialForm(course));
  const [acknowledge, setAcknowledge] = useState(false);
  const [vnrPassword, setVnrPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();
  const [saved, setSaved] = useState(false);

  // A different course means a different form. Without this, navigating
  // between courses would show the previous one's unsaved edits.
  useEffect(() => {
    setForm(initialForm(course));
    setAcknowledge(false);
    setVnrPassword("");
    setSaved(false);
  }, [course]);

  const threshold = Number(form.passThresholdPercent);
  const belowAccredited =
    Number.isFinite(threshold) && threshold < ACCREDITED_MIN_PASS_PERCENT;

  async function save(): Promise<void> {
    setBusy(true);
    setProblem(undefined);
    setSaved(false);
    try {
      const updated = await props.client.adminUpdateCourse(course.slug, {
        requiredWatchPercent: Number(form.requiredWatchPercent),
        passThresholdPercent: threshold,
        organizer: emptyToNull(form.organizer),
        eventLocation: emptyToNull(form.eventLocation),
        accreditationBody: emptyToNull(form.accreditationBody),
        scientificLeadName: emptyToNull(form.scientificLeadName),
        scientificLeadTitle: emptyToNull(form.scientificLeadTitle),
        certificateIssuePlace: emptyToNull(form.certificateIssuePlace),
        vnr: emptyToNull(form.vnr),
        // Omitted when empty: an absent field means "leave alone", so editing
        // anything else does not require re-entering the credential.
        ...(vnrPassword === "" ? {} : { vnrPassword }),
        ...(belowAccredited ? { acknowledgeAccreditationRisk: acknowledge } : {}),
      });
      setVnrPassword("");
      setSaved(true);
      props.onSaved(updated);
    } catch (error) {
      setProblem(describeError(error, de.error.generic));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <h3 className="text-base font-semibold text-gray-900">{de.course.compliance}</h3>

        <Notice tone="warning">{de.course.notRetroactive}</Notice>

        <Field
          label={de.course.requiredWatchPercent}
          hint={de.course.requiredWatchHint}
          htmlFor="requiredWatchPercent"
        >
          <PercentInput
            id="requiredWatchPercent"
            value={form.requiredWatchPercent}
            onChange={(value) =>
              setForm((previous) => ({ ...previous, requiredWatchPercent: value }))
            }
          />
        </Field>

        <Field
          label={de.course.passThresholdPercent}
          hint={`${de.course.passThresholdHint} ${de.course.passThresholdAccredited(ACCREDITED_MIN_PASS_PERCENT)}`}
          htmlFor="passThresholdPercent"
        >
          <PercentInput
            id="passThresholdPercent"
            value={form.passThresholdPercent}
            onChange={(value) =>
              setForm((previous) => ({ ...previous, passThresholdPercent: value }))
            }
          />
        </Field>

        {belowAccredited ? (
          <Notice
            tone="error"
            title={de.course.accreditationWarning(ACCREDITED_MIN_PASS_PERCENT)}
          >
            <label className="mt-2 flex items-start gap-2">
              <input
                type="checkbox"
                checked={acknowledge}
                onChange={(event) => setAcknowledge(event.target.checked)}
                className="mt-0.5"
              />
              <span>{de.course.accreditationConfirm}</span>
            </label>
          </Notice>
        ) : null}
      </section>

      <section className="space-y-4">
        <h3 className="text-base font-semibold text-gray-900">{de.course.certificate}</h3>

        {course.certificateReady ? (
          <Notice tone="success">{de.course.readyForCertificate}</Notice>
        ) : (
          <Notice tone="warning" title={de.course.missingForCertificate}>
            <ul className="mt-1 list-inside list-disc">
              {course.missingCertificateFields.map((field) => (
                <li key={field}>{field}</li>
              ))}
            </ul>
          </Notice>
        )}

        <Field label={de.course.organizer} htmlFor="organizer">
          <TextInput
            id="organizer"
            value={form.organizer}
            maxLength={300}
            onChange={(value) => setForm((p) => ({ ...p, organizer: value }))}
          />
        </Field>
        <Field label={de.course.eventLocation} htmlFor="eventLocation">
          <TextInput
            id="eventLocation"
            value={form.eventLocation}
            maxLength={300}
            onChange={(value) => setForm((p) => ({ ...p, eventLocation: value }))}
          />
        </Field>
        <Field label={de.course.accreditationBody} htmlFor="accreditationBody">
          <TextInput
            id="accreditationBody"
            value={form.accreditationBody}
            maxLength={300}
            onChange={(value) => setForm((p) => ({ ...p, accreditationBody: value }))}
          />
        </Field>
        <Field label={de.course.scientificLeadTitle} htmlFor="scientificLeadTitle">
          <TextInput
            id="scientificLeadTitle"
            value={form.scientificLeadTitle}
            maxLength={100}
            onChange={(value) => setForm((p) => ({ ...p, scientificLeadTitle: value }))}
          />
        </Field>
        <Field label={de.course.scientificLeadName} htmlFor="scientificLeadName">
          <TextInput
            id="scientificLeadName"
            value={form.scientificLeadName}
            maxLength={200}
            onChange={(value) => setForm((p) => ({ ...p, scientificLeadName: value }))}
          />
        </Field>
        <Field label={de.course.certificateIssuePlace} htmlFor="certificateIssuePlace">
          <TextInput
            id="certificateIssuePlace"
            value={form.certificateIssuePlace}
            maxLength={200}
            onChange={(value) => setForm((p) => ({ ...p, certificateIssuePlace: value }))}
          />
        </Field>

        {/*
          The VNR before its password, because that is the order they matter
          in: without the number there is no Punktemeldung at all, and a
          password for a number nobody entered authenticates nothing. The
          console could set the password and not the number until P26-01 —
          which meant every course authored here quietly reported nothing.
        */}
        <Field label={de.course.vnr} hint={de.course.vnrHint} htmlFor="vnr">
          <TextInput
            id="vnr"
            value={form.vnr}
            maxLength={100}
            onChange={(value) => setForm((p) => ({ ...p, vnr: value }))}
          />
          {form.vnr.trim() === "" ? (
            <p className="text-xs text-amber-700">{de.course.vnrMissing}</p>
          ) : null}
        </Field>

        <Field
          label={de.course.vnrPassword}
          hint={de.course.vnrPasswordHint}
          htmlFor="vnrPassword"
        >
          <TextInput
            id="vnrPassword"
            type="password"
            // A credential that authenticates to an accreditation interface has
            // no business in a browser's saved-password store.
            autoComplete="new-password"
            value={vnrPassword}
            maxLength={200}
            onChange={setVnrPassword}
          />
          <p className="text-xs text-gray-600">
            {course.hasVnrPassword
              ? de.course.vnrPasswordStored
              : de.course.vnrPasswordMissing}
          </p>
        </Field>
      </section>

      {problem === undefined ? null : <Notice tone="error">{problem}</Notice>}
      {saved ? <Notice tone="success">{de.course.saved}</Notice> : null}

      <Button
        disabled={busy || (belowAccredited && !acknowledge)}
        onClick={() => void save()}
      >
        {busy ? de.course.saving : de.course.save}
      </Button>

      <AssetUpload client={props.client} course={course} onSaved={props.onSaved} />
    </div>
  );
}

/**
 * Stamp and signature upload.
 *
 * Read in the browser as base64 and posted as JSON — the API takes them that
 * way deliberately (see the endpoint's description). The file's real type is
 * decided by the server from its magic bytes; the `accept` attribute here is a
 * convenience for the file picker, not a check.
 */
function AssetUpload(props: {
  client: ApiClient;
  course: AdminCourseDetail;
  onSaved: (course: AdminCourseDetail) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();

  async function upload(kind: "stamp" | "signature", file: File): Promise<void> {
    setBusy(true);
    setProblem(undefined);
    try {
      const base64 = await readBase64(file);
      const updated = await props.client.adminSetCertificateAssets(props.course.slug, {
        ...(kind === "stamp"
          ? { stampImageBase64: base64 }
          : { signatureImageBase64: base64 }),
      });
      props.onSaved(updated);
    } catch (error) {
      setProblem(describeError(error, de.error.generic));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3 border-t border-gray-200 pt-6">
      <h3 className="text-base font-semibold text-gray-900">{de.course.uploadImages}</h3>
      <p className="text-xs text-gray-600">{de.course.imageHint}</p>

      <AssetRow
        label={de.course.stamp}
        present={props.course.hasStampImage}
        disabled={busy}
        onFile={(file) => void upload("stamp", file)}
      />
      <AssetRow
        label={de.course.signature}
        present={props.course.hasSignatureImage}
        disabled={busy}
        onFile={(file) => void upload("signature", file)}
      />

      {busy ? <p className="text-sm text-gray-600">{de.course.uploading}</p> : null}
      {problem === undefined ? null : <Notice tone="error">{problem}</Notice>}
    </section>
  );
}

function AssetRow(props: {
  label: string;
  present: boolean;
  disabled: boolean;
  onFile: (file: File) => void;
}) {
  const id = `asset-${props.label.replace(/\W+/g, "-")}`;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <label htmlFor={id} className="min-w-64 text-sm text-gray-900">
        {props.label}
      </label>
      <Badge tone={props.present ? "ok" : "warn"}>
        {props.present ? de.course.imageStored : de.course.imageMissing}
      </Badge>
      <input
        id={id}
        type="file"
        accept="image/png,image/jpeg"
        disabled={props.disabled}
        className="text-sm"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file !== undefined) props.onFile(file);
          // Clear it so re-selecting the same file fires change again.
          event.target.value = "";
        }}
      />
    </div>
  );
}

function PercentInput(props: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <input
      id={props.id}
      type="number"
      inputMode="numeric"
      min={0}
      max={100}
      step={1}
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
      className="w-28 rounded-md border border-gray-300 px-3 py-2 text-sm"
    />
  );
}

function initialForm(course: AdminCourseDetail) {
  return {
    requiredWatchPercent: String(course.requiredWatchPercent),
    passThresholdPercent: String(course.passThresholdPercent),
    organizer: course.organizer ?? "",
    eventLocation: course.eventLocation ?? "",
    accreditationBody: course.accreditationBody ?? "",
    scientificLeadName: course.scientificLeadName ?? "",
    scientificLeadTitle: course.scientificLeadTitle ?? "",
    certificateIssuePlace: course.certificateIssuePlace ?? "",
    vnr: course.vnr ?? "",
  };
}

function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** `FileReader` gives a data URL; the API wants the payload without the prefix. */
function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("could not read the selected file"));
    reader.onload = () => {
      const result = String(reader.result);
      const comma = result.indexOf(",");
      resolve(comma === -1 ? result : result.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
}
