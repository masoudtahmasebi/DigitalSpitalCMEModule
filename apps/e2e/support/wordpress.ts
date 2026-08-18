/**
 * A page shaped like MEDICE's WordPress site, and a Keycloak to sign into it
 * (P92-01).
 *
 * ## Why the portal is not this
 *
 * Every browser test this suite has drives `apps/portal`, and the portal is
 * **not** how MEDICE's physicians reach the course. Three things differ, and
 * each is a place a defect can live that nothing else here can see:
 *
 * | | portal | WordPress |
 * | --- | --- | --- |
 * | credential | `ds_participant` cookie, same origin | **bearer token** from a provider |
 * | identity | `local` — this platform's own password | **`keycloak`** — MEDICE's realm |
 * | origin | same as the API's host | **a different origin**, so CORS decides |
 *
 * A suite that only drives the portal proves the `local` plane works on one
 * origin with cookies. That is CLAUDE.md §9.13's shape: the tests call one
 * channel, the customer uses the other.
 *
 * ## What is faithful here, and what is not
 *
 * Faithful, because each is a real failure mode:
 *
 * - **The tag order the plugin emits.** An inline classic script assigns
 *   `element.tokenProvider` *before* the deferred module that defines the
 *   element runs. That ordering is what `#upgradeProperty` exists for, and
 *   getting it wrong renders "nicht korrekt eingebunden" inside a closed shadow
 *   root — invisible, with no failed request to notice.
 * - **Three separate origins.** `127.0.0.1:4182` (the page) is not
 *   `127.0.0.1:3100` (the API), so every API call is cross-origin and
 *   `ALLOWED_ORIGINS` genuinely decides — and since P96-01 the bundle itself
 *   comes from a third, `127.0.0.1:4183`, standing in for `widget.<base>`.
 * - **The token endpoint's shape.** Same-origin `fetch` with `X-WP-Nonce`,
 *   answering `{ "token": … }` — the contract the plugin's inline provider
 *   expects, so a change to either side shows up here.
 * - **A real signed token**, from the dev Keycloak stub, verified by the API
 *   against a real JWKS. Nothing is bypassed.
 *
 * Not faithful, and deliberately: there is no PHP. WordPress's own behaviour —
 * nonce lifetime, session cookies, the REST permission callback — is exercised
 * by `wordpress/ds-lms/tests/security-test.php`, which runs the plugin's real
 * code against a WordPress stand-in. This file is about what happens **in the
 * browser** once that PHP has emitted its markup.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { WORDPRESS_ORIGIN } from "./stack.js";
import { WIDGET_BUNDLE_URL, startWidgetHost, type WidgetHost } from "./widget-host.js";

/** The stub binds this, and the seeds' `keycloak_issuer` names it. */
export const KEYCLOAK_PORT = 8080;
export const WORDPRESS_PORT = 4182;
/** Re-exported from `stack.ts`, which teaches the API to allow it. */
export { WORDPRESS_ORIGIN } from "./stack.js";

/** `packages/seed/src/ds-demo.ts` — the *keycloak* project, not the portal's. */
export const WP_PROJECT_SLUG = "ds-demo";
const REALM = "ds-demo";

/** The nonce the page sends and the endpoint requires. Shape, not security. */
const NONCE = "test-nonce";

export interface WordPressSite {
  readonly url: (path?: string) => string;
  readonly stop: () => Promise<void>;
}

/**
 * Mint a real, signed access token for `username` from the dev Keycloak.
 *
 * `sub` is the username, which is what makes "a physician nobody provisioned"
 * expressible: a fresh address is a fresh subject and therefore a fresh person.
 */
export async function mintKeycloakToken(username: string): Promise<string> {
  const response = await fetch(
    `http://127.0.0.1:${KEYCLOAK_PORT}/realms/${REALM}/protocol/openid-connect/token`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "password",
        username,
        client_id: "ds-education-api",
      }),
    },
  );
  if (!response.ok) throw new Error(`dev-keycloak refused: ${response.status}`);
  const body = (await response.json()) as { access_token?: string };
  if (typeof body.access_token !== "string") throw new Error("no access_token");
  return body.access_token;
}

