/**
 * The physician's own EFN, after they have finished (P179-03).
 *
 * ## The gap this closes
 *
 * P54-02 made a stored EFN readable and correctable — on `CompletionScreen`,
 * which is the Punktemeldung form. Once the completion is recorded that screen
 * is no longer reachable: the widget sends the learner to this tab and keeps
 * them here. So from the moment the EFN starts to matter, the person it belongs
 * to could no longer see or change it.
 *
 * P54-02's own header says why that is the wrong way round:
 *
 *   > a physician who supplied an EFN months ago, on a different device, has no
 *   > way to see what the platform will report on their behalf — and no way to
 *   > notice a typo until the Kammer credits somebody else's account, which is
 *   > the failure ADR-0004 itself calls the worst available because it looks
 *   > like success.
 *
 * Everything in that paragraph is *more* true after completion, not less.
 *
 * ## Why it is here and not on a screen of its own
 *
 * The Zertifizierung tab is where a physician reads what will be reported about
 * them — the VNR, the points, the category, the certificate. Their EFN is the
 * other half of that sentence, and it belongs beside it rather than behind a
 * control they would have to know to look for (§9.8).
 *
 * ## What a correction reaches
 *
 * `PUT /profile/efn` writes the profile **and** carries the value onto every
 * un-sent Punktemeldung of theirs (P179-03) — the certificate has always read
 * the profile live. A Meldung the Ärztekammer has already accepted keeps the
 * number it was filed under, because re-filing under a new one credits a second
 * person rather than moving the first (S30). That case is not an error here:
 * the correction still lands, and the divergence is what an operator sees on
 * the participant list, since they are the party who can act on it.
 */

import { useEffect, useState } from "react";
import type { ApiClient } from "@ds/sdk";
import { de } from "../locale/de.js";
import { Button, ErrorNotice } from "./primitives.js";

const EFN_PATTERN = /^[0-9]{15}$/u;

export function EfnPanel(props: { client: ApiClient }) {
  const { client } = props;

  const [stored, setStored] = useState<string | null | undefined>();
  const [required, setRequired] = useState(false);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let live = true;
    client
      .getEfn()
      .then((result) => {
        if (!live) return;
        setStored(result.efn);
        setRequired(result.required);
      })
      .catch(() => {
        // Deliberately silent, as on the completion form: this panel is
        // informational, and a message about a failed read would sit in front
        // of the certificate the physician came here for.
        if (live) setStored(null);
      });
    return () => {
      live = false;
    };
  }, [client]);

  // Nothing to say on a course that reports nothing to anybody: asking a
  // physician to check an identifier we will never use would be collecting
  // attention for no purpose, the same argument ADR-0004 makes about the
  // number itself.
  if (!required) return null;
  if (stored === undefined) return null;

  async function save(): Promise<void> {
    setBusy(true);
    setProblem(undefined);
    try {
      await client.setEfn(value.trim());
      setStored(value.trim());
      setEditing(false);
      setValue("");
      setSaved(true);
    } catch (error) {
      /*
       * The server's sentence, when there is one. `setEfn` refuses a value
       * that is not fifteen digits with a message naming the rule and never
       * the value (ADR-0004), and that is more use than a generic failure —
       * the field is already pattern-checked here, so anything reaching this
       * branch is something the browser could not have known.
       */
      setProblem(error instanceof Error ? error.message : de.efnPanel.failed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 rounded-lg border border-gray-200 bg-gray-50 p-4">
      <h4 className="text-sm font-bold text-gray-900">{de.efnPanel.title}</h4>

      {stored === null ? (
        <p className="mt-1 text-sm text-gray-700">{de.efnPanel.none}</p>
      ) : (
        <p className="mt-1 text-sm text-gray-700">
          {de.efnPanel.stored}{" "}
          {/* The whole number, to its owner. Masking it here would defeat the
              purpose: the physician is the one person who has to be able to
              read every digit and compare it with their card (P54-02). */}
          <span className="font-mono tracking-wider text-gray-900">{stored}</span>
        </p>
      )}

      <p className="mt-1 text-xs text-gray-600">{de.efnPanel.reach}</p>

      {saved ? <p className="mt-2 text-sm text-green-700">{de.efnPanel.saved}</p> : null}
      {problem === undefined ? null : (
        <div className="mt-2">
          <ErrorNotice title={de.efnPanel.failed} message={problem} />
        </div>
      )}

      {editing ? (
        <div className="mt-3 space-y-2">
          <label className="block text-sm font-medium text-gray-900" htmlFor="efn-panel">
            {de.efnPanel.field}
          </label>
          <input
            id="efn-panel"
            type="text"
            inputMode="numeric"
            maxLength={15}
            // An EFN is the key a physician's CME points are credited against;
            // a browser storing it for autofill on an unrelated site is a
            // disclosure nobody asked for (P54-02).
            autoComplete="off"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            className="w-full max-w-xs rounded border border-gray-300 px-3 py-2 text-sm tracking-wider"
          />
          <p className="text-xs text-gray-600">{de.efnPanel.hint}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={busy || !EFN_PATTERN.test(value.trim())}
              onClick={() => void save()}
            >
              {busy ? de.efnPanel.saving : de.efnPanel.save}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setEditing(false);
                setValue("");
                setProblem(undefined);
              }}
            >
              {de.efnPanel.cancel}
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3">
          <Button
            variant="secondary"
            onClick={() => {
              setEditing(true);
              setSaved(false);
            }}
          >
            {stored === null ? de.efnPanel.add : de.efnPanel.correct}
          </Button>
        </div>
      )}
    </div>
  );
}
