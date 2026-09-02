/**
 * The bundle on its own origin, under the headers nginx actually serves
 * (P96-01).
 *
 * ## Why this server exists
 *
 * Until P96-01 the WordPress plugin shipped its own copy of `ds-lms.js` and
 * enqueued it from the plugin directory — same origin as the page. The copy was
 * a gitignored build artefact, so every checkout of the plugin was missing it
 * and a staging install 404'd. It now comes from the platform's widget host, so
 * a fix to the widget reaches every customer site on our next deploy.
 *
 * That moves the bundle **across an origin boundary**, and everything on the
 * other side of one is decided by headers no API test can see: a missing
 * `Access-Control-Allow-Origin`, a `Cross-Origin-Resource-Policy` of
 * `same-origin`, a `nosniff` against the wrong content type. Each fails in a
 * conversation between the browser and the file server that neither the API nor
 * WordPress is part of — CLAUDE.md §9.13, and the exact shape of P70-01's
 * bucket CORS and P74-07's Caddy `media-src`.
 *
 * So the rig serves it from a second origin, which is what the deployment does.
 *
 * ## Why the headers are parsed rather than written here
 *
 * The same reason `csp.ts` parses the Caddyfile: a copy is a second policy, it
 * drifts, and the day it drifts the suite is asserting a policy no installation
 * serves. `infra/nginx/widget.conf` is the source — delete its
 * `Access-Control-Allow-Origin` and this suite goes red, which is the property
 * that makes it evidence (§9.1).
 */

import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const WIDGET_CONF = fileURLToPath(
  new URL("../../../infra/nginx/widget.conf", import.meta.url),
);

export const WIDGET_PORT = 4183;
export const WIDGET_ORIGIN = `http://127.0.0.1:${WIDGET_PORT}`;
/** What the plugin's settings derive, pointed at the rig. */
export const WIDGET_BUNDLE_URL = `${WIDGET_ORIGIN}/ds-lms.js`;

export interface WidgetHost {
  readonly stop: () => Promise<void>;
}

/**
 * Every `add_header` inside the `location` block that serves the bundle.
 *
 * Throws when there are none: a widget host answering with no CORS header at
 * all is the failure this models, and a harness that quietly served none would
 * be green for exactly the wrong reason.
 */
export function widgetHeadersFromNginx(): Record<string, string> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- a fixed path in this repository
  const conf = readFileSync(WIDGET_CONF, "utf8");

  const start = conf.indexOf("location / {");
  if (start === -1) {
    throw new Error(
      "infra/nginx/widget.conf has no `location / {` block — has it been rewritten?",
    );
  }
  const rest = conf.slice(start);
  const end = rest.indexOf("\n    }");
  const block = end === -1 ? rest : rest.slice(0, end);

  const headers: Record<string, string> = {};
  for (const match of block.matchAll(/add_header\s+([A-Za-z-]+)\s+"([^"]*)"/gu)) {
    headers[match[1]!] = match[2]!;
  }

  if (Object.keys(headers).length === 0) {
    throw new Error(
      "infra/nginx/widget.conf sets no add_header in the block that serves the bundle. " +
        "nginx drops inherited headers as soon as a location declares one of its own, so " +
        "that would ship an uncacheable, unshareable bundle with no CORS (P10-04).",
    );
  }
  return headers;
}

/** Serve `apps/widget/dist/ds-lms.js` the way `widget.<base>` does. */
export function startWidgetHost(repo: string): Promise<WidgetHost> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- a path built from the repo root and a literal
  const bundle = readFileSync(join(repo, "apps/widget/dist/ds-lms.js"), "utf8");
  const headers = widgetHeadersFromNginx();

  const server: Server = createServer((request, response) => {
    if (!(request.url ?? "").startsWith("/ds-lms.js")) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      ...headers,
      "content-type": "text/javascript; charset=utf-8",
    });
    response.end(bundle);
  });

  return new Promise((resolve) => {
    server.listen(WIDGET_PORT, "127.0.0.1", () => {
      resolve({
        stop: () =>
          new Promise<void>((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}
