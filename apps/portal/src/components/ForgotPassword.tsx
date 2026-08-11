/**
 * "Passwort vergessen", on the portal (P40-03).
 *
 * Two screens in one component, because they are one conversation: the address
 * form, and then a sentence. There is no third state where something went wrong
 * on the server's side, because the server deliberately does not say.
 *
 * ## Why the confirmation is worded the way it is
 *
 * The API answers 202 for an unknown address, for a project whose participants
 * sign in through a customer's Keycloak, and for a link that actually went out.
 * That is not politeness: asking whether a given physician has an account with
 * a named pharmaceutical company is close enough to health-adjacent
 * information about a named person that the form must not answer it.
 *
 * A screen that said "we have sent you an email" would give the answer back in
 * the last inch. So it says *wenn* — if there is an account for this address,
 * a link is on its way — which is true in every case.
 *
 * ## The one failure worth showing
 *
 * That the request did not leave: a network error, or the rate limiter. Telling
 * somebody to check an inbox nothing is coming to is worse than telling them to
 * try again in a minute.
 */

import { useState, type FormEvent } from "react";
import { de } from "../locale/de.js";

type Status = "idle" | "submitting" | "sent" | "throttled" | "unreachable";

export function ForgotPassword(props: {
  apiBase: string;
  /** The tenant, sent as `X-DS-Project` exactly as every other call does. */
  projectSlug: string;
  onCancel: () => void;
}) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setStatus("submitting");

    try {
      const response = await fetch(`${props.apiBase}/auth/participant/password-reset`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-ds-project": props.projectSlug,
        },
        body: JSON.stringify({ email }),
      });

      // 429 is the only status the server distinguishes, and only because it
      // has to — the limit is on the IP, so it says nothing about the address.
      setStatus(response.status === 429 ? "throttled" : "sent");
    } catch {
      setStatus("unreachable");
    }
  }

  if (status === "sent") {
    return (
      <div className="max-w-sm space-y-4 py-4">
        <h2 className="text-base font-semibold text-gray-900">{de.forgot.title}</h2>
        <p role="status" className="text-sm text-gray-700">
          {de.forgot.sent}
        </p>
        <button type="button" className="ds-button-secondary" onClick={props.onCancel}>
          {de.forgot.back}
        </button>
      </div>
    );
  }

  const message =
    status === "throttled"
      ? de.forgot.throttled
      : status === "unreachable"
        ? de.auth.unreachable
        : undefined;

  return (
    <form className="max-w-sm space-y-4 py-4" onSubmit={(e) => void submit(e)}>
      <h2 className="text-base font-semibold text-gray-900">{de.forgot.title}</h2>
      <p className="text-sm text-gray-700">{de.forgot.intro}</p>

      {message === undefined ? null : (
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

      <div className="flex gap-2">
        <button type="submit" className="ds-button" disabled={status === "submitting"}>
          {status === "submitting" ? de.forgot.sending : de.forgot.submit}
        </button>
        <button type="button" className="ds-button-secondary" onClick={props.onCancel}>
          {de.forgot.back}
        </button>
      </div>
    </form>
  );
}

/**
 * Setting the password, from the link in the mail.
 *
 * The token arrives in the URL **fragment**, never the query string: a query
 * string is sent to the server on every request for the page and lands in
 * access logs, proxy logs and the `Referer` of anything the page loads. A
 * fragment is never transmitted. It is cleared from the address bar the moment
 * it has been read.
 */
export function ResetPassword(props: {
  apiBase: string;
  projectSlug: string;
  token: string;
  onDone: () => void;
}) {
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "done">("idle");
  const [problem, setProblem] = useState<string | undefined>();

  async function submit(event: FormEvent) {
    event.preventDefault();

    // The one check the server cannot make: it receives one password and has no
    // idea what the second box said.
    if (password !== repeat) {
      setProblem(de.forgot.mismatch);
      return;
    }

    setStatus("submitting");
    setProblem(undefined);

    try {
      const response = await fetch(
        `${props.apiBase}/auth/participant/password-reset/confirm`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-ds-project": props.projectSlug,
          },
          body: JSON.stringify({ token: props.token, newPassword: password }),
        },
      );

      // Never held longer than the request needed it.
      setPassword("");
      setRepeat("");

      if (response.ok) {
        setStatus("done");
        return;
      }

      setStatus("idle");
      const body = (await response.json().catch(() => ({}))) as { detail?: string };
      // The API's own `detail` when it rejected the *password* — too short, or
      // containing the account's own name — because that is actionable and says
      // nothing about the link. Otherwise the one message that covers expired,
      // spent and never-existed alike.
      setProblem(body.detail ?? de.forgot.linkDead);
    } catch {
      setStatus("idle");
      setProblem(de.auth.unreachable);
    }
  }

  if (status === "done") {
    return (
      <div className="max-w-sm space-y-4 py-4">
        <h2 className="text-base font-semibold text-gray-900">{de.forgot.resetTitle}</h2>
        <p role="status" className="text-sm text-gray-700">
          {de.forgot.resetDone}
        </p>
        <button type="button" className="ds-button" onClick={props.onDone}>
          {de.auth.signIn}
        </button>
      </div>
    );
  }

  return (
    <form className="max-w-sm space-y-4 py-4" onSubmit={(e) => void submit(e)}>
      <h2 className="text-base font-semibold text-gray-900">{de.forgot.resetTitle}</h2>
      <p className="text-sm text-gray-700">{de.forgot.resetIntro}</p>

      {problem === undefined ? null : (
        <p
          role="alert"
          className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900"
        >
          {problem}
        </p>
      )}

      <label className="block space-y-1">
        <span className="text-sm font-medium text-gray-900">{de.forgot.newPassword}</span>
        <input
          type="password"
          name="new-password"
          required
          autoComplete="new-password"
          className="ds-input w-full"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>

      <label className="block space-y-1">
        <span className="text-sm font-medium text-gray-900">{de.forgot.repeat}</span>
        <input
          type="password"
          name="new-password-repeat"
          required
          autoComplete="new-password"
          className="ds-input w-full"
          value={repeat}
          onChange={(e) => setRepeat(e.target.value)}
        />
      </label>

      <button type="submit" className="ds-button" disabled={status === "submitting"}>
        {status === "submitting" ? de.forgot.sending : de.forgot.resetSubmit}
      </button>
    </form>
  );
}

/** The token in `#passwort-neu?token=…`, if this is that arrival. */
export function resetTokenFromHash(hash: string): string | undefined {
  const marker = "#passwort-neu?";
  if (!hash.startsWith(marker)) return undefined;
  const token = new URLSearchParams(hash.slice(marker.length)).get("token");
  return token === null || token === "" ? undefined : token;
}
