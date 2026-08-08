/**
 * Choosing your own password (P21-04).
 *
 * ## Why this screen has to exist, and why its absence was a security bug
 *
 * Every account an administrator creates carries `must_change`, correctly: a
 * password somebody else chose and read down a telephone is a password somebody
 * else knows. The API has reported that flag since P25-02 and the portal did
 * nothing with it — so in practice the administrator's password stayed valid
 * for ever, on an account that is a CME record.
 *
 * That was not "a screen we have not built yet". It was a control that looked
 * implemented from the API side and was inert from the only side that matters.
 *
 * ## It blocks, rather than nagging
 *
 * When `mustChangePassword` is set the shell renders this **instead of** the
 * catalogue. A dismissible banner would be the friendlier choice and would be
 * ignored, which is the same as not having it.
 *
 * The requirement is re-derived from `GET /auth/participant/me` on every page
 * load, so pressing F5 does not skip it — the session is valid, and only the
 * server's answer decides whether the catalogue may render.
 *
 * ## The confirmation field is client-side only
 *
 * The API never sees it. A mistyped new password locks somebody out of an
 * account whose old password they have just proven they know and are about to
 * lose, and the server cannot help with that — it has no way to tell a typo
 * from a choice.
 */

import { useState, type FormEvent } from "react";
import { de } from "../locale/de.js";

/**
 * Must equal `MIN_PASSWORD_LENGTH` in `packages/domain/src/staff-identity.ts`,
 * which is what the API actually enforces.
 *
 * Duplicated rather than imported because the portal does not depend on
 * `@ds/domain` — it is a host adapter, and pulling the compliance core into it
 * to read one integer would be the wrong dependency. This value only decides
 * when to show a hint; the refusal is always the server's, so the two drifting
 * costs a slightly early or late hint and never a weak password.
 */
const MIN_LENGTH = 12;

type Status = "idle" | "submitting" | "refused" | "weak" | "mismatch" | "unreachable";

export function ChangePassword(props: {
  apiBase: string;
  projectSlug: string;
  /** Re-check the session, which is what clears the requirement. */
  onChanged: () => void;
}) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [status, setStatus] = useState<Status>("idle");

  async function submit(event: FormEvent) {
    event.preventDefault();

    // Checked here because the API cannot: it has no second copy to compare
    // against, and a typo would set a password nobody knows.
    if (next !== confirm) {
      setStatus("mismatch");
      return;
    }
    if ([...next].length < MIN_LENGTH) {
      setStatus("weak");
      return;
    }

    setStatus("submitting");
    try {
      const response = await fetch(`${props.apiBase}/auth/participant/password`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-ds-project": props.projectSlug,
        },
        credentials: "include",
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });

      if (response.ok) {
        // Cleared before handing over. These are the two most sensitive values
        // this component will ever hold and there is no reason to keep them a
        // moment past the request.
        setCurrent("");
        setNext("");
        setConfirm("");
        setStatus("idle");
        props.onChanged();
        return;
      }

      // 422 is the server's own policy — it checks more than length, including
      // that the password does not contain the account's name or address, so
      // its refusal is not one this component could have predicted.
      setStatus(response.status === 422 ? "weak" : "refused");
    } catch {
      setStatus("unreachable");
    }
  }

  const message =
    status === "refused"
      ? de.password.wrongCurrent
      : status === "weak"
        ? de.password.tooWeak
        : status === "mismatch"
          ? de.password.mismatch
          : status === "unreachable"
            ? de.auth.unreachable
            : undefined;

  return (
    <form className="max-w-sm space-y-4 py-4" onSubmit={(e) => void submit(e)}>
      <h1 className="text-xl font-bold text-gray-900">{de.password.title}</h1>
      <p className="text-sm text-gray-700">{de.password.intro}</p>

      {message === undefined ? null : (
        <p
          role="alert"
          className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900"
        >
          {message}
        </p>
      )}

      {/*
        `htmlFor` + `id`, and the rule hint **outside** the label.

        A hint nested inside `<label>` becomes part of the field's accessible
        name, so a screen reader announces "Neues Passwort Mindestens 12
        Zeichen. Ihr Name und Ihre E-Mail-Adresse dürfen nicht enthalten sein"
        every time focus lands there. `aria-describedby` is the mechanism for a
        hint: read once, after the name, and skippable.
      */}
      <div className="space-y-1">
        <label
          htmlFor="current-password"
          className="block text-sm font-medium text-gray-900"
        >
          {de.password.current}
        </label>
        <input
          id="current-password"
          type="password"
          name="currentPassword"
          required
          autoComplete="current-password"
          className="ds-input w-full"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="new-password" className="block text-sm font-medium text-gray-900">
          {de.password.next}
        </label>
        <input
          id="new-password"
          type="password"
          name="newPassword"
          required
          // `new-password`, so a password manager offers to generate one rather
          // than autofilling the old.
          autoComplete="new-password"
          aria-describedby="new-password-rule"
          className="ds-input w-full"
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
        <p id="new-password-rule" className="text-xs text-gray-600">
          {de.password.rule(MIN_LENGTH)}
        </p>
      </div>

      <div className="space-y-1">
        <label
          htmlFor="confirm-password"
          className="block text-sm font-medium text-gray-900"
        >
          {de.password.confirm}
        </label>
        <input
          id="confirm-password"
          type="password"
          name="confirmPassword"
          required
          autoComplete="new-password"
          className="ds-input w-full"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </div>

      <button type="submit" className="ds-button" disabled={status === "submitting"}>
        {status === "submitting" ? de.password.saving : de.password.save}
      </button>
    </form>
  );
}
