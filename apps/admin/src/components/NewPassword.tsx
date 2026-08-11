/**
 * Setting a password from a link (P40-02).
 *
 * One screen for two arrivals — an invitation and a password reset — because
 * they are the same act. The token's `kind` decides its lifetime server-side
 * (seven days against sixty minutes), and this screen does not need to know
 * which one it is holding: it posts the token and a password to the same
 * endpoint either way.
 *
 * ## Why the token comes out of the fragment
 *
 * `#passwort-neu?token=…` and not `?token=…`. A query string is sent to the
 * server on every request for the page and lands in access logs, proxy logs and
 * `Referer` headers on any resource the page loads. A fragment is never
 * transmitted. The token is a live bypass of the password on an existing
 * account, so where it is written down matters.
 *
 * It is also cleared from the address bar as soon as it has been read, so a
 * reload, a bookmark or somebody glancing at the screen does not carry it.
 *
 * ## Why the failure message says nothing about which failure
 *
 * The API answers identically for a link that expired, one already spent and
 * one that never existed — see P39-01, which is the ticket about that check not
 * having existed at all. A screen that distinguished them would confirm to
 * whoever holds a forwarded link that it was once real.
 */

import { useState, type FormEvent } from "react";
import { de } from "../locale/de.js";
import { Button, Field, Notice, Spinner, TextInput } from "./ui.js";
import { redeemCredentialToken } from "../staff-auth.js";

/**
 * The token in `#passwort-neu?token=…`, if this is that screen.
 *
 * Returns `undefined` for every other hash, so the console's ordinary sign-in
 * is what an operator sees at the bare URL.
 */
export function tokenFromHash(hash: string): string | undefined {
  const marker = "#passwort-neu?";
  if (!hash.startsWith(marker)) return undefined;
  const token = new URLSearchParams(hash.slice(marker.length)).get("token");
  return token === null || token === "" ? undefined : token;
}

/** Take it out of the address bar, without adding a history entry. */
export function forgetHash(): void {
  if (typeof window === "undefined") return;
  window.history.replaceState(
    null,
    "",
    window.location.pathname + window.location.search,
  );
}

export function NewPassword(props: {
  apiBase: string;
  token: string;
  /** Back to the sign-in form, once there is something to sign in with. */
  onDone: () => void;
}) {
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();
  const [done, setDone] = useState(false);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();

    // Checked here rather than server-side, because it is the one failure the
    // server cannot see: it receives one password and has no idea what the
    // second box said.
    if (password !== repeat) {
      setProblem(de.auth.newPasswordMismatch);
      return;
    }

    setBusy(true);
    setProblem(undefined);
    const result = await redeemCredentialToken(props.apiBase, props.token, password);

    // Cleared on every outcome, success included: a password sitting in a React
    // fibre after it has been used is a password in a heap dump.
    setPassword("");
    setRepeat("");
    setBusy(false);

    if (result.ok) {
      setDone(true);
      return;
    }

    /*
     * Two cases, and only one of them is about the link.
     *
     * The API refuses a password that is too short or contains the account's
     * own name with a `detail` worth showing — that is actionable and says
     * nothing about the token. Everything else is "this link is no longer
     * valid", which is deliberately one message for three causes.
     */
    setProblem(result.detail ?? de.auth.newPasswordLinkDead);
  }

  if (busy) return <Spinner label={de.common.saving} />;

  if (done) {
    return (
      <div className="mx-auto max-w-sm space-y-4">
        <Notice tone="info" title={de.auth.newPasswordTitle}>
          {de.auth.newPasswordDone}
        </Notice>
        <Button onClick={props.onDone}>{de.auth.backToSignIn}</Button>
      </div>
    );
  }

  return (
    <form className="mx-auto max-w-sm space-y-4" onSubmit={submit}>
      <h2 className="text-base font-semibold">{de.auth.newPasswordTitle}</h2>
      <p className="text-sm text-gray-700">{de.auth.newPasswordPrompt}</p>

      {problem === undefined ? null : (
        <Notice tone="error" title={de.error.title}>
          {problem}
        </Notice>
      )}

      <Field label={de.auth.newPassword} htmlFor="new-password">
        <TextInput
          id="new-password"
          type="password"
          value={password}
          autoComplete="new-password"
          onChange={setPassword}
        />
      </Field>
      <Field label={de.auth.newPasswordRepeat} htmlFor="new-password-repeat">
        <TextInput
          id="new-password-repeat"
          type="password"
          value={repeat}
          autoComplete="new-password"
          onChange={setRepeat}
        />
      </Field>

      <div className="flex gap-2">
        <Button type="submit" disabled={password === "" || repeat === ""}>
          {de.auth.newPasswordSubmit}
        </Button>
        <Button variant="secondary" onClick={props.onDone}>
          {de.common.cancel}
        </Button>
      </div>
    </form>
  );
}
