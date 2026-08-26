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
 * nobody asked for.
 *
 * **A stored EFN is now shown back, and can be corrected** (P54-02). This
 * screen used to say only "Ihre EFN ist hinterlegt", because no endpoint
 * returned one — which meant a physician who had mistyped a digit months
 * earlier could read a reassuring sentence about the wrong number, and the
 * first sign of it would be points credited to somebody else's account. The
 * value comes from `GET /profile/efn`, which answers for the session and takes
 * no subject, and the correction goes back through `PUT /profile/efn` while the
 * course is still open.
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

import { useEffect, useState } from "react";
import type { Branding } from "@ds/domain";
import type { ApiClient, EnrolmentState } from "@ds/sdk";
import { de } from "../locale/de.js";
import { PunktemeldungNotice } from "./PunktemeldungNotice.js";
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
  /**
   * The Muster's "Anschrift:" line (P60-03).
   *
   * Optional, and it stays optional: the Anerkennungsbescheid's minimum field
   * list does not include it (docs/show-stoppers.md S12), so a physician who
   * does not want to give a postal address must still be able to finish. The
   * certificate draws the line either way.
   */
  const [address, setAddress] = useState("");
  const [consented, setConsented] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();
  /** The EFN already on file, once read back. `undefined` while unknown. */
  const [storedEfn, setStoredEfn] = useState<string | undefined>();
  const [correcting, setCorrecting] = useState(false);

  const { client, courseSlug, state, branding } = props;

  const policyUrl = branding.privacyPolicyUrl;
  const policyVersion = branding.privacyPolicyVersion;
  // Both or neither — `parseBranding` accepts them as a pair.
  const consentAvailable = policyUrl !== undefined && policyVersion !== undefined;

  const efnNeeded = !state.efnPresent || correcting;
  const efnValid = EFN_PATTERN.test(efn);

  /*
   * Read the stored EFN back so the screen can show *which* number will be
   * reported, rather than only that one exists (P54-02).
   *
   * Only when there is one to read: asking otherwise would spend a request on
   * a certain `null`. A failure here is deliberately silent — the physician's
   * task on this screen is to submit their completion, and a message about a
   * read that only decorated the page would be noise in front of it.
   */
  useEffect(() => {
    if (!state.efnPresent) {
      setStoredEfn(undefined);
      return;
    }

    let live = true;
    void client
      .getEfn()
      .then((result) => {
        if (live) setStoredEfn(result.efn ?? undefined);
      })
      .catch(() => undefined);

    return () => {
      live = false;
    };
  }, [client, state.efnPresent]);

  /*
   * What is still holding the *course* back, in the learner's words.
   *
   * The EFN is excluded because this form is where it is supplied — listing it
   * as a blocker would tell somebody they cannot submit the field they are
   * currently typing into.
   *
   * Declared here rather than beside its first use in the markup, because
   * `ready` below now depends on it and a `const` read before its declaration
   * is a ReferenceError, not a warning.
   */
  const blockers = state.outstanding.filter((condition) => condition !== "efn");

  const ready =
    givenName.trim() !== "" &&
    familyName.trim() !== "" &&
    (!efnNeeded || efnValid) &&
    (!consentAvailable || consented) &&
    /*
     * And the course itself has to be finished (P82-01).
     *
     * `blockers` was already computed and already rendered as a sentence — and
     * the button beside it was live anyway. Pressing it saved the EFN, asked
     * the API to complete the course, and got the 409 the API is right to
     * raise: *"Es fehlt noch: die vollständige Videowiedergabe, die
     * Lernerfolgskontrolle."* The learner had just been told exactly that, one
     * line higher, in orange.
     *
     * So the screen said the true thing and then offered the impossible one.
     * That is CLAUDE.md §9.2: a control that can only produce an error is
     * worse than an absent one, because it reads as a decision the person is
     * allowed to make.
     */
    blockers.length === 0;

  /*
   * A correction is sent on its own, before the completion.
   *
   * `completeCourse` carries an EFN only when none is stored — that is the
   * one-form-one-request rule at the top of this file, and it holds. Changing
   * a *stored* EFN is a different act with a different failure mode, so it
   * goes through `PUT /profile/efn` and reports its own outcome.
   */
  async function saveCorrection(): Promise<void> {
    setBusy(true);
    setProblem(undefined);
    try {
      await client.setEfn(efn);
      setStoredEfn(efn);
      setEfn("");
      setCorrecting(false);
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  }

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
        // Omitted entirely when empty rather than sent as "": the API treats an
        // absent field as "not supplied in this request", and an empty string
        // would be a value.
        ...(address.trim() === "" ? {} : { attestedAddress: address.trim() }),
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
    /*
     * P119-02. This used to be one sentence, and the sentence ended "Die Punkte
     * werden an die Ärztekammer gemeldet." — a promise about something that had
     * not happened yet, shown for ever, and never withdrawn when it failed.
     *
     * The claim about the *course* is still unconditional and still true. The
     * claim about the *Meldung* is now whatever the Meldung actually did.
     */
    return (
      <div className="space-y-3">
        <p
          className="rounded-md bg-green-50 p-4 text-sm text-status-completed"
          role="status"
        >
          {de.completion.done}
        </p>
        <PunktemeldungNotice
          client={client}
          state={state}
          onCorrected={props.onCompleted}
        />
      </div>
    );
  }

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

        <Field label={de.completion.addressLabel} htmlFor="ds-lms-address">
          <input
            id="ds-lms-address"
            value={address}
            maxLength={200}
            autoComplete="street-address"
            placeholder={de.completion.addressPlaceholder}
            aria-describedby="ds-lms-address-hint"
            onChange={(event) => setAddress(event.target.value)}
            className="w-full rounded-md border border-gray-300 px-3 py-2.5 text-sm"
          />
          {/*
            Said at the point somebody looks for it (CLAUDE.md §9.4): the field
            has no asterisk, and "why is this here and may I skip it" is the
            question a physician asks about a postal address on a form that
            otherwise only wants their EFN.
          */}
          <p id="ds-lms-address-hint" className="mt-1.5 text-xs text-gray-500">
            {de.completion.addressHint}
          </p>
        </Field>

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
          <div className="text-sm text-status-completed">
            <p>
              {storedEfn === undefined
                ? de.completion.efnSaved
                : de.completion.efnStored(storedEfn)}
            </p>
            <button
              type="button"
              onClick={() => {
                setCorrecting(true);
                setEfn(storedEfn ?? "");
              }}
              className="mt-1 text-xs text-gray-600 underline"
            >
              {de.completion.efnCorrect}
            </button>
          </div>
        )}

        {/*
          Where name and email come from (P105-01).

          On this screen rather than as a banner over the widget, because this is
          where those fields are *used*: the Teilnahmebescheinigung is about to
          be issued in that name. The EFN above is the one thing here a physician
          types themselves — everything else came from their MEDICE account, and
          saying so is what makes that difference visible.

          The client asked for it in those words: *"we should add a sign that
          your progress is synced with your medice account."* A transfer nobody
          is told about is one nobody can object to.
        */}
        <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
          <p className="text-sm font-semibold text-gray-900">{de.accountSync.title}</p>
          <p className="mt-1 text-xs text-gray-600">{de.accountSync.message}</p>
          <p className="mt-1 text-xs text-gray-600">{de.accountSync.change}</p>
        </div>

        {correcting ? (
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={saveCorrection}
              disabled={!efnValid || busy}
            >
              {de.completion.efnCorrectSave}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setCorrecting(false);
                setEfn("");
              }}
              disabled={busy}
            >
              {de.completion.efnCorrectCancel}
            </Button>
          </div>
        ) : null}

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
        <div className="text-sm text-status-inProgress" role="status">
          <p>
            {de.completion.outstanding}{" "}
            {blockers.map((condition) => de.completion.conditions[condition]).join(", ")}.
          </p>
          <p className="mt-1">{de.completion.outstandingHint}</p>
        </div>
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
