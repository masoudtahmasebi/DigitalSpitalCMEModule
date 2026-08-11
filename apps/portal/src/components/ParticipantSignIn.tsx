/**
 * The portal's own sign-in form (P25-02).
 *
 * ## Why the portal needs one at all
 *
 * `fortbildung.digitalspital.com/medice` was an empty page, and it could not
 * have been anything else: every learner route is behind the guard, the only
 * credential the guard accepted was a token from a customer's Keycloak realm,
 * and the portal had no way to obtain one for a customer that does not run a
 * realm. This is the missing half — a customer whose `identity_provider` is
 * `local` signs its participants in here, with an e-mail and a password.
 *
 * It does **not** replace the Keycloak path. A project bound to a customer's
 * realm still shows the link to that customer's own login (`kind: "external"`),
 * which is how MEDICE's physicians reach the WordPress-embedded widget. Which
 * of the two a tenant gets is the tenant's configuration, read from
 * `GET /tenants/{slug}` — never a guess made here.
 *
 * ## What this component deliberately does not do
 *
 * **It never sees the session token.** The API sets an httpOnly cookie, which
 * script cannot read; this component only learns whether the call succeeded.
 * That is the entire reason the session is a cookie rather than a value in
 * `localStorage`: an XSS bug on this page cannot exfiltrate what it cannot
 * read.
 *
 * **It does not distinguish failures.** Wrong address, wrong password and
 * locked account are one message, because the API answers all three
 * identically — telling them apart client-side would rebuild the enumeration
 * oracle the API is careful not to offer. A 429 is the one exception, and only
 * because "wait a moment" is advice rather than information about an account.
 *
 * **No "remember me", no password reset.** Both need decisions nobody has made
 * yet (P21-04), and a reset flow that mails a link is a credential-delivery
 * channel — not something to add in passing on a platform where an account is
 * a CME record.
 */

import { useState, type FormEvent } from "react";
import { de } from "../locale/de.js";

type Status = "idle" | "submitting" | "refused" | "throttled" | "unreachable";

export function ParticipantSignIn(props: {
  apiBase: string;
  /** The tenant, sent as `X-DS-Project` exactly as every other call does. */
  projectSlug: string;
  customerName: string;
  /** Called after the cookie is set, so the shell can re-check the session. */
  onSignedIn: () => void;
  /** Switches the shell to the "Passwort vergessen" form (P40-03). */
  onForgotPassword: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<Status>("idle");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setStatus("submitting");

    try {
      const response = await fetch(`${props.apiBase}/auth/participant/sign-in`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-ds-project": props.projectSlug,
        },
        // Without this the browser discards the `Set-Cookie` the response
        // carries, and the sign-in appears to succeed while leaving the caller
        // with no session at all.
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });

      if (response.ok) {
        // The password is not kept in component state a moment longer than the
        // request needs it. It cannot be read out of React state by script that
        // is not already running in this page, but there is no reason to hold
        // it either.
        setPassword("");
        // Back to `idle` before handing over. The parent re-asks the API and
        // unmounts this form on success — but if that check says "not signed
        // in" (a cookie the browser refused, a clock skew), leaving the button
        // reading "Anmeldung läuft …" for ever is the worst of both: nothing
        // happened and nothing can be tried again.
        setStatus("idle");
        props.onSignedIn();
        return;
      }

      setStatus(response.status === 429 ? "throttled" : "refused");
    } catch {
      // A network failure, a CORS refusal, an API that is down. Distinct from
      // "refused" because the advice differs: one is "check your password", the
      // other is "this is not your fault".
      setStatus("unreachable");
    }
  }

  const message =
    status === "refused"
      ? de.auth.refused
      : status === "throttled"
        ? de.auth.tooManyAttempts
        : status === "unreachable"
          ? de.auth.unreachable
          : undefined;

  return (
    <form className="max-w-sm space-y-4 py-4" onSubmit={(e) => void submit(e)}>
      <p className="text-sm text-gray-700">{de.auth.intro}</p>

      {message === undefined ? null : (
        // `role="alert"` so a screen reader announces the refusal rather than
        // leaving somebody wondering why the form did nothing (P19 a11y floor).
        <p
          role="alert"
          className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900"
        >
          {message}
        </p>
      )}

      <label className="block space-y-1">
        <span className="text-sm font-medium text-gray-900">{de.auth.email}</span>
        <input
          type="email"
          name="email"
          required
          autoComplete="username"
          className="ds-input w-full"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>

      <label className="block space-y-1">
        <span className="text-sm font-medium text-gray-900">{de.auth.password}</span>
        <input
          type="password"
          name="password"
          required
          // The standard tokens, so a password manager offers to fill and to
          // save. A form it cannot recognise is a form people type weak
          // passwords into.
          autoComplete="current-password"
          className="ds-input w-full"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>

      <button type="submit" className="ds-button" disabled={status === "submitting"}>
        {status === "submitting" ? de.auth.signingIn : de.auth.signIn}
      </button>

      {/*
        The escape hatch, after the thing it is an escape from, and
        `type="button"` — a bare <button> in a <form> submits it, which would
        attempt a sign-in with an empty password every time somebody forgot
        theirs.
      */}
      <button
        type="button"
        className="block text-sm text-brand-700 underline underline-offset-2"
        onClick={props.onForgotPassword}
      >
        {de.forgot.link}
      </button>

      <p className="text-xs text-gray-600">
        {de.auth.noAccount} {props.customerName}.
      </p>
    </form>
  );
}
