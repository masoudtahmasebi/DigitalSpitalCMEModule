/**
 * The portal shell (P11-01).
 *
 * ## What this app is
 *
 * A **host adapter**, in exactly the sense ADR-0007 defines: a page that mounts
 * `<ds-lms>` with configuration and supplies it a bearer token. The WordPress
 * plugin is the other one. Neither is privileged — the API validates the token
 * against Keycloak JWKS on every request and cannot tell which host sent it,
 * which is the point.
 *
 * Building it also keeps ADR-0007 honest. A headless core is easy to claim and
 * hard to verify with one host, because anything WordPress happens to provide
 * can leak into the design unnoticed. A second host that shares no code with the
 * first is the test: if a feature only worked because WordPress was the host,
 * it stops working here.
 *
 * ## Why the portal signs the learner in before showing anything
 *
 * `GET /courses` needs a token — every learner endpoint does — and the card's
 * call to action depends on the caller's own enrolment. An anonymous catalogue
 * would mean a second, unauthenticated read path returning a different shape,
 * which is a second answer to "what courses are there". One path, behind login.
 *
 * ## The tenant is in the path, and the root signs nobody in (P21-03)
 *
 * It used to be `PORTAL_PROJECT_SLUG`, baked into the deployment. That made
 * `fortbildung.digitalspital.com/` *be* MEDICE: opening the root ran an OIDC
 * redirect to `login.medice.de` before saying a word about where the visitor
 * was, and the page they landed on had no link back.
 *
 * Now the first path segment names the customer, the root is a welcome page,
 * and **how** a tenant signs learners in is the tenant's own configuration read
 * from `GET /tenants/{slug}`. MEDICE's learners sign in through their WordPress
 * plugin on their own site, so for them the button is a link there rather than
 * a flow we run.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { de } from "./locale/de.js";
import { readConfig } from "./config.js";
import { cookieTokenProvider } from "./auth.js";
import { parseRoute, routePath, type Route } from "./routes.js";
import { WidgetMount } from "./components/WidgetMount.js";
import { Welcome } from "./components/Welcome.js";
import { ParticipantSignIn } from "./components/ParticipantSignIn.js";
import { ChangePassword } from "./components/ChangePassword.js";

type AuthState = "checking" | "anonymous" | "signed-in" | "failed";

export function App() {
  const config = useMemo(() => readConfig(), []);
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname));

  // The browser's back button has to work across every screen, welcome page
  // included — a learner who reached a course from `/medice` and pressed back
  // twice expects the root, not a page that ignored them.
  useEffect(() => {
    const onPop = () => setRoute(parseRoute(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = useCallback((next: Route) => {
    window.history.pushState({}, "", routePath(next));
    setRoute(next);
    window.scrollTo({ top: 0 });
  }, []);

  if (config === undefined) {
    return (
      <Shell>
        <Alert>{de.error.misconfigured}</Alert>
      </Shell>
    );
  }

  // The root, before anything else and without touching auth. Rendering the
  // welcome page must not depend on an identity provider being reachable, and
  // must not start a login: that is the bug this replaced.
  if (route.kind === "welcome") {
    return (
      <Shell>
        <Welcome />
      </Shell>
    );
  }

  return (
    <Tenant key={route.tenant} config={config} route={route} onNavigate={navigate} />
  );
}

/**
 * One customer's corner of the portal.
 *
 * Keyed on the tenant in `App`, so moving between customers remounts rather
 * than reusing a component holding the previous customer's session and
 * branding — which would show one customer's catalogue under another's name
 * for as long as the fetch took.
 */
