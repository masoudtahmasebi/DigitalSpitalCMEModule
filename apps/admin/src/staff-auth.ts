/**
 * Staff sign-in for the admin console (P12-06), implementing ADR-0012.
 *
 * Replaces the Keycloak OIDC flow. The console is DigitalSpital's own tool and
 * its operators are DigitalSpital's own people; authenticating them against a
 * customer's realm meant that customer's realm administrators could mint
 * platform super administrators, and that one missing audience mapper in one
 * customer's client (S17) took the console down along with every learner.
 *
 * ## What the browser holds, and what it does not
 *
 * It does not hold the session. That is an httpOnly cookie the API sets, which
 * no script on this origin can read — including this one, and including
 * anything injected into it. There is no access token in memory here, no
 * refresh token in `localStorage`, and nothing for an XSS to steal and replay
 * from somewhere else.
 *
 * What it does hold is the CSRF token, deliberately, in memory only. The
 * double-submit check needs a value the page can read and a cross-origin
 * attacker cannot; putting it in `sessionStorage` would survive a tab close
 * for no benefit, so it lives in a module variable and dies with the tab. On
 * reload the console asks `/admin/auth/session`, which re-issues it.
 *
 * ## Why the second factor is two calls and not one form
 *
 * `login` returns a *challenge* rather than a session when the account owes a
 * second factor. The challenge authenticates nothing: it is not a session
 * cookie and the API refuses it as one (migration 0022). It exists so the
 * password does not have to be held in the page while the operator reaches for
 * their phone.
 */

const CSRF_HEADER = "x-ds-csrf";

export interface StaffProfile {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: string;
  /** Whether this operator has a second factor set up (P22-02). */
  readonly secondFactorEnrolled: boolean;
  readonly capabilities: readonly string[];
  /**
   * The grants this operator holds. The console reads the customer id off the
   * first one when inviting somebody — a new account is scoped to the customer
   * the inviter is acting within, and the API refuses anything wider anyway.
   */
  readonly grants: readonly {
    readonly role: string;
    readonly customerId: string | null;
    readonly departmentId: string | null;
  }[];
}

export type SignInResult =
  | { readonly kind: "signed_in"; readonly profile: StaffProfile }
  /** The account has an authenticator already; ask for a code. */
  | { readonly kind: "code_required"; readonly challenge: string }
  /** First sign-in: show the QR code, then ask for a code. */
  | { readonly kind: "enrolment_required"; readonly challenge: string }
  | { readonly kind: "locked"; readonly detail: string }
  | { readonly kind: "rejected" };

/**
 * The CSRF token for this tab.
 *
 * Module-scoped rather than React state because the API client is built once,
 * outside the component tree, and has to read the current value on every
 * request — a client capturing the token at construction would send the first
 * one forever, and every write after a re-login would 403.
 */
/**
 * The CSRF token this tab sends with every unsafe request.
 *
 * Held in memory *and* readable from a cookie, and the cookie is the half that
 * matters (P22-04). This used to be memory only, set by `login` and `verify`
 * and by nothing else — so a page reload, a second tab, or a restored browser
 * session left the console able to read everything and write nothing: every
 * POST, PUT and DELETE came back `403 missing or invalid CSRF token`, which
 * reads as a permissions problem and was a forgotten token.
 *
 * The memory copy is kept because it is authoritative for the tab that just
 * signed in, and because reading a cookie on every request is needless work.
 */
let csrfToken: string | undefined;

export const CSRF_COOKIE = "ds_staff_csrf";

export function currentCsrfToken(): string | undefined {
  return csrfToken ?? readCsrfCookie();
}

/**
 * Read the token the API set alongside the session cookie.
 *
 * Deliberately not httpOnly — this is the double-submit pattern, and the page
 * has to be able to send what it reads. The protection comes from a foreign
 * origin being unable to read it, not from the page being unable to.
 */
function readCsrfCookie(): string | undefined {
  if (typeof document === "undefined") return undefined;
  for (const part of document.cookie.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === CSRF_COOKIE) {
      const value = rest.join("=");
      return value === "" ? undefined : decodeURIComponent(value);
    }
  }
  return undefined;
}

export async function signIn(
  apiBase: string,
  email: string,
  password: string,
): Promise<SignInResult> {
  const response = await post(apiBase, "/admin/auth/login", { email, password });
  const body = (await response.json().catch(() => ({}))) as {
    status?: string;
    csrfToken?: string;
    challenge?: string;
    profile?: StaffProfile;
    detail?: string;
  };

  if (response.ok && body.status === "signed_in" && body.profile !== undefined) {
    csrfToken = body.csrfToken;
    return { kind: "signed_in", profile: body.profile };
  }

  if (response.ok && body.challenge !== undefined) {
    return body.status === "totp_enrolment_required"
      ? { kind: "enrolment_required", challenge: body.challenge }
      : { kind: "code_required", challenge: body.challenge };
  }

  // A lockout is the one failure told plainly. Concealing it leaves somebody
  // retrying a correct password with no idea why it keeps failing.
  if (response.status === 401 && body.detail !== undefined) {
    return { kind: "locked", detail: body.detail };
  }

  return { kind: "rejected" };
}

