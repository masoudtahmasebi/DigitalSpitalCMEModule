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
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { de } from "./locale/de.js";
import { readConfig } from "./config.js";
import { createAuth, tokenProviderFor } from "./auth.js";
import { createPortalClient } from "./api.js";
import { parseRoute, routePath, type Route } from "./routes.js";
import { Alert, Catalogue } from "./components/Catalogue.js";
import { CourseMount } from "./components/CourseMount.js";

type AuthState = "checking" | "anonymous" | "signed-in" | "failed";

export function App() {
  const config = useMemo(() => readConfig(), []);
  const auth = useMemo(
    () => (config === undefined ? undefined : createAuth(config)),
    [config],
  );
  const [state, setState] = useState<AuthState>("checking");

  useEffect(() => {
    if (auth === undefined) return;
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

  if (config === undefined || auth === undefined) {
    return (
      <Shell>
        <Alert>{de.error.misconfigured}</Alert>
      </Shell>
    );
  }

  if (state === "checking") {
    return (
      <Shell>
        <p className="py-8 text-sm text-gray-600" role="status">
          {de.auth.signingIn}
        </p>
      </Shell>
    );
  }

  if (state !== "signed-in") {
    return (
      <Shell>
        <div className="space-y-4">
          {state === "failed" ? <Alert>{de.auth.failed}</Alert> : null}
          <p className="text-sm text-gray-700">{de.auth.intro}</p>
          <button
            type="button"
            className="ds-button"
            onClick={() => void auth.beginLogin()}
          >
            {de.auth.signIn}
          </button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell onSignOut={() => auth.logout()}>
      <Routed config={config} auth={auth} />
    </Shell>
  );
}

function Routed(props: {
  config: NonNullable<ReturnType<typeof readConfig>>;
  auth: NonNullable<ReturnType<typeof createAuth>>;
}) {
  const { config, auth } = props;
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname));

  // The browser's back button has to work: a learner who opened a course and
  // pressed back expects the list, not a page that ignored them.
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

  const tokenProvider = useMemo(() => tokenProviderFor(auth), [auth]);

  const client = useMemo(
    () =>
      createPortalClient(
        config,
        async () => auth.currentSession()?.accessToken,
        // No silent refresh: the portal holds no refresh token, deliberately.
        // `beginLogin` navigates away, so nothing resumes after this.
        async () => {
          await auth.beginLogin();
          return undefined;
        },
      ),
    [config, auth],
  );

  if (route.kind === "course") {
    return (
      <div className="space-y-4">
        <button
          type="button"
          className="ds-button-secondary"
          onClick={() => navigate({ kind: "catalogue" })}
        >
          {de.nav.back}
        </button>
        <CourseMount
          config={config}
          courseSlug={route.slug}
          tokenProvider={tokenProvider}
        />
      </div>
    );
  }

  return (
    <Catalogue
      client={client}
      onOpenCourse={(slug) => navigate({ kind: "course", slug })}
    />
  );
}

function Shell(props: { children: React.ReactNode; onSignOut?: () => void }) {
  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <header className="mb-6 flex items-center justify-between border-b border-gray-200 pb-4">
        <a href="/" className="text-lg font-bold text-gray-900">
          {de.appTitle}
        </a>
        {props.onSignOut === undefined ? null : (
          <button type="button" className="ds-button-secondary" onClick={props.onSignOut}>
            {de.auth.signOut}
          </button>
        )}
      </header>
      <main>{props.children}</main>
    </div>
  );
}