function Tenant(props: {
  config: NonNullable<ReturnType<typeof readConfig>>;
  route: Extract<Route, { kind: "catalogue" | "course" }>;
  onNavigate: (route: Route) => void;
}) {
  const { config, route } = props;
  const [signIn, setSignIn] = useState<TenantSignIn | undefined>();
  const [state, setState] = useState<AuthState>("checking");

  // Who this tenant is and where its learners sign in. Public, because the page
  // has to render before anybody has signed in — and because deciding this in
  // the client is what produced an unprompted redirect to somebody else's
  // identity provider.
  useEffect(() => {
    let cancelled = false;
    fetchTenant(config.apiBase, route.tenant)
      .then((result) => {
        if (!cancelled) setSignIn(result);
      })
      .catch(() => {
        if (!cancelled) setSignIn({ kind: "unknown" });
      });
    return () => {
      cancelled = true;
    };
  }, [config.apiBase, route.tenant]);

  /**
   * Is anybody signed in, and by which of the two means?
   *
   * Both are asked, because the answer depends on the tenant and the tenant is
   * still loading when this first runs. A Keycloak session lives in this tab's
   * storage; a participant session is an httpOnly cookie this code cannot read,
   * so the only way to ask is to call the API — `GET /auth/participant/me`
   * answers 200 or 401 and nothing else.
   */
  const [refreshKey, setRefreshKey] = useState(0);
  /**
   * Whether the participant still owes their own password.
   *
   * Held here rather than in the sign-in response, because it is re-read from
   * `GET me` on every load — that is what stops a reload skipping the screen.
   */
  const [mustChangePassword, setMustChangePassword] = useState(false);
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      // One question, one answer. There used to be a Keycloak branch here; the
      // portal has not run an OIDC flow since P21-03 and a federated tenant
      // gets a link to the customer's own login instead, so a participant
      // cookie is the only credential this host can hold.
      //
      // A failure asking is "not signed in" rather than an error: the API being
      // unreachable is already surfaced by the tenant fetch above, and
      // reporting it twice tells the visitor nothing new.
      const session = await participantSession(config.apiBase, route.tenant);
      if (cancelled) return;
      setMustChangePassword(session?.mustChangePassword === true);
      setState(session === undefined ? "anonymous" : "signed-in");
    })();

    return () => {
      cancelled = true;
    };
  }, [config.apiBase, route.tenant, refreshKey]);

  if (signIn === undefined || state === "checking") {
    return (
      <Shell>
        <p className="py-8 text-sm text-gray-600" role="status">
          {de.tenant.loading}
        </p>
      </Shell>
    );
  }

  if (signIn.kind === "unknown") {
    // Not a 404 from the API — it answers 200 with `unknown` so that an
    // unauthenticated request cannot be used to enumerate which customers
    // exist (ADR-0007). The visitor still gets told plainly.
    return (
      <Shell>
        <div className="space-y-4 py-4">
          <h1 className="text-xl font-bold text-gray-900">{de.tenant.unknown}</h1>
          <p className="text-sm text-gray-700">{de.tenant.unknownBody}</p>
          <a className="ds-button-secondary inline-block" href="/">
            {de.tenant.toWelcome}
          </a>
        </div>
      </Shell>
    );
  }

  if (state !== "signed-in") {
    return (
      <Shell customerName={signIn.customerName}>
        <div className="space-y-4 py-4">
          {state === "failed" ? <Alert>{de.auth.failed}</Alert> : null}
          {/* The form carries its own intro, so rendering one here too would
              print the same sentence twice. */}
          {signIn.kind === "external" ? (
            <p className="text-sm text-gray-700">
              {de.tenant.signInExternal(signIn.customerName)}
            </p>
          ) : null}
          {signIn.kind === "external" ? (
            /*
             * A link, not a flow we run.
             *
             * MEDICE signs learners in from a form on their own site, via the
             * WordPress plugin, against their Keycloak with a client secret the
             * plugin holds. The portal running its own authorization-code
             * redirect at the same realm was a second route into an identity
             * MEDICE never asked us to touch — and the one it produced dropped
             * the visitor on a Keycloak page with no way back.
             *
             * `rel="noopener"` because this navigates to a third-party origin;
             * without it the destination gets a handle on this window.
             */
            <a
              className="ds-button inline-block"
              href={signIn.url}
              rel="noopener noreferrer"
            >
              {de.tenant.signInAt(signIn.customerName)}
            </a>
          ) : (
            /*
             * Our own form (P25-02), not an OIDC redirect.
             *
             * `kind: "portal"` means this customer's participants hold a
             * credential here rather than at a realm of their own — which is
             * exactly what `identity_provider = 'local'` says. Running an
             * authorization-code flow for them would send them to a Keycloak
             * that has never heard of them.
             */
            <ParticipantSignIn
              apiBase={config.apiBase}
              projectSlug={route.tenant}
              customerName={signIn.customerName}
              // Re-asks the API rather than assuming: the component never sees
              // the cookie, so "did that work?" is only answerable by the same
              // call the page load makes.
              onSignedIn={() => setRefreshKey((n) => n + 1)}
            />
          )}
        </div>
      </Shell>
    );
  }

  if (mustChangePassword) {
    /*
     * Instead of the catalogue, not above it.
     *
     * A dismissible banner would be friendlier and would be ignored, which is
     * the same as not having it. This account's password is one an
     * administrator chose and passed on, and it stays valid until this form is
     * completed — so the form is the only thing there is to do.
     */
    return (
      <Shell customerName={signIn.customerName}>
        <ChangePassword
          apiBase={config.apiBase}
          projectSlug={route.tenant}
          onChanged={() => setRefreshKey((n) => n + 1)}
        />
      </Shell>
    );
  }

  return (
    <Shell
      customerName={signIn.customerName}
      onSignOut={() => {
        // Both, unconditionally. Which credential this session came from is not
        // recorded anywhere, and ending the one the visitor does not have is a
        // no-op — whereas guessing wrong leaves them signed in after clicking
        // "Abmelden", which on a shared clinic computer is the failure that
        // matters.
        void participantSignOut(config.apiBase, route.tenant).then(() => {
          setRefreshKey((n) => n + 1);
        });
      }}
    >
      <Routed config={config} route={route} onNavigate={props.onNavigate} />
    </Shell>
  );
}

/** What `GET /tenants/{slug}` answers. Mirrors `TenantController`'s union. */
type TenantSignIn =
  | { readonly kind: "unknown" }
  | { readonly kind: "external"; readonly customerName: string; readonly url: string }
  | { readonly kind: "portal"; readonly customerName: string };

