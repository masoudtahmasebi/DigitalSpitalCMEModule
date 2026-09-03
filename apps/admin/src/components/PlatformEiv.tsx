/**
 * Plattform → Punktemeldung (P180-01).
 *
 * ## What this screen replaces
 *
 * Three lines in `config.env` on a server, and a deploy to change any of them:
 *
 *   > i don't want to have eiv-worker enabled or disable in config.env i want
 *   > to be able to sweitch that from the admin panel, and i want to be able to
 *   > change the sending to domain […] having this eiv-worker when we have test
 *   > env does not make sense.
 *
 * They decided whether statutory Punktemeldungen leave this installation and
 * who receives them. Switching to EIV's test system to try something out was a
 * deploy; switching back was another. So nobody switched.
 *
 * ## Why the endpoint is a radio group and not a field
 *
 * The three choices are words the platform owns the addresses for. A text field
 * would put the address in the browser — and an address a person can type is an
 * address that can be the production register by accident, or somebody else's
 * host on purpose. The resolved address is shown, read-only, so an operator can
 * see exactly which domain they have chosen.
 *
 * ## The three things this screen has to say out loud
 *
 * 1. **Switching the worker on reports the backlog too.** The first sweep
 *    claims every row already queued, so a month of testing against the mock
 *    goes to the Ärztekammer in one batch. That sentence is on the screen
 *    beside the switch, not in a ticket.
 * 2. **A Punktemeldung cannot be unfiled.** Only withdrawn, and the withdrawal
 *    stays visible on the physician's own record. That is why the live choice
 *    has a confirmation at all.
 * 3. **Changing the target clears the confirmation.** Said before it happens,
 *    because an operator who confirms live, detours through the test system and
 *    comes back would otherwise be armed against production on a decision made
 *    before the detour.
 */

import { useCallback, useEffect, useState } from "react";
import { formatBerlinDateTime } from "@ds/domain";
import type { ApiClient, EivPlatformSettings } from "@ds/sdk";
import { de } from "../locale/de.js";
import { describeError, isForbidden } from "../api.js";
import { Button, LoadFailure, Notice, Spinner } from "./ui.js";

type Endpoint = EivPlatformSettings["endpoint"];

const ENDPOINTS: readonly Endpoint[] = ["mock", "test", "live"];

