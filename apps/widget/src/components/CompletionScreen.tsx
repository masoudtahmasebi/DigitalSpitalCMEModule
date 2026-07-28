/**
 * Abschluss: the EFN, the attested name, and the Punktemeldung (P1-06, P7).
 *
 * ## The EFN
 *
 * Fifteen digits, checked here only so the learner sees a mistake immediately.
 * The real validation is `isValidEfn` in `@ds/domain`, server-side; this is a
 * courtesy, not a gate.
 *
 * The field is `inputMode="numeric"` and `autoComplete="off"`. The second
 * matters: an EFN is the key a physician's CME points are credited against,
 * and letting a browser store and later autofill it on an unrelated site is a
 * disclosure nobody asked for. It is also never read back — the API has no
 * endpoint that returns it (ADR-0004), so once submitted this screen shows
 * only that one is on file.
 *
 * ## The name
 *
 * Pre-filled by nothing, because the widget does not hold a profile — the
 * token's name lives server-side and is used when this is left blank. What the
 * learner types here is what prints on the Teilnahmebescheinigung, which is
 * why it is offered at all: the Keycloak profile may be stale or carry no name
 * (docs/requirements/medice-adhs.md §6.5).
 */

import { useState } from "react";
import type { ApiClient, EnrolmentState } from "@ds/sdk";
import { de } from "../locale/de.js";
import { describeError } from "../hooks.js";
import { Button, ErrorNotice } from "./primitives.js";

const EFN_PATTERN = /^[0-9]{15}$/;

export function CompletionScreen(props: {
  client: ApiClient;
  courseSlug: string;
  state: EnrolmentState;
  onCompleted: () => void;
}) {
  const [efn, setEfn] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();

  const { client, courseSlug, state } = props;
  const efnValid = EFN_PATTERN.test(efn);

  function report(error: unknown): void {
    setProblem(
      describeError(error instanceof Error ? error : undefined, {
        unauthenticated: de.error.unauthenticated,
        generic: de.error.generic,
        noCourse: de.error.noCourse,
      }),
    );
  }

  async function saveEfn(): Promise<void> {
    setBusy(true);
    setProblem(undefined);
    try {
      await client.setEfn(efn);
      // Clear it from component state the moment it is stored. Nothing is
      // gained by keeping a physician's EFN in memory afterwards.
      setEfn("");
      props.onCompleted();
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  }

  async function complete(): Promise<void> {
    setBusy(true);
    setProblem(undefined);
    try {
      const trimmed = name.trim();
      await client.completeCourse(
        courseSlug,
        trimmed === "" ? {} : { attestedName: trimmed },
      );
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
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">{de.completion.title}</h2>
        <p className="mt-1 text-sm text-gray-600">{de.completion.intro}</p>
      </div>

      {state.efnPresent ? (
        <p className="text-sm text-status-completed">{de.completion.efnSaved}</p>
      ) : (
        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-900" htmlFor="ds-lms-efn">
            {de.completion.efnLabel}
          </label>
          <input
            id="ds-lms-efn"
            value={efn}
            inputMode="numeric"
            autoComplete="off"
            maxLength={15}
            onChange={(event) => setEfn(event.target.value.replace(/\D/g, ""))}
            className="w-full max-w-xs rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
          <p className="text-xs text-gray-500">{de.completion.efnHint}</p>
          {efn !== "" && !efnValid ? (
            <p className="text-xs text-red-700">{de.completion.efnInvalid}</p>
          ) : null}
          <Button disabled={!efnValid || busy} onClick={() => void saveEfn()}>
            {de.completion.saveEfn}
          </Button>
        </div>
      )}

      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-900" htmlFor="ds-lms-name">
          {de.completion.nameLabel}
        </label>
        <input
          id="ds-lms-name"
          value={name}
          maxLength={200}
          placeholder={de.completion.namePlaceholder}
          onChange={(event) => setName(event.target.value)}
          className="w-full max-w-md rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
        <p className="text-xs text-gray-500">{de.completion.nameHint}</p>
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

      <Button disabled={!state.complete || busy} onClick={() => void complete()}>
        {busy ? de.completion.submitting : de.completion.submit}
      </Button>
    </div>
  );
}
