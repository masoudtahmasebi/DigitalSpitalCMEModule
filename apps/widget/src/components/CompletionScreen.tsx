/**
 * Punktemeldung — the last screen of the course (layout page 13).
 *
 * ## One form, one request
 *
 * The layout draws Titel, Vorname, Nachname, EFN-Nummer and a consent checkbox
 * behind a single **Daten übermitteln**, and that is what this sends: one
 * `POST /courses/{slug}/completion` carrying all of it. Splitting it would give
 * a physician three ways to end up half-submitted — an EFN stored against a
 * course never completed, or a completion queued before the consent that
 * authorises it — and there is no screen here on which they could see or repair
 * that state.
 *
 * ## The EFN
 *
 * Checked here only so a typo is visible immediately; `isValidEfn` in
 * `@ds/domain` is the real rule and it runs server-side. `autoComplete="off"`
 * matters: an EFN is the key a physician's CME points are credited against, and
 * letting a browser store it for autofill on an unrelated site is a disclosure
 * nobody asked for. It is never read back — no endpoint returns it (ADR-0004) —
 * so once submitted this screen can only say that one is on file.
 *
 * **The layout says eighteen digits and the platform validates fifteen.** That
 * is unresolved (S21) and is deliberately not papered over: the hint says
 * fifteen, because a hint that disagrees with the validator is worse than one
 * that disagrees with a mock-up.
 *
 * ## The consent
 *
 * The checkbox is not decoration and not merely a gate on the button. Ticking
 * it sends `consentDocument` — the version of the privacy notice shown — which
 * the API stores with the completion timestamp. GDPR Art. 7(1) puts the burden
 * of demonstrating consent on the controller, and a box the browser validated
 * and nobody recorded demonstrates nothing.
 *
 * When the project has configured no privacy notice there is nothing to consent
 * *to*, so the checkbox is not drawn and no consent is claimed. Showing an
 * unlinked checkbox would be asking somebody to agree to a document that does
 * not exist.
 */

import { useState } from "react";
import type { Branding } from "@ds/domain";
import type { ApiClient, EnrolmentState } from "@ds/sdk";
import { de } from "../locale/de.js";
import { describeError } from "../hooks.js";
import { Button, ErrorNotice } from "./primitives.js";

const EFN_PATTERN = /^[0-9]{15}$/;

/** The first option is "Ohne Titel" and means "send no title". */
const NO_TITLE = de.completion.titles[0] ?? "";