export function PlatformEiv(props: { client: ApiClient }) {
  const { client } = props;

  const [stored, setStored] = useState<EivPlatformSettings | undefined>();
  const [problem, setProblem] = useState<string | undefined>();
  const [forbidden, setForbidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  /** The form, seeded from the server and edited locally until Speichern. */
  const [workerEnabled, setWorkerEnabled] = useState(false);
  const [endpoint, setEndpoint] = useState<Endpoint>("mock");
  const [confirmLive, setConfirmLive] = useState(false);

  const load = useCallback(async () => {
    setProblem(undefined);
    try {
      const settings = await client.adminGetEivPlatformSettings();
      setStored(settings);
      setWorkerEnabled(settings.workerEnabled);
      setEndpoint(settings.endpoint);
      setConfirmLive(false);
    } catch (error) {
      if (isForbidden(error)) setForbidden(true);
      else setProblem(describeError(error, de.error.generic));
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  if (forbidden) {
    return (
      <Notice tone="warning" title={de.error.title}>
        {de.auth.forbidden}
      </Notice>
    );
  }

  if (problem !== undefined && stored === undefined) {
    return (
      <LoadFailure
        title={de.error.title}
        retryLabel={de.error.retry}
        problem={problem}
        onRetry={() => void load()}
      />
    );
  }

  if (stored === undefined) return <Spinner label={de.loading} />;

  /*
   * Whether the *chosen* target needs consent, not the stored one.
   *
   * `mock` and `test` never do; `live` always does. Derived from the choice on
   * screen so the confirmation appears the moment somebody selects live, rather
   * than after a save that would have been refused.
   */
  const needsConsent = endpoint === "live";
  const consentHeld = endpoint === stored.endpoint && stored.liveConfirmedAt !== null;
  const consentSatisfied = !needsConsent || confirmLive || consentHeld;

  // Only when it is being turned on: the sentence is about what the first sweep
  // will claim, and it is not news to somebody switching it off.
  const armingNow = workerEnabled && !stored.workerEnabled;

  async function save(): Promise<void> {
    setBusy(true);
    setProblem(undefined);
    setSaved(false);
    try {
      const next = await client.adminUpdateEivPlatformSettings({
        workerEnabled,
        endpoint,
        // Sent only when it was ticked in this session. Consent is a decision
        // taken now, never a preference the console remembers.
        ...(confirmLive ? { confirmLive: true as const } : {}),
      });
      setStored(next);
      setWorkerEnabled(next.workerEnabled);
      setEndpoint(next.endpoint);
      setConfirmLive(false);
      setSaved(true);
    } catch (error) {
      setProblem(describeError(error, de.error.generic));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <p className="text-sm text-gray-600">{de.platform.intro}</p>

      {problem === undefined ? null : <Notice tone="error">{problem}</Notice>}
      {saved ? <Notice tone="success">{de.platform.saved}</Notice> : null}

      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold text-gray-900">
          {de.platform.workerLegend}
        </legend>

        <label
          htmlFor="eiv-worker"
          className="flex items-center gap-2 text-sm text-gray-900"
        >
          <input
            id="eiv-worker"
            type="checkbox"
            checked={workerEnabled}
            onChange={(event) => setWorkerEnabled(event.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-brand-600"
          />
          {de.platform.workerLabel}
        </label>

        <p className="text-xs text-gray-600">
          {stored.workerEnabled ? de.platform.workerHintOn : de.platform.workerHintOff}
        </p>

        {armingNow ? (
          <Notice tone="warning">{de.platform.workerBacklogWarning}</Notice>
        ) : null}
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold text-gray-900">
          {de.platform.endpointLegend}
        </legend>
        <p className="text-xs text-gray-600">{de.platform.endpointHint}</p>

        {/*
          The hint is a sibling of the label, not inside it.
          
          Inside, it becomes part of the radio's accessible name, so a screen
          reader announces the whole paragraph before the next option — and the
          three options are exactly the thing somebody is comparing. It is tied
          to the input with `aria-describedby` instead, which is what that
          attribute is for.
        */}
        {ENDPOINTS.map((choice) => (
          <div
            key={choice}
            className="rounded-lg border border-gray-200 bg-white p-3 text-sm"
          >
            <label
              htmlFor={`eiv-endpoint-${choice}`}
              className="flex items-center gap-2 font-medium text-gray-900"
            >
              <input
                id={`eiv-endpoint-${choice}`}
                type="radio"
                name="eiv-endpoint"
                value={choice}
                checked={endpoint === choice}
                aria-describedby={`eiv-endpoint-${choice}-hint`}
                onChange={() => {
                  setEndpoint(choice);
                  // A change of target clears any consent already given, on the
                  // server and here — so the box cannot stay ticked from a
                  // decision that was about a different register.
                  setConfirmLive(false);
                }}
                className="h-4 w-4 border-gray-300 text-brand-600"
              />
              {de.platform.endpoints[choice]}
            </label>
            <p
              id={`eiv-endpoint-${choice}-hint`}
              className="mt-1 pl-6 text-xs text-gray-600"
            >
              {de.platform.endpointHints[choice]}
            </p>
          </div>
        ))}

        {endpoint === stored.endpoint ? (
          <p className="text-xs text-gray-500">
            {de.platform.endpointUrl}:{" "}
            <code className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-800">
              {stored.endpointUrl}
            </code>
          </p>
        ) : null}
      </fieldset>

      {needsConsent ? (
        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold text-gray-900">
            {de.platform.liveLegend}
          </legend>

          <Notice tone="error">{de.platform.liveWarning}</Notice>

          {consentHeld ? (
            <p className="text-xs text-gray-600">
              {de.platform.liveConfirmed(
                formatBerlinDateTime(new Date(stored.liveConfirmedAt ?? "")),
              )}
            </p>
          ) : (
            <label
              htmlFor="eiv-live-confirm"
              className="flex items-start gap-2 text-sm text-gray-900"
            >
              <input
                id="eiv-live-confirm"
                type="checkbox"
                checked={confirmLive}
                onChange={(event) => setConfirmLive(event.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-brand-600"
              />
              {de.platform.liveConfirm}
            </label>
          )}

          {workerEnabled && !consentSatisfied ? (
            <p className="text-xs font-medium text-amber-700">
              {de.platform.liveMissing}
            </p>
          ) : null}
        </fieldset>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          // Disabled rather than refused: the API refuses this combination too,
          // and letting somebody press a button whose only outcome is a 409
          // would be offering a decision the system cannot honour (§9.2).
          disabled={busy || (workerEnabled && !consentSatisfied)}
          onClick={() => void save()}
        >
          {busy ? de.platform.saving : de.platform.save}
        </Button>
        <p className="text-xs text-gray-500">
          {de.platform.updatedAt(formatBerlinDateTime(new Date(stored.updatedAt)))}
        </p>
      </div>
    </div>
  );
}