/** Start the dev Keycloak stub and wait until it answers. */
export async function startKeycloak(repo: string): Promise<ChildProcess> {
  const child = spawn("node", ["apps/api/dist/dev-keycloak.js"], {
    cwd: repo,
    stdio: "ignore",
    env: { ...process.env, NODE_ENV: "development" },
  });

  const certs = `http://127.0.0.1:${KEYCLOAK_PORT}/realms/${REALM}/protocol/openid-connect/certs`;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(certs);
      if (response.ok) return child;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  child.kill();
  throw new Error("dev-keycloak did not start");
}

/**
 * Serve the page the plugin would have rendered — and, on its own origin, the
 * bundle it points at.
 *
 * The customer's server does **not** serve the bundle any more (P96-01): the
 * plugin enqueues `https://widget.<base>/ds-lms.js` from the platform, so a
 * widget fix needs no plugin update anywhere. `startWidgetHost` is that host,
 * under the headers `infra/nginx/widget.conf` really sets, because everything
 * that can go wrong with a cross-origin script goes wrong in a header.
 *
 * The bundle is read from `apps/widget/dist`, so this drives the artefact that
 * ships rather than a dev-server transpile.
 */
export function startWordPress(options: {
  repo: string;
  apiBase: string;
  token: string | undefined;
  course?: string | undefined;
}): Promise<WordPressSite> {
  let widget: WidgetHost | undefined;

  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", WORDPRESS_ORIGIN);

    // The plugin's REST route, in shape: same origin, nonce required, and the
    // token in a `token` field. A missing nonce is refused, because a page that
    // forgot it must fail here rather than silently work.
    if (url.pathname === "/wp-json/ds-lms/v1/token") {
      if (request.headers["x-wp-nonce"] !== NONCE) {
        response.writeHead(403, { "content-type": "application/json" });
        response.end(JSON.stringify({ code: "rest_cookie_invalid_nonce" }));
        return;
      }
      if (options.token === undefined) {
        // What the plugin answers for a visitor with no Keycloak token held.
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ token: null }));
        return;
      }
      response.writeHead(200, {
        "content-type": "application/json",
        "cache-control": "no-store, private",
      });
      response.end(JSON.stringify({ token: options.token }));
      return;
    }

    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(page(options.apiBase, options.course));
  });

  return startWidgetHost(options.repo).then((host) => {
    widget = host;
    return new Promise<WordPressSite>((resolve) => {
      server.listen(WORDPRESS_PORT, "127.0.0.1", () => {
        resolve({
          url: (path = "/") => `${WORDPRESS_ORIGIN}${path}`,
          stop: async () => {
            await new Promise<void>((done) => {
              server.close(() => done());
            });
            await widget?.stop();
          },
        });
      });
    });
  });
}

/**
 * The markup, in the plugin's own order.
 *
 * The element first (it is in the post content), then — in the footer — the
 * inline provider and *then* the deferred module. `defer` on a module is
 * redundant in the spec and is what `wp_register_script` emits, so it is here
 * too: this file's job is to be what WordPress produces, not what is tidiest.
 */
function page(apiBase: string, course: string | undefined): string {
  const courseAttribute = course === undefined ? "" : ` course="${course}"`;
  return `<!doctype html>
<html lang="de">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Fortbildung — MEDICE (Testseite)</title>
  </head>
  <body>
    <header><h1>ADHS bei Erwachsenen</h1></header>
    <main>
      <ds-lms api-base="${apiBase}" project="${WP_PROJECT_SLUG}"${courseAttribute}></ds-lms>
    </main>
    <script>
      (function () {
        var endpoint = "/wp-json/ds-lms/v1/token";
        var nonce = ${JSON.stringify(NONCE)};

        function provider(request) {
          var url = new URL(endpoint, window.location.href);
          if (request && request.refresh) url.searchParams.set("refresh", "1");

          return fetch(url, {
            credentials: "same-origin",
            cache: "no-store",
            headers: { accept: "application/json", "X-WP-Nonce": nonce },
          })
            .then(function (response) {
              return response.ok ? response.json() : null;
            })
            .then(function (body) {
              return body && typeof body.token === "string" ? body.token : undefined;
            })
            .catch(function () {
              return undefined;
            });
        }

        function attach() {
          document.querySelectorAll("ds-lms").forEach(function (element) {
            element.tokenProvider = provider;
          });
        }

        attach();
        if (document.readyState === "loading") {
          document.addEventListener("DOMContentLoaded", attach);
        }
      })();
    </script>
    <script type="module" defer src="${WIDGET_BUNDLE_URL}"></script>
  </body>
</html>`;
}