export function CompletionScreen(props: {
  client: ApiClient;
  courseSlug: string;
  state: EnrolmentState;
  branding: Branding;
  onCompleted: () => void;
}) {
  const [title, setTitle] = useState("");
  const [givenName, setGivenName] = useState("");
  const [familyName, setFamilyName] = useState("");
  const [efn, setEfn] = useState("");
  const [consented, setConsented] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();

  const { client, courseSlug, state, branding } = props;

  const policyUrl = branding.privacyPolicyUrl;
  const policyVersion = branding.privacyPolicyVersion;
  // Both or neither — `parseBranding` accepts them as a pair.
  const consentAvailable = policyUrl !== undefined && policyVersion !== undefined;

  const efnNeeded = !state.efnPresent;
  const efnValid = EFN_PATTERN.test(efn);

  const ready =
    givenName.trim() !== "" &&
    familyName.trim() !== "" &&
    (!efnNeeded || efnValid) &&
    (!consentAvailable || consented);

  function report(error: unknown): void {
    setProblem(
      describeError(error instanceof Error ? error : undefined, {
        unauthenticated: de.error.unauthenticated,
        generic: de.error.generic,
        noCourse: de.error.noCourse,
      }),
    );
  }

  async function submit(): Promise<void> {
    setBusy(true);
    setProblem(undefined);
    try {
      await client.completeCourse(courseSlug, {
        ...(title === "" || title === NO_TITLE ? {} : { attestedTitle: title }),
        attestedGivenName: givenName.trim(),
        attestedFamilyName: familyName.trim(),
        ...(efnNeeded ? { efn } : {}),
        ...(consentAvailable && consented ? { consentDocument: policyVersion } : {}),
      });
      // Cleared the moment it leaves. Nothing is gained by keeping a
      // physician's EFN in this component afterwards.
      setEfn("");
      props.onCompleted();
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  }

  if (state.completedAt !== null) {
    return (
      <p
        className="rounded-md bg-green-50 p-4 text-sm text-status-completed"
        role="status"
      >
        {de.completion.done}
      </p>
    );
  }

  const blockers = state.outstanding.filter((condition) => condition !== "efn");

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">{de.completion.title}</h2>
        <p className="mt-1 text-gray-800">{de.completion.subtitle}</p>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-gray-800">
          {de.completion.intro}
        </p>
      </div>

      {/* The grey explanation box the layout puts above the fields. */}
      <div className="flex gap-4 rounded-xl border border-gray-200 bg-gray-50 p-4">
        <span
          aria-hidden="true"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-300 text-base font-bold text-gray-700"
        >
          ?
        </span>
        <p className="text-sm leading-relaxed text-gray-600">{de.completion.whyEfn}</p>
      </div>

      <hr className="border-gray-200" />

      <div className="max-w-xl space-y-5">
        <Field label={de.completion.titleLabel} htmlFor="ds-lms-title">
          <select
            id="ds-lms-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="w-full max-w-xs rounded-md border border-gray-300 bg-white px-3 py-2.5 text-sm"
          >
            <option value="">{de.completion.titlePlaceholder}</option>
            {de.completion.titles.map((entry) => (
              <option key={entry} value={entry}>
                {entry}
              </option>
            ))}
          </select>
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label={de.completion.givenNameLabel} htmlFor="ds-lms-given" required>
            <input
              id="ds-lms-given"
              value={givenName}
              maxLength={100}
              autoComplete="given-name"
              placeholder={de.completion.givenNamePlaceholder}
              onChange={(event) => setGivenName(event.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2.5 text-sm"
            />
          </Field>
          <Field label={de.completion.familyNameLabel} htmlFor="ds-lms-family" required>
            <input
              id="ds-lms-family"
              value={familyName}
              maxLength={100}
              autoComplete="family-name"
              placeholder={de.completion.familyNamePlaceholder}
              onChange={(event) => setFamilyName(event.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2.5 text-sm"
            />
          </Field>
        </div>

        {efnNeeded ? (
          <Field label={de.completion.efnLabel} htmlFor="ds-lms-efn" required>
            <input
              id="ds-lms-efn"
              value={efn}
              inputMode="numeric"
              // Never offered back by a browser on another site.
              autoComplete="off"
              maxLength={15}
              aria-describedby="ds-lms-efn-hint"
              onChange={(event) => setEfn(event.target.value.replace(/\D/gu, ""))}
              className="w-full rounded-md border border-gray-300 px-3 py-2.5 text-sm tracking-[0.25em]"
            />
            <p id="ds-lms-efn-hint" className="mt-1.5 text-xs text-gray-500">
              {de.completion.efnHint}
            </p>
            {efn !== "" && !efnValid ? (
              <p className="mt-1 text-xs text-red-700">{de.completion.efnInvalid}</p>
            ) : null}
          </Field>
        ) : (
          <p className="text-sm text-status-completed">{de.completion.efnSaved}</p>
        )}

        {consentAvailable ? (
          <label className="flex items-start gap-3 text-sm leading-relaxed text-gray-800">
            <input
              type="checkbox"
              checked={consented}
              onChange={(event) => setConsented(event.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0"
            />
            <span>
              {de.completion.consentBefore}
              <a
                href={policyUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="text-brand-700 underline"
              >
                {de.completion.consentLink}
              </a>
              {de.completion.consentAfter}
            </span>
          </label>
        ) : null}
      </div>

      {blockers.length > 0 ? (
        <p className="text-sm text-status-inProgress">
          {de.completion.outstanding}{" "}
          {blockers.map((condition) => de.completion.conditions[condition]).join(", ")}.
        </p>
      ) : null}

      {problem === undefined ? null : (
        <ErrorNotice title={de.error.title} message={problem} />
      )}

      <Button variant="cta" disabled={!ready || busy} onClick={() => void submit()}>
        {busy ? de.completion.submitting : de.completion.submit}
        <span aria-hidden="true">→</span>
      </Button>
    </div>
  );
}

/**
 * A labelled field, with the layout's orange asterisk on the required ones.
 *
 * The asterisk is `aria-hidden` and `required` is carried by the label text
 * instead — a screen reader announcing "star" tells nobody anything, and the
 * inputs themselves are not marked `required` because the submit button is
 * already disabled until the form is coherent.
 */
function Field(props: {
  label: string;
  htmlFor: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={props.htmlFor} className="block text-sm font-medium text-gray-900">
        {props.label}
        {props.required === true ? (
          <span aria-hidden="true" className="ml-0.5 text-cta-500">
            *
          </span>
        ) : null}
      </label>
      <div className="mt-1.5">{props.children}</div>
    </div>
  );
}
