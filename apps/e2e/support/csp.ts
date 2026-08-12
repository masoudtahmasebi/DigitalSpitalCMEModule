/**
 * The deployed Content-Security-Policy, applied to the local rig (P68-02).
 *
 * ## The defect this exists because of
 *
 * On 12.08 the client reported *"the video upload to s3 does not even work!"*
 * with a browser console full of CSP violations. The console's policy did not
 * name the object-storage origin, so every upload was blocked before a byte
 * moved. Sixteen browser tests were green at the time, and they were green
 * because **the harness served the SPAs with no CSP at all** — a header set by
 * Caddy, and nothing in this suite had ever read one.
 *
 * That is CLAUDE.md §9.1 in its third form: *the check is green because of what
 * it is not scanning.* The fix is not another assertion about the Caddyfile —
 * `deploy-vars.test.sh` already has one, and it passed. It is to make the
 * browser run under the policy the browser will actually run under.
 *
 * ## Why it is parsed rather than copied
 *
 * A copy in this file would be a second policy. It would drift, and the day it
 * drifted the suite would be testing a policy no deployment serves — which is
 * the failure mode of the thing it is meant to catch, one level up. So the
 * Caddyfile is the source, and deleting `{$S3_ORIGIN}` from it turns this
 * suite red rather than only `deploy-vars.test.sh`.
 *
 * ## The one substitution, stated
 *
 * Caddy expands `{$VAR}` from the deploy environment. Here the hostnames are
 * `127.0.0.1:<port>`, so the same placeholders are expanded from the rig's own
 * addresses. An unknown placeholder becomes the empty string, which is what
 * Caddy does with an unset variable and is the behaviour that matters: it is
 * how `S3_ORIGIN` collapses on an installation with no bucket.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const CADDYFILE = fileURLToPath(new URL("../../../infra/deploy/Caddyfile", import.meta.url));

/**
 * The policy `{$ADMIN_DOMAIN}` or `{$PORTAL_DOMAIN}` serves, with placeholders
 * expanded.
 *
 * Throws rather than returning undefined when the block or the header cannot be
 * found: a harness that silently served no policy is precisely what let the
 * upload defect through, and a missing header must fail loudly here.
 */
export function cspFromCaddyfile(
  site: "ADMIN_DOMAIN" | "PORTAL_DOMAIN",
  values: Readonly<Record<string, string>>,
): string {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- a fixed path in this repository
  const caddyfile = readFileSync(CADDYFILE, "utf8");

  const start = caddyfile.indexOf(`{$${site}} {`);
  if (start === -1) {
    throw new Error(`the Caddyfile has no {$${site}} site block — has it been renamed?`);
  }

  // To the next top-level block, so a directive from the site below is never
  // read as this one's.
  const rest = caddyfile.slice(start);
  const end = rest.indexOf("\n}\n");
  const block = end === -1 ? rest : rest.slice(0, end);

  const header = /header Content-Security-Policy "([^"]+)"/u.exec(block);
  if (header === null) {
    throw new Error(
      `the Caddyfile's {$${site}} block sets no Content-Security-Policy. If that is ` +
        `deliberate, this harness must be changed deliberately too — it exists because ` +
        `a missing policy directive shipped once already (P67-01).`,
    );
  }

  return header[1]!.replace(/\{\$([A-Z0-9_]+)\}/gu, (_, name: string) => values[name] ?? "")
    // An expanded-to-nothing placeholder leaves a double space, which is legal
    // in a policy but reads as a mistake in a failure message.
    .replace(/\s{2,}/gu, " ")
    .trim();
}
