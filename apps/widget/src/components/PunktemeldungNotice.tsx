/**
 * What became of the physician's Punktemeldung (P119-02).
 *
 * ## The failure
 *
 * The completion screen used to end with one sentence, shown for ever: *"Ihre
 * Fortbildung ist abgeschlossen. Die Punkte werden an die Ärztekammer
 * gemeldet."* Future tense, unconditional, and never withdrawn when the
 * reporting failed. A physician read it, kept a certificate saying four CME
 * points, and had none — and would not find out until their next
 * Fortbildungsnachweis, with the correction window years closed.
 *
 * ADR-0004 calls that the worst available failure **because it looks like
 * success**, and `eiv.service.ts` says the queue exists to prevent exactly it.
 * The queue did its part and told nobody.
 *
 * ## The one branch that asks for something
 *
 * `check_efn` — EIV answered 422, the EFN was refused, and the physician is the
 * only person who can correct it. Support cannot set another person's EFN and
 * must not be able to (ADR-0004), so the field belongs here or nowhere.
 *
 * Every other failure is the operator's. A physician told "the VNR is blocked"
 * learns only that something is wrong with a system they do not control, so
 * they get the true and usable half instead — not yet reported, being dealt
 * with (§9.10: when a refusal is correct and unhelpful, do not weaken it; give
 * the answer to somebody who can use it).
 *
 * ## The EFN is written, never read back
 *
 * The field starts empty on purpose. `GET /profile/efn` exists (P54-02) and is
 * not called here: the physician is being asked to *check* a number, and
 * pre-filling the one that was just refused invites them to confirm the typo.
 * Nothing echoes the rejected value either — §9.5, and it would be the same
 * mistake in a different place.
 */

import { useState } from "react";
import type { ApiClient, EnrolmentState } from "@ds/sdk";
import { de } from "../locale/de.js";

/** Exactly the domain's rule, and never re-derived from `punktemeldung`. */
type Kind = EnrolmentState["punktemeldung"];

const EFN_PATTERN = /^\d{15}$/u;

export function PunktemeldungNotice(props: {
  client: ApiClient;
  state: EnrolmentState;
  /** Refetches the enrolment state, so a corrected EFN changes what is shown. */
  onCorrected: () => void;
}) {
  const kind: Kind = props.state.punktemeldung;
  const copy = de.completion.punktemeldung;

  const [efn, setEfn] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();

  if (kind === "none") return null;

  const body =
    kind === "pending"
      ? copy.pending.body
      : kind === "reported"
        ? copy.reported.body
        : kind === "withdrawn"
          ? copy.withdrawn.body
          : kind === "check_efn"
            ? copy.checkEfn.body
            : kind === "window_closed"
              ? copy.windowClosed.body
              : copy.handled.body;

  const tone =
    kind === "reported"
      ? "bg-green-50 text-status-completed"
      : kind === "pending"
        ? "bg-gray-50 text-gray-800"
        : "bg-amber-50 text-amber-900";

  async function save(): Promise<void> {
    if (!EFN_PATTERN.test(efn)) {
      setProblem(copy.checkEfn.invalid);
      return;
    }
    setBusy(true);
    setProblem(undefined);
    try {
      await props.client.setEfn(efn);
      // Cleared the moment it leaves, as everywhere else this component's
      // sibling handles one.
      setEfn("");
      setSaved(true);
      props.onCorrected();
    } catch {
      setProblem(copy.checkEfn.invalid);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={`rounded-md p-4 text-sm ${tone}`} aria-live="polite">
      <h3 className="font-semibold">{copy.heading}</h3>
      <p className="mt-1 leading-relaxed">{body}</p>

      {kind === "check_efn" && !saved ? (
        <div className="mt-3 space-y-2">
          <label className="block font-medium" htmlFor="ds-efn-correction">
            {copy.checkEfn.label}
          </label>
          <input
            id="ds-efn-correction"
            className="w-full max-w-xs rounded border border-gray-300 px-2 py-1"
            inputMode="numeric"
            autoComplete="off"
            value={efn}
            onChange={(event) => setEfn(event.target.value.trim())}
          />
          <p className="text-xs text-gray-700">{copy.checkEfn.hint}</p>
          {problem === undefined ? null : (
            <p className="text-xs font-medium text-red-700" role="alert">
              {problem}
            </p>
          )}
          <button
            type="button"
            className="rounded bg-gray-900 px-3 py-1 font-medium text-white disabled:opacity-50"
            disabled={busy}
            onClick={() => void save()}
          >
            {copy.checkEfn.save}
          </button>
        </div>
      ) : null}

      {saved ? (
        <p className="mt-2 font-medium" role="status">
          {copy.checkEfn.saved}
        </p>
      ) : null}
    </section>
  );
}