/** Ask for the secret to show as a QR code. Returned exactly once, ever. */
export async function beginEnrolment(
  apiBase: string,
  challenge: string,
): Promise<string | undefined> {
  const response = await post(apiBase, "/admin/auth/totp/enrol", { challenge });
  if (!response.ok) return undefined;
  const body = (await response.json()) as { otpauthUri?: string };
  return body.otpauthUri;
}

export async function submitCode(
  apiBase: string,
  challenge: string,
  code: string,
): Promise<StaffProfile | undefined> {
  const response = await post(apiBase, "/admin/auth/totp/verify", { challenge, code });
  if (!response.ok) return undefined;

  const body = (await response.json()) as {
    csrfToken?: string;
    profile?: StaffProfile;
  };
  csrfToken = body.csrfToken;
  return body.profile;
}

/**
 * Who is signed in, according to the API.
 *
 * Called on load. The console cannot tell from the cookie — it cannot read it
 * — so this is the only way to distinguish "signed in" from "not", and asking
 * the server is the honest version of that question anyway.
 */
export async function currentStaff(apiBase: string): Promise<StaffProfile | undefined> {
  const response = await fetch(new URL("/admin/auth/session", apiBase), {
    credentials: "include",
    headers: { accept: "application/json" },
  });
  if (!response.ok) return undefined;

  const body = (await response.json()) as { profile?: StaffProfile };
  return body.profile;
}

export async function signOut(apiBase: string): Promise<void> {
  /*
   * `currentCsrfToken()`, not the module variable (P139-02).
   *
   * `csrfToken` is set when this module signs somebody in and is gone the
   * moment the page reloads; the cookie the API set beside the session is not.
   * So an operator who reloaded the console and then signed out sent **no**
   * CSRF header, the API refused with 403, the `.catch` below swallowed it, and
   * the lines after this cleared the local state anyway.
   *
   * The result is the worst shape available: the console says you are signed
   * out and the **server session is still valid**, with its cookie still in the
   * browser. Pressing Back is enough to be signed in again.
   *
   * `currentCsrfToken()` falls back to the cookie, which is exactly the case
   * this had wrong.
   */
  const csrf = currentCsrfToken();

  await fetch(new URL("/admin/auth/logout", apiBase), {
    method: "POST",
    credentials: "include",
    headers: {
      accept: "application/json",
      ...(csrf === undefined ? {} : { [CSRF_HEADER]: csrf }),
    },
  }).catch(() => undefined);

  // Cleared whatever the server said. A stale token in a page that believes it
  // is signed out is only useful to somebody who should not have it.
  csrfToken = undefined;
}

/**
 * Ask for a reset link (P40-02).
 *
 * Returns nothing, and cannot fail in a way the caller may act on: the API
 * answers 202 for an unknown address exactly as it does for a known one, so
 * there is no outcome to report and no branch to write. A `catch` covering the
 * network case, because a screen that says "check your inbox" after a failed
 * fetch is worse than one that says the request could not be sent.
 */
export async function requestPasswordReset(
  apiBase: string,
  email: string,
): Promise<{ sent: boolean }> {
  try {
    const response = await post(apiBase, "/admin/auth/password-reset", { email });
    // 429 is the one status worth distinguishing: it is the only observable
    // difference between callers, and telling somebody to wait a minute is
    // better than telling them to check an inbox nothing is coming to.
    return { sent: response.ok };
  } catch {
    return { sent: false };
  }
}

/**
 * Spend a reset or invitation link and set a password.
 *
 * The same endpoint an invitation is redeemed through — the token's `kind`
 * decides its lifetime server-side, and the console does not need to know
 * which it is holding.
 */
export async function redeemCredentialToken(
  apiBase: string,
  token: string,
  password: string,
): Promise<{ ok: true } | { ok: false; detail: string | undefined }> {
  const response = await post(apiBase, "/admin/auth/credentials", { token, password });
  if (response.ok) return { ok: true };

  const body = (await response.json().catch(() => ({}))) as { detail?: string };
  return { ok: false, detail: body.detail };
}

/** The platform's own mail sender, for the Sicherheit screen (P40-01). */
export interface PlatformSender {
  readonly host: string | null;
  readonly port: number | null;
  readonly username: string | null;
  readonly hasPassword: boolean;
  readonly secure: boolean;
  readonly fromAddress: string | null;
  readonly fromName: string | null;
  /** Whether host and sender are both set — anything less sends nothing. */
  readonly canSend: boolean;
}

