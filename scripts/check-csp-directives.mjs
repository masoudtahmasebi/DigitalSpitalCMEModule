/**
 * Every element the console points at the bucket has a directive naming it
 * (P161-02).
 *
 * ## The failure, three times, one file type each
 *
 * The console's Content-Security-Policy is `default-src 'self'`, and every
 * resource loaded from the object store needs its own directive saying so.
 * Three have been added, each after somebody clicked and found a blank frame:
 *
 *   P67-01  `connect-src`  the presigned PUT — no upload could start
 *   P74-03  `media-src`    `<video>` — no preview, no length probe
 *   P161-02 `object-src`   `<embed>` — no PDF preview
 *
 * Each was reported from a browser, and none could have been found on the
 * server: a CSP refusal happens entirely inside the browser, so the API log is
 * clean, the deploy is green and the only evidence is a console message on
 * somebody else's machine (§9.13).
 *
 * ## What this checks, and what it deliberately does not
 *
 * The tempting fix is "list every directive". The Caddyfile argues against
 * that in its own words, and it is right: a directive naming an origin for a
 * request nobody makes is a permission granted for nothing, and the next
 * person to copy the policy inherits it.
 *
 * So the rule is derived from the code instead. In the files that render a
 * signed bucket URL — the ones importing `media-preview.js` — every element
 * that loads its `src` from an expression is mapped to the directive that
 * governs it, and the console's policy must name `{$S3_ORIGIN}` in that
 * directive. Add an `<iframe src={url}>` to a preview component and this goes
 * red until `frame-src` is added; delete the `<embed>` and `object-src` becomes
 * a permission with no caller, which it also reports.
 *
 * `connect-src` is not derived. `fetch` to the bucket is not an element and
 * cannot be recognised by a tag; it is asserted as present and no more.
 *
 * Run by `pnpm verify` and by CI.
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const ADMIN = join(REPO, "apps/admin/src");
const CADDYFILE = join(REPO, "infra/deploy/Caddyfile");

/** Which directive governs which element. Whatwg/CSP3, not preference. */
const GOVERNED_BY = new Map([
  ["img", "img-src"],
  ["video", "media-src"],
  ["audio", "media-src"],
  ["track", "media-src"],
  ["embed", "object-src"],
  ["object", "object-src"],
  ["iframe", "frame-src"],
]);

/** The origin placeholder the policy uses for the bucket. */
const BUCKET = "{$S3_ORIGIN}";

/** Files that resolve a signed bucket URL, and therefore render one. */
const RESOLVES_BUCKET_URL = /from "\.[./]*\/?media-preview\.js"/u;

function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (/\.tsx?$/u.test(entry.name) && !/\.test\.tsx?$/u.test(entry.name))
      out.push(path);
  }
  return out;
}

const needed = new Map();

for (const path of sourceFiles(ADMIN)) {
  const source = readFileSync(path, "utf8");
  if (!RESOLVES_BUCKET_URL.test(source)) continue;

  for (const [tag, directive] of GOVERNED_BY) {
    /*
     * `src={` and not `src="`: a literal string is an asset this app ships and
     * serves from its own origin, which `'self'` already covers. Only an
     * expression can carry a signed URL.
     */
    const pattern = new RegExp(`<${tag}\\b[^>]*\\bsrc=\\{`, "su");
    if (!pattern.test(source)) continue;
    if (!needed.has(directive)) needed.set(directive, new Set());
    needed.get(directive).add(`${path.slice(REPO.length + 1)} (<${tag}>)`);
  }
}

// ---------------------------------------------------------------------------
// The console's policy, which is the one that serves apps/admin
// ---------------------------------------------------------------------------

const caddyfile = readFileSync(CADDYFILE, "utf8");

/*
 * The console's block, addressed by the site it serves.
 *
 * An earlier draft of this script found the policy by looking for the one
 * containing `{$API_DOMAIN_URL}`, and the sabotage pass caught it: delete
 * `connect-src` from the console's policy and that search quietly matched the
 * *portal's* instead, so the check went on reporting confidently about a policy
 * that serves a different app. A check that can be aimed elsewhere by the
 * change it is meant to catch is §9.1's second form. The block is addressed by
 * `{$ADMIN_DOMAIN}` now, which is the thing that actually decides which app the
 * policy is served with.
 */
const block = /^\{\$ADMIN_DOMAIN\} \{$([\s\S]*?)^\}$/mu.exec(caddyfile);
if (block === null) {
  console.error("check-csp-directives: no {$ADMIN_DOMAIN} block in the Caddyfile");
  process.exit(1);
}

const console_ = /header Content-Security-Policy "([^"]*)"/u.exec(block[1]);
if (console_ === null) {
  console.error(
    "check-csp-directives: the {$ADMIN_DOMAIN} block has no Content-Security-Policy," +
      " so the console is served on default-src alone",
  );
  process.exit(1);
}

const directives = new Map(
  console_[1]
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .map((part) => {
      const [name, ...values] = part.split(/\s+/u);
      return [name, values];
    }),
);

const problems = [];

for (const [directive, callers] of [...needed].sort()) {
  const values = directives.get(directive);
  if (values === undefined) {
    problems.push(
      `${directive} is not in the console's policy, so ${[...callers].join(", ")}` +
        ` falls back to default-src and is blocked in the browser with a clean server log`,
    );
  } else if (!values.includes(BUCKET)) {
    problems.push(
      `${directive} is set but does not name ${BUCKET}, so ${[...callers].join(", ")}` +
        ` cannot load from the object store`,
    );
  }
}

/*
 * The other direction, which is what keeps this from becoming "list them all":
 * a directive naming the bucket for elements nothing renders any more.
 */
for (const [directive, values] of directives) {
  const governs = [...GOVERNED_BY.values()].includes(directive);
  if (governs && values.includes(BUCKET) && !needed.has(directive)) {
    problems.push(
      `${directive} names ${BUCKET} and no element in apps/admin loads that kind` +
        ` of resource any more — a permission granted for a request nobody makes`,
    );
  }
}

if (!directives.has("connect-src")) {
  problems.push(
    "connect-src is missing entirely — the presigned upload PUT is a fetch, not an" +
      " element, so nothing above can derive it (P67-01)",
  );
}

if (problems.length > 0) {
  console.error("check-csp-directives: the console's CSP and its components disagree\n");
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}

const summary = [...needed]
  .sort()
  .map(([directive, callers]) => `${directive} (${callers.size})`)
  .join(", ");
console.log(`check-csp-directives: ${summary}, each naming ${BUCKET}`);