async function fetchTenant(apiBase: string, slug: string): Promise<TenantSignIn> {
  const response = await fetch(`${apiBase}/tenants/${encodeURIComponent(slug)}`);
  if (!response.ok) return { kind: "unknown" };
  return (await response.json()) as TenantSignIn;
}

/**
 * Is there a live participant session for this tenant?
 *
 * The cookie is `httpOnly`, so this is the only way to ask — and that is the
 * point of it being `httpOnly`. `credentials: "include"` is what attaches it
 * across the portal/API origin split; without it the call is anonymous and the
 * answer is always "no", which presents as a sign-in that silently does
 * nothing.
 *
 * Scoped by `X-DS-Project` like every other call, so a cookie minted at one
 * tenant does not report a session at another — the API refuses that, and
 * asking correctly means the portal agrees with it rather than showing a
 * catalogue that then 401s.
 */
async function participantSession(
  apiBase: string,
  slug: string,
): Promise<{ mustChangePassword?: boolean } | undefined> {
  try {
    const response = await fetch(`${apiBase}/auth/participant/me`, {
      credentials: "include",
      headers: { "x-ds-project": slug },
    });
    if (!response.ok) return undefined;
    return (await response.json()) as { mustChangePassword?: boolean };
  } catch {
    return undefined;
  }
}

/** End a participant session server-side, not merely in this browser. */
async function participantSignOut(apiBase: string, slug: string): Promise<void> {
  try {
    await fetch(`${apiBase}/auth/participant/sign-out`, {
      method: "POST",
      credentials: "include",
      headers: { "x-ds-project": slug },
    });
  } catch {
    // Best effort. The button must still return the visitor to a signed-out
    // page: a sign-out that appears to fail leaves somebody believing they are
    // still logged in on a shared clinic computer, which is worse than a
    // cookie that outlives the click.
  }
}

function Routed(props: {
  config: NonNullable<ReturnType<typeof readConfig>>;
  route: Extract<Route, { kind: "catalogue" | "course" }>;
  onNavigate: (route: Route) => void;
}) {
  const { config, route, onNavigate } = props;

  /*
   * Which of the catalogue's two buttons brought the learner here.
   *
   * Deliberately *not* in the URL. It is a navigation intent, not an address:
   * a bookmarked "resume" link would drop whoever opened it into the middle of
   * a video months later, and a shared one would do it to somebody who had
   * never started the course. Losing it on back/forward is the same judgement —
   * returning to a course by history is browsing, not resuming.
   */
  const [openAt, setOpenAt] = useState<"start" | "resume">("start");

  // Any route change that did not come from opening a course resets the intent,
  // including a back button press — which `App` handles, so this watches the
  // route rather than the event.
  useEffect(() => {
    if (route.kind !== "course") setOpenAt("start");
  }, [route]);

  const go = useCallback(
    (next: Route, intent: "start" | "resume" = "start") => {
      setOpenAt(intent);
      onNavigate(next);
    },
    [onNavigate],
  );

  // Always the cookie. See `auth.ts` for why there is no longer a second
  // branch here.
  const tokenProvider = useMemo(() => cookieTokenProvider(), []);

  return (
    <div className="space-y-4">
      {route.kind === "course" ? (
        <button
          type="button"
          className="ds-button-secondary"
          onClick={() => go({ kind: "catalogue", tenant: route.tenant })}
        >
          {de.nav.back}
        </button>
      ) : null}

      <WidgetMount
        config={config}
        // The tenant travels with the request as `X-DS-Project`, exactly as a
        // WordPress host would send it — from the path now, not from the
        // container's configuration. That is the whole of P21-03.
        projectSlug={route.tenant}
        courseSlug={route.kind === "course" ? route.slug : undefined}
        openAt={openAt}
        tokenProvider={tokenProvider}
        onOpenCourse={(slug, intent) =>
          go({ kind: "course", tenant: route.tenant, slug }, intent)
        }
      />
    </div>
  );
}

/**
 * The portal's only error surface.
 *
 * Two states reach it — a misconfigured deployment and a failed sign-in — and
 * both happen before the widget is mounted. Everything after that is the
 * widget's own, inside its shadow root, with its own copy.
 */
function Alert(props: { children: React.ReactNode }) {
  return (
    <div
      className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"
      role="alert"
    >
      <p className="font-semibold">{de.error.title}</p>
      {props.children}
    </div>
  );
}

function Shell(props: {
  children: React.ReactNode;
  /** Whose portal this is. Absent on the welcome page, which names nobody. */
  customerName?: string;
  onSignOut?: () => void;
}) {
  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 pb-4">
        <a href="/" className="text-lg font-bold text-gray-900">
          {de.appTitle}
        </a>
        <div className="flex items-center gap-3">
          {props.customerName === undefined ? null : (
            <span className="text-sm text-gray-600">{props.customerName}</span>
          )}
          {props.onSignOut === undefined ? null : (
            <button
              type="button"
              className="ds-button-secondary"
              onClick={props.onSignOut}
            >
              {de.auth.signOut}
            </button>
          )}
        </div>
      </header>
      <main>{props.children}</main>
    </div>
  );
}
