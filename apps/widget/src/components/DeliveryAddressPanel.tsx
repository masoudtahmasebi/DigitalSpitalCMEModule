/**
 * Where this physician's Teilnahmebescheinigung is sent (P183-03).
 *
 * ## The gap this closes
 *
 * The client, looking at a participant row reading `unzustellbar`:
 *
 *   > No e-mail address is on file for this person. Resending cannot succeed —
 *   > download the certificate and send it another way.
 *
 * That sentence is true. `delivery.repository.ts` reads the recipient live and
 * abandons `no_recipient` rather than posting a certificate to nobody, and
 * MEDICE's realm sends no `email` claim — `auth.guard.ts` has said so since
 * P105-01. What was missing is that **nobody could supply one**: not an
 * operator, and not the person whose certificate it is.
 *
 * ## Why beside the EFN
 *
 * For the reason `EfnPanel` gives about itself. This tab is where a physician
 * reads what will be reported about them and where their certificate is; the
 * address it goes to belongs in the same place, not behind a control they would
 * have to know to look for (§9.8).
 *
 * ## What it does not change
 *
 * Their sign-in. For a portal account `users.email` is also the credential —
 * `createPerson` writes the address into `user_identities.subject` — so this
 * sets a **delivery** address on the enrolment instead, and migration 0052
 * carries the whole argument. Somebody who wants their certificate at the
 * practice address has not asked to sign in as the practice.
 *
 * ## Why both addresses are shown
 *
 * A field that renders an empty box while an address exists invites somebody to
 * retype what is already right, and the retyping is where the typo comes from.
 * Both addresses are the caller's own, so showing them discloses nothing they
 * cannot read in their own inbox — which is exactly what makes this different
 * from the EFN, where ADR-0004 governs.
 */

import { useEffect, useState } from "react";
import type { ApiClient } from "@ds/sdk";
import { de } from "../locale/de.js";
import { Button, ErrorNotice } from "./primitives.js";

export function DeliveryAddressPanel(props: { client: ApiClient; courseSlug: string }) {
  const { client, courseSlug } = props;

  /*
   * `undefined` until the read lands. An empty box that means "still loading"
   * and one that means "no address is set" must not look the same — §9.6's
   * shape in a component, and here it decides whether somebody types over an
   * address they already have.
   */
  const [state, setState] = useState<
    { email: string | null; accountEmail: string | null } | undefined
  >();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let live = true;
    client
      .deliveryEmail(courseSlug)
      .then((result) => {
        if (!live) return;
        setState(result);
        setValue(result.email ?? "");
      })
      .catch(() => {
        // The tab still shows the certificate and the EFN. A panel that could
        // not read its own value says nothing rather than asserting "none".
        if (live) setState(undefined);
      });
    return () => {
      live = false;
    };
  }, [client, courseSlug]);

  async function save(next: string): Promise<void> {
    setBusy(true);
    setProblem(undefined);
    setSaved(false);
    try {
      const result = await client.setDeliveryEmail(courseSlug, next);
      setState((previous) => ({
        email: result.email,
        accountEmail: previous?.accountEmail ?? null,
      }));
      setValue(result.email ?? "");
      setEditing(false);
      setSaved(true);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : de.addressPanel.failed);
    } finally {
      setBusy(false);
    }
  }

  if (state === undefined) return null;

  const effective = state.email ?? state.accountEmail;

  return (
    <div className="mt-6 rounded-lg border border-gray-200 bg-gray-50 p-4">
      <h4 className="text-sm font-bold text-gray-900">{de.addressPanel.title}</h4>

      {effective === null ? (
        // The case the client reported, said to the one person who can fix it.
        <p className="mt-1 text-sm text-gray-700">{de.addressPanel.none}</p>
      ) : (
        <p className="mt-1 text-sm text-gray-700">
          {de.addressPanel.sentTo}{" "}
          <span className="font-medium text-gray-900">{effective}</span>
          {state.email === null ? null : ` ${de.addressPanel.overridden}`}
        </p>
      )}

      <p className="mt-1 text-xs text-gray-600">{de.addressPanel.reach}</p>

      {saved ? (
        <p className="mt-2 text-sm text-green-700">{de.addressPanel.saved}</p>
      ) : null}
      {problem === undefined ? null : (
        <div className="mt-2">
          <ErrorNotice title={de.addressPanel.failed} message={problem} />
        </div>
      )}

      {editing ? (
        <div className="mt-3 space-y-2">
          <label
            className="block text-sm font-medium text-gray-900"
            htmlFor="delivery-address-panel"
          >
            {de.addressPanel.field}
          </label>
          <input
            id="delivery-address-panel"
            type="email"
            inputMode="email"
            autoComplete="email"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            value={value}
            disabled={busy}
            aria-describedby="delivery-address-panel-hint"
            onChange={(event) => setValue(event.target.value)}
          />
          <p id="delivery-address-panel-hint" className="text-xs text-gray-600">
            {de.addressPanel.hint}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => void save(value)}>
              {de.addressPanel.save}
            </Button>
            {state.email === null ? null : (
              <Button variant="secondary" disabled={busy} onClick={() => void save("")}>
                {de.addressPanel.reset}
              </Button>
            )}
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setEditing(false);
                setValue(state.email ?? "");
                setProblem(undefined);
              }}
            >
              {de.addressPanel.cancel}
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3">
          <Button variant="secondary" onClick={() => setEditing(true)}>
            {effective === null ? de.addressPanel.add : de.addressPanel.change}
          </Button>
        </div>
      )}
    </div>
  );
}