export async function readPlatformSender(
  apiBase: string,
): Promise<PlatformSender | undefined> {
  // `catch` and not a bare `await`: an unreachable API is a rejected promise
  // with no handler, which React surfaces as an unhandled rejection rather than
  // as a screen. `undefined` renders the panel with nothing filled in, which is
  // the honest picture of "we could not read the settings".
  try {
    const response = await fetch(new URL("/admin/auth/platform-smtp", apiBase), {
      credentials: "include",
      headers: { accept: "application/json" },
    });
    if (!response.ok) return undefined;
    return (await response.json()) as PlatformSender;
  } catch {
    return undefined;
  }
}

export async function writePlatformSender(
  apiBase: string,
  input: {
    host: string | null;
    port: number | null;
    username: string | null;
    /** Omit to keep the stored password; `null` clears it. */
    password?: string | null;
    secure: boolean;
    fromAddress: string | null;
    fromName: string | null;
  },
): Promise<boolean> {
  try {
    const response = await fetch(new URL("/admin/auth/platform-smtp", apiBase), {
      method: "PUT",
      credentials: "include",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        ...(currentCsrfToken() === undefined
          ? {}
          : { [CSRF_HEADER]: currentCsrfToken() as string }),
      },
      body: JSON.stringify(input),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Ask the server to send a test message with the stored settings (P77-01).
 *
 * Returns the server's own verdict rather than a boolean. "It did not work" is
 * useless to somebody wiring up SMTP; `535 authentication failed` and
 * `getaddrinfo ENOTFOUND` are two completely different afternoons, and the
 * whole point of this control is to hand over the sentence the SMTP server
 * actually said.
 *
 * A transport failure here — the console could not reach the API at all — is
 * distinct from a delivery failure and is reported as such, because the two
 * have nothing to do with each other.
 */
export async function sendPlatformTestMail(apiBase: string): Promise<{
  status: "sent" | "not_configured" | "failed" | "unreachable" | "refused";
  reason?: string;
  sentTo?: string;
}> {
  try {
    const response = await post(apiBase, "/admin/auth/platform-smtp/test", {});
    /*
     * A refusal is not a network problem (P139-03).
     *
     * Every non-2xx used to become `unreachable`, which the screen renders as
     * "The request could not be made. Please check your connection and whether
     * you are still signed in." The API had answered `403 Forbidden` — a
     * complete, deliberate answer — and the console turned it into a suggestion
     * to check the wi-fi. §9.4: the sentence has to name what actually
     * happened, because it is the only thing the person acts on.
     */
    if (response.status >= 400 && response.status < 500) {
      return { status: "refused" };
    }
    if (!response.ok) return { status: "unreachable" };
    const body = (await response.json()) as {
      status?: string;
      reason?: string;
      sentTo?: string;
    };
    const status =
      body.status === "sent" ||
      body.status === "not_configured" ||
      body.status === "failed"
        ? body.status
        : "unreachable";
    return {
      status,
      ...(body.reason === undefined ? {} : { reason: body.reason }),
      ...(body.sentTo === undefined ? {} : { sentTo: body.sentTo }),
    };
  } catch {
    return { status: "unreachable" };
  }
}

/**
 * A POST to the staff plane, **with the CSRF token** (P139-01).
 *
 * It did not send one, and for a long time that cost nothing visible: every
 * other caller of this helper is a `@Public()` route — sign-in, TOTP enrolment
 * and verification, credential redemption, password reset — and the CSRF check
 * only applies to a request carrying a staff session. So the omission was
 * invisible until the first *authenticated* POST went through here, which was
 * "Send test email".
 *
 * The API answered `403 Forbidden`, correctly: `AppError.forbidden("missing or
 * invalid CSRF token")`. The console reported "The request could not be made.
 * Please check your connection and whether you are still signed in", which is
 * the one sentence guaranteed to send somebody looking in the wrong place.
 *
 * `currentCsrfToken()` rather than the module variable, and that difference is
 * the whole of P139-02: the variable is set at sign-in and lost on reload,
 * while the cookie the API sets survives it.
 */
function post(apiBase: string, path: string, body: unknown): Promise<Response> {
  const csrf = currentCsrfToken();

  return fetch(new URL(path, apiBase), {
    method: "POST",
    // `include` and not `same-origin`: the console is served from
    // `verwaltung.…` and the API from `api.…`, which are different origins
    // even though they are the same site. Without this the browser sends no
    // cookie and never stores the one the API sets.
    credentials: "include",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      ...(csrf === undefined ? {} : { [CSRF_HEADER]: csrf }),
    },
    body: JSON.stringify(body),
  });
}
