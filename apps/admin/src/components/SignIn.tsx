/**
 * The staff sign-in screen (P12-06), implementing ADR-0012.
 *
 * Three states in one component, because they are one conversation: password,
 * then — if the account owes a second factor — either a QR code to scan or a
 * box for the six digits. Splitting them into routes would mean carrying the
 * challenge through the URL, and a challenge in a URL is a credential in
 * browser history.
 *
 * ## What this component is careful about
 *
 * - The password is never held after the request that used it. It lives in
 *   state until the form submits and is cleared on every outcome, including
 *   the successful ones, so it is not sitting in a React fibre while somebody
 *   fetches their phone.
 * - There is exactly one failure message for a wrong address and a wrong
 *   password. The API already refuses to distinguish them — showing "no such
 *   account" here would reintroduce the enumeration oracle the API avoids.
 * - The Base32 secret is shown beneath the QR code, so an operator whose
 *   camera will not cooperate is not stuck. Every authenticator app accepts
 *   manual entry, and `QrCode` deliberately fails quietly for the same reason.
 */

import { useState, type FormEvent } from "react";
import { de } from "../locale/de.js";
import { Button, Field, Notice, Spinner, TextInput } from "./ui.js";
import { QrCode } from "./QrCode.js";
import { beginEnrolment, signIn, submitCode, type StaffProfile } from "../staff-auth.js";

type Step =
  | { kind: "password" }
  | { kind: "code"; challenge: string }
  | { kind: "enrol"; challenge: string; otpauthUri: string };

export function SignIn(props: {
  apiBase: string;
  onSignedIn: (profile: StaffProfile) => void;
}) {
  const [step, setStep] = useState<Step>({ kind: "password" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();

  async function submitPassword(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setProblem(undefined);

    const result = await signIn(props.apiBase, email, password);
    // Cleared on every path, not only the failures: there is no reason for it
    // to still be here while the operator reaches for their phone.
    setPassword("");
    setBusy(false);

    switch (result.kind) {
      case "signed_in":
        props.onSignedIn(result.profile);
        return;

      case "code_required":
        setStep({ kind: "code", challenge: result.challenge });
        return;

      case "enrolment_required": {
        const uri = await beginEnrolment(props.apiBase, result.challenge);
        if (uri === undefined) {
          setProblem(de.auth.enrolFailed);
          setStep({ kind: "password" });
          return;
        }
        setStep({ kind: "enrol", challenge: result.challenge, otpauthUri: uri });
        return;
      }

      case "locked":
        setProblem(result.detail);
        return;

      default:
        setProblem(de.auth.invalid);
    }
  }

  async function submitTotp(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (step.kind === "password") return;

    setBusy(true);
    setProblem(undefined);
    const profile = await submitCode(props.apiBase, step.challenge, code);
    setCode("");
    setBusy(false);

    if (profile === undefined) {
      // The challenge is spent whatever the outcome, so a wrong code means
      // starting again rather than retrying against a live challenge — which
      // is what would turn a 30-second window into an unbounded one.
      setProblem(de.auth.codeInvalid);
      setStep({ kind: "password" });
      return;
    }
    props.onSignedIn(profile);
  }

  if (busy) return <Spinner label={de.auth.signingIn} />;

  return (
    <div className="mx-auto max-w-sm space-y-4">
      {problem === undefined ? null : (
        <Notice tone="error" title={de.error.title}>
          {problem}
        </Notice>
      )}

      {step.kind === "password" ? (
        <form className="space-y-4" onSubmit={submitPassword}>
          <Field label={de.auth.email} htmlFor="staff-email">
            <TextInput
              id="staff-email"
              type="email"
              value={email}
              autoComplete="username"
              onChange={setEmail}
            />
          </Field>
          <Field label={de.auth.password} htmlFor="staff-password">
            <TextInput
              id="staff-password"
              type="password"
              value={password}
              autoComplete="current-password"
              onChange={setPassword}
            />
          </Field>
          <Button type="submit">{de.auth.signIn}</Button>
        </form>
      ) : (
        <form className="space-y-4" onSubmit={submitTotp}>
          {step.kind === "enrol" ? (
            <div className="space-y-3">
              <h2 className="text-base font-semibold">{de.auth.enrolTitle}</h2>
              <p className="text-sm text-gray-700">{de.auth.enrolPrompt}</p>
              <QrCode value={step.otpauthUri} />
              <p className="text-xs text-gray-600">{de.auth.enrolManual}</p>
              {/* `break-all` because the secret is 32 unbroken characters and
                  would otherwise push the dialog wider than the viewport. */}
              <code className="block break-all text-xs">{secretOf(step.otpauthUri)}</code>
            </div>
          ) : (
            <p className="text-sm text-gray-700">{de.auth.codePrompt}</p>
          )}

          <Field label={de.auth.codeLabel} htmlFor="staff-code">
            <TextInput
              id="staff-code"
              value={code}
              // `one-time-code` is what lets iOS and Android offer the code
              // from the notification instead of making somebody retype it.
              autoComplete="one-time-code"
              inputMode="numeric"
              onChange={setCode}
            />
          </Field>
          <Button type="submit">{de.auth.codeSubmit}</Button>
        </form>
      )}
    </div>
  );
}

/** The Base32 secret, for somebody whose camera will not cooperate. */
function secretOf(otpauthUri: string): string {
  try {
    return new URL(otpauthUri).searchParams.get("secret") ?? "";
  } catch {
    return "";
  }
}
