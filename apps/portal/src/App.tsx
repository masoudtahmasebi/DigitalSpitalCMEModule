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
import { createAuth, tokenProviderFor } from "./auth.js";
import { parseRoute, routePath, type Route } from "./routes.js";
import { WidgetMount } from "./components/WidgetMount.js";
import { Welcome } from "./components/Welcome.js";

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

  const auth = useMemo(() => createAuth(config), [config]);

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

  useEffect(() => {
    auth
      .completeLogin()
      .then((session) => {
        setState(
          session === undefined && auth.currentSession() === undefined
            ? "anonymous"
            : "signed-in",
        );
      })
      .catch(() => setState("failed"));
  }, [auth]);

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
          <p className="text-sm text-gray-700">
            {signIn.kind === "external"
              ? de.tenant.signInExternal(signIn.customerName)
              : de.auth.intro}
          </p>
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
            <button
              type="button"
              className="ds-button"
              onClick={() => void auth.beginLogin()}
            >
              {de.auth.signIn}
            </button>
          )}
        </div>
      </Shell>
    );
  }

  return (
    <Shell customerName={signIn.customerName} onSignOut={() => auth.logout()}>
      <Routed config={config} auth={auth} route={route} onNavigate={props.onNavigate} />
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

function Routed(props: {
  config: NonNullable<ReturnType<typeof readConfig>>;
  auth: NonNullable<ReturnType<typeof createAuth>>;
  route: Extract<Route, { kind: "catalogue" | "course" }>;
  onNavigate: (route: Route) => void;
}) {
  const { config, auth, route, onNavigate } = props;

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

  const tokenProvider = useMemo(() => tokenProviderFor(auth), [auth]);

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
