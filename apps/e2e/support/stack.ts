/**
 * The whole platform, on fixed ports, from built artefacts (P35-01).
 *
 * ## Why built output rather than dev servers
 *
 * A Vite dev server transpiles on demand and reloads on its own schedule. Both
 * are useful while writing code and both are sources of flake in a browser
 * test, where "the page was mid-reload" and "the feature is broken" look
 * identical. The `dist/` that Playwright drives here is byte-for-byte the one
 * the container image serves, which also means this suite can catch the class
 * of bug that only exists after a production build — a tree-shaken export, a
 * `NODE_ENV`-guarded branch, a missing asset.
 *
 * ## Why fixed ports
 *
 * The frontends read their API base from `window.__DS_CONFIG__`, which the
 * container generates at start-up. Reproducing that faithfully means writing a
 * `config.js` before serving, and a `config.js` cannot name a port that has not
 * been chosen yet. Fixed ports keep the artefact and its configuration
 * consistent, and the numbers are high enough not to collide with the ordinary
 * dev servers on 3000/5173/5174.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { extname, join, normalize } from "node:path";
import { cspFromCaddyfile } from "./csp.js";
import { startObjectStore, type ObjectStore } from "./object-store.js";

export const PORTS = { api: 3100, portal: 4180, admin: 4181 } as const;

export const API_BASE = `http://127.0.0.1:${PORTS.api}`;
export const PORTAL_BASE = `http://127.0.0.1:${PORTS.portal}`;
export const ADMIN_BASE = `http://127.0.0.1:${PORTS.admin}`;

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};

/**
 * A single-page app server: real files, `/config.js` from memory, and
 * `index.html` for anything else.
 *
 * The fallback is not a convenience. The portal takes its tenant from the URL
 * path — `/ds`, `/medice` — so a server that 404s an unknown path serves the
 * portal's most important feature not at all, and every tenant test would fail
 * for a reason that has nothing to do with the product.
 */
function serveSpa(
  root: string,
  config: Record<string, string>,
  /**
   * The Content-Security-Policy Caddy would serve for this app (P68-02).
   *
   * Not optional and not a convenience. Sixteen browser tests were green while
   * every video upload in the deployed console was blocked by a CSP, because
   * this server sent no policy and no test had ever read one. Serving the
   * deployed policy here is what makes that class of defect reachable from a
   * developer's machine — CLAUDE.md §9.1, first form.
   */
  csp: string,
): Server {
  const configBody = `window.__DS_CONFIG__ = ${JSON.stringify(config)};\n`;

  return createServer((request, response) => {
    response.setHeader("content-security-policy", csp);
    void (async () => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");

      if (url.pathname === "/config.js") {
        response.writeHead(200, { "content-type": MIME[".js"]! });
        response.end(configBody);
        return;
      }

      // `normalize` collapses any `..`, and the `startsWith` is what makes the
      // result safe to open: a request for `/../../etc/passwd` must not escape
      // the directory being served, test harness or not. That pair is also the
      // containment check the `detect-non-literal-fs-filename` disables below
      // are pointing at.
      const candidate = normalize(join(root, url.pathname));
      if (candidate.startsWith(root)) {
        try {
          // eslint-disable-next-line security/detect-non-literal-fs-filename -- contained by the check above
          const info = await stat(candidate);
          if (info.isFile()) {
            response.writeHead(200, {
              "content-type": MIME[extname(candidate)] ?? "application/octet-stream",
            });
            // eslint-disable-next-line security/detect-non-literal-fs-filename -- contained by the check above
            createReadStream(candidate).pipe(response);
            return;
          }
        } catch {
          // Falls through to index.html, which is the SPA's own router's job.
        }
      }

      response.writeHead(200, { "content-type": MIME[".html"]! });
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- a literal file inside the served root
      response.end(await readFile(join(root, "index.html")));
    })();
  });
}

export interface Stack {
  /** The harness's own bucket — see `object-store.ts`. */
  readonly storage: ObjectStore;
  stop(): Promise<void>;
}

/** Wait for something to answer, or say what never came up. */
async function waitFor(url: string, what: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "no attempt made";

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  throw new Error(`${what} never became ready at ${url} (${lastError})`);
}

