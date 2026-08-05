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
  readonly capabilities: readonly string[];
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
let csrfToken: string | undefined;

export function currentCsrfToken(): string | undefined {
  return csrfToken;
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
  await fetch(new URL("/admin/auth/logout", apiBase), {
    method: "POST",
    credentials: "include",
    headers: {
      accept: "application/json",
      ...(csrfToken === undefined ? {} : { [CSRF_HEADER]: csrfToken }),
    },
  }).catch(() => undefined);

  // Cleared whatever the server said. A stale token in a page that believes it
  // is signed out is only useful to somebody who should not have it.
  csrfToken = undefined;
}

function post(apiBase: string, path: string, body: unknown): Promise<Response> {
  return fetch(new URL(path, apiBase), {
    method: "POST",
    // `include` and not `same-origin`: the console is served from
    // `verwaltung.…` and the API from `api.…`, which are different origins
    // even though they are the same site. Without this the browser sends no
    // cookie and never stores the one the API sets.
    credentials: "include",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
}