export async function startStack(options: {
  repo: string;
  databaseUrl: string;
  migrationUrl: string;
  kmsKey: string;
}): Promise<Stack> {
  /*
   * The bucket comes up first, because the API reads its address at boot and a
   * partial S3 configuration is treated as no configuration at all
   * (`hasObjectStorage`) — which would silently disable every upload endpoint
   * and turn the journey's upload step into a "not configured" message.
   */
  const storage = await startObjectStore();

  const api: ChildProcess = spawn("node", ["apps/api/dist/main.js"], {
    cwd: options.repo,
    stdio: "pipe",
    env: {
      ...process.env,
      NODE_ENV: "test",
      /*
       * Object storage, for real (P68-02).
       *
       * Until now this rig had none, so `objectStorageFor` returned undefined,
       * the upload endpoints answered "not configured", and the one path the
       * client found broken on 12.08 had no test anywhere. The store verifies
       * SigV4, so a signature bug fails here rather than in a browser.
       */
      S3_ENDPOINT: storage.endpoint,
      S3_REGION: storage.region,
      S3_BUCKET: storage.bucket,
      S3_ACCESS_KEY_ID: storage.accessKeyId,
      S3_SECRET_ACCESS_KEY: storage.secretAccessKey,
      S3_FORCE_PATH_STYLE: "true",
      // The bucket is on a certificate this run generated, and `verifyUpload`
      // HEADs it from inside this process's child. See `tls.ts`.
      NODE_EXTRA_CA_CERTS: storage.caFile,
      API_PORT: String(PORTS.api),
      DATABASE_URL: options.databaseUrl,
      MIGRATION_DATABASE_URL: options.migrationUrl,
      // Real Redis, because the rate limiter is real: "too many sign-in
      // attempts" is a behaviour a physician can hit, so it is one the browser
      // suite has to be able to reach.
      REDIS_URL: process.env["REDIS_URL"] ?? "redis://127.0.0.1:6379",
      SECRETS_KMS_KEY: options.kmsKey,
      /*
       * `ALLOWED_ORIGINS`, and the name matters (P35-01).
       *
       * The first version of this file passed `CORS_ALLOWED_ORIGINS`, which is
       * what the compose file calls it and what the API does not read. The
       * result was not an error anywhere: the API booted, `/tenants/ds`
       * answered correctly to curl, and the browser showed **"Diesen Bereich
       * gibt es nicht"** — because the response was blocked before the portal
       * could read it, and a failed lookup is indistinguishable from an unknown
       * tenant.
       *
       * That is the whole argument for this suite in one bug: every API test
       * passed, the database was right, and a physician would have seen a page
       * saying their employer does not exist.
       */
      ALLOWED_ORIGINS: `${PORTAL_BASE},${ADMIN_BASE}`,
      KEYCLOAK_ISSUER: "http://127.0.0.1:1/realms/unused",
      KEYCLOAK_AUDIENCE: "unused",
      KEYCLOAK_JWKS_URI: "http://127.0.0.1:1/realms/unused/protocol/openid-connect/certs",
      // Both workers off: this suite asserts on what a person can see, and a
      // background sweep changing a row mid-assertion is the definition of a
      // flaky test. The worker has its own coverage.
      EIV_WORKER_ENABLED: "no",
      CERTIFICATE_DELIVERY_ENABLED: "no",
      LOG_LEVEL: "warn",
    },
  });

  const apiLog: string[] = [];
  api.stdout?.on("data", (chunk: Buffer) => apiLog.push(chunk.toString()));
  api.stderr?.on("data", (chunk: Buffer) => apiLog.push(chunk.toString()));
  api.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      console.error(`API exited with ${code}:\n${apiLog.join("")}`);
    }
  });

  /*
   * The policies, read out of the Caddyfile the deploy actually serves.
   *
   * The placeholder names are Caddy's own, expanded from this rig's addresses
   * rather than from the deploy environment. `KEYCLOAK_ORIGIN` expands to
   * nothing, which is what Caddy does on an installation that authenticates
   * locally — and what the portal's policy is written to tolerate.
   */
  const csp = {
    API_DOMAIN_URL: API_BASE,
    S3_ORIGIN: storage.endpoint,
    KEYCLOAK_ORIGIN: "",
  };

  const portal = serveSpa(
    join(options.repo, "apps/portal/dist"),
    { apiBase: API_BASE },
    cspFromCaddyfile("PORTAL_DOMAIN", csp),
  );
  const admin = serveSpa(
    join(options.repo, "apps/admin/dist"),
    { apiBase: API_BASE },
    cspFromCaddyfile("ADMIN_DOMAIN", csp),
  );

  portal.listen(PORTS.portal);
  admin.listen(PORTS.admin);

  try {
    await waitFor(`${API_BASE}/health`, "the API");
    await waitFor(`${PORTAL_BASE}/config.js`, "the portal");
    await waitFor(`${ADMIN_BASE}/config.js`, "the admin console");
  } catch (error) {
    // The API's own output is the only thing that explains a failure to boot —
    // a bad connection string, a missing migration, a refused KMS key.
    throw new Error(`${String(error)}\n\n--- API output ---\n${apiLog.join("")}`);
  }

  return {
    storage,
    async stop() {
      api.kill("SIGTERM");
      await Promise.all([
        new Promise<void>((resolve) => portal.close(() => resolve())),
        new Promise<void>((resolve) => admin.close(() => resolve())),
        storage.stop(),
      ]);
    },
  };
}
