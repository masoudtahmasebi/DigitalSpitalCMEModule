/**
 * Every configuration variable, and whether anything actually uses it (P24-01).
 *
 * ## The problem this solves
 *
 * Two templates — `.env.example` for a local checkout, `config.env.example` for
 * the server — plus a Nest config schema, a compose file, three shell scripts
 * and a Caddyfile. Nothing joined them up, so both failure directions happened:
 *
 * - **Documented but dead.** `PORTAL_PROJECT_SLUG` and
 *   `ADMIN_DEFAULT_PROJECT_SLUG` lost their last reader in P21-03 and P22-03.
 *   They stayed in the template *and in `deploy.sh`'s required list*, so a
 *   fresh installation was refused until somebody set two variables that do
 *   nothing. That is worse than clutter: it is an instruction that cannot be
 *   satisfied meaningfully.
 * - **Read but undocumented.** `S3_UPLOAD_TTL_SEC` was added to the config
 *   schema and to the compose file and reached the production template only
 *   because somebody remembered. The one that did not get remembered was
 *   `ALLOWED_ORIGINS`, which the compose file spelled `CORS_ALLOWED_ORIGINS`;
 *   the allow-list arrived empty and every request from the MEDICE WordPress
 *   site was refused by CORS — a browser-side failure with no server-side
 *   trace.
 *
 * A comment cannot prevent either. This can, because it fails the build.
 *
 * ## How it decides
 *
 * A variable is **read** if it appears in the API's config schema, in a
 * `process.env[...]` access, in a `${VAR}` interpolation in the compose file or
 * the Caddyfile, or as a bare `$VAR` / `${VAR}` in a deploy shell script.
 *
 * A variable is **documented** if it appears as `NAME=` at the start of a line
 * in either template.
 *
 * Both directions are errors, and the exceptions are listed explicitly below
 * with a reason each — an exception with no reason is how a check stops meaning
 * anything.
 *
 *   node scripts/env-audit.mjs          # report, exit 1 on any finding
 *   node scripts/env-audit.mjs --json   # the same, machine-readable
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

const TEMPLATES = {
  /** A local checkout: `pnpm dev`, docker-compose.yml, the test suites. */
  development: ".env.example",
  /** The server's `~/ds-education/config.env`. Never committed, only templated. */
  production: "infra/deploy/config.env.example",
};

/**
 * Variables that are legitimately in a template with no reader in this repo,
 * and why. Every entry is a claim somebody can check.
 */
const DOCUMENTED_WITHOUT_READER = new Map([
  [
    "POSTGRES_PORT",
    "published by docker-compose.yml so a host tool can reach the database; nothing in the code reads it",
  ],
  ["REDIS_PORT", "as POSTGRES_PORT — a published port, not an application setting"],
  ["KEYCLOAK_PORT", "as POSTGRES_PORT, for the development realm only"],
  ["MAILPIT_SMTP_PORT", "as POSTGRES_PORT, development mail catcher"],
  ["MAILPIT_UI_PORT", "as POSTGRES_PORT, development mail catcher"],
  ["KEYCLOAK_ADMIN", "consumed by the Keycloak image's own entrypoint in development"],
  ["KEYCLOAK_ADMIN_PASSWORD", "as KEYCLOAK_ADMIN"],
  [
    "EIV_MOCK_PORT",
    "read by apps/eiv-harness's mock server, which is a development tool rather than a deployed service",
  ],
]);

/**
 * Variables something reads that deliberately appear in no template, and why.
 */
const READ_WITHOUT_DOCUMENTATION = new Set([
  // Set by the deploy, never by a human: derived from BASE_DOMAIN or generated
  // into secrets.env. Documenting them would invite somebody to set one by
  // hand, which is the failure `domains.sh` exists to prevent.
  "DS_COMMIT",
  "DS_STATE_DIR",
  "DS_APP_PASSWORD",
  "DS_APP_PASSWORD_URL",
  "DS_MIGRATOR_PASSWORD",
  "DS_MIGRATOR_PASSWORD_URL",
  "POSTGRES_SUPERUSER_PASSWORD_URL",
  "BACKUP_ENCRYPTION_KEY",
  "BACKUP_DATABASE_URL",
  "BACKUP_PREFIX",
  "BACKUP_OBJECT_PREFIX",
  "BACKUP_WORK_DIR",
  "DS_BACKUP_DIR",
  "KEYCLOAK_ORIGIN",
  "API_ORIGIN",
  "CORS_ALLOWED_ORIGINS",
  // Node's own, and the CI runner's.
  "NODE_ENV",
  "CI",
  "HOME",
  "PATH",
  "TZ",
  "PGHOST",
  "PGPORT",
  "PGUSER",
  "PGPASSWORD",
  "PGDATABASE",
  "PGCONNECT_TIMEOUT",
  "HTTPS_PROXY",
  "npm_lifecycle_event",
]);

/** Files that are searched for readers, and how a name looks in each. */
const SOURCES = [
  { path: "apps/api/src/config/config.ts", pattern: /^\s{4}([A-Z][A-Z0-9_]+):/gm },
  { path: "infra/deploy/docker-compose.prod.yml", pattern: /\$\{([A-Z][A-Z0-9_]+)/g },
  { path: "infra/docker-compose.yml", pattern: /\$\{([A-Z][A-Z0-9_]+)/g },
  { path: "infra/deploy/Caddyfile", pattern: /\{\$([A-Z][A-Z0-9_]+)/g },
];

/** Shell names that are the interpreter's, not ours. */
const SHELL_BUILTINS = new Set([
  "LINENO",
  "BASH_SOURCE",
  "FUNCNAME",
  "IFS",
  "PWD",
  "OLDPWD",
  "RANDOM",
  "SECONDS",
  "PIPESTATUS",
  "BASH_REMATCH",
]);

/** Directories walked for `process.env["X"]` and shell `$VAR` reads. */
const SCANNED_TREES = ["apps", "packages", "scripts", "infra/deploy", "db"];
const SCANNED_EXTENSIONS = [".ts", ".tsx", ".mjs", ".js", ".sh"];

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === "dist" || entry === ".turbo") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (SCANNED_EXTENSIONS.some((ext) => entry.endsWith(ext))) yield full;
  }
}

function read(path) {
  try {
    return readFileSync(join(ROOT, path), "utf8");
  } catch {
    return "";
  }
}

/** `NAME=` at the start of a line. */
function documentedIn(path) {
  const names = new Set();
  for (const match of read(path).matchAll(/^([A-Z][A-Z0-9_]+)=/gm)) {
    names.add(match[1]);
  }
  return names;
}

/**
 * Every name a deploy script assigns.
 *
 * These are **derived**, not configured — `domains.sh` computes `API_DOMAIN`,
 * `ADMIN_DOMAIN` and the `DS_*` runtime-config values from `BASE_DOMAIN`, which
 * is the single configuration point the whole domain design rests on. They are
 * then read by the Caddyfile and the compose file, where the assignment is
 * invisible, so the "assigned in the same file" rule cannot see them.
 *
 * A derived value that appeared in a template would be a second place to set
 * it, and two answers to "what is the API's hostname?" is precisely the failure
 * `domains.sh` was written to end.
 */
function derivedNames() {
  const derived = new Set();
  for (const file of walk(join(ROOT, "infra/deploy"))) {
    if (!file.endsWith(".sh") && !file.endsWith("/dsc")) continue;
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(
      /^\s*(?:readonly |local |export |declare -\w+ )*([A-Z][A-Z0-9_]+)=/gm,
    )) {
      derived.add(match[1]);
    }
    // `export A B C` after an assignment elsewhere in the same function.
    for (const match of text.matchAll(/^\s*export\s+([A-Z][A-Z0-9_ ]+)$/gm)) {
      for (const name of match[1].trim().split(/\s+/)) derived.add(name);
    }
  }
  return derived;
}

function collectReaders() {
  /** name → the files that read it, for a message somebody can act on. */
  const readers = new Map();
  const note = (name, where) => {
    if (!readers.has(name)) readers.set(name, new Set());
    readers.get(name).add(where);
  };

  for (const source of SOURCES) {
    const text = read(source.path);
    for (const match of text.matchAll(source.pattern)) note(match[1], source.path);
  }

  for (const tree of SCANNED_TREES) {
    for (const file of walk(join(ROOT, tree))) {
      const where = relative(ROOT, file);
      // Templates document; they do not read.
      if (where.endsWith(".example")) continue;
      // A test script invents variables to test the thing that reads them.
      // Treating those as configuration would mean documenting a fixture.
      if (where.endsWith(".test.sh")) continue;
      const text = readFileSync(file, "utf8");

      // TypeScript: process.env["X"] and process.env.X
      for (const match of text.matchAll(/process\.env\[["']([A-Z][A-Z0-9_]+)["']\]/g)) {
        note(match[1], where);
      }
      for (const match of text.matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g)) {
        note(match[1], where);
      }

      // Shell needs one extra rule to be useful: a variable **assigned in the
      // same file** is a local, not a setting. Without this, `SCRIPT_DIR`,
      // `STATE_DIR` and every loop variable in `deploy.sh` are reported as
      // undocumented configuration, and thirty false findings is the same as
      // no check at all.
      //
      // Derived values are locals by exactly this rule and that is the point:
      // `API_DOMAIN` is computed by `domains.sh` from `BASE_DOMAIN`, so it must
      // *not* be in a template — a second place to set it is a second answer.
      if (where.endsWith(".sh") || where.endsWith("/dsc")) {
        const assigned = new Set(
          [
            ...text.matchAll(
              /^\s*(?:readonly |local |export |declare -\w+ )*([A-Z][A-Z0-9_]+)=/gm,
            ),
          ].map((match) => match[1]),
        );
        // `for name in …` and `read name` bind a name without an `=`.
        for (const match of text.matchAll(
          /^\s*for\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\b/gm,
        )) {
          assigned.add(match[1]);
        }
        for (const match of text.matchAll(/\$\{([A-Z][A-Z0-9_]+)[:}]/g)) {
          if (!assigned.has(match[1]) && !SHELL_BUILTINS.has(match[1])) {
            note(match[1], where);
          }
        }
      }
    }
  }

  return readers;
}

function main() {
  const development = documentedIn(TEMPLATES.development);
  const production = documentedIn(TEMPLATES.production);
  const documented = new Set([...development, ...production]);
  const readers = collectReaders();
  const derived = derivedNames();

  const findings = [];

  for (const name of [...documented].sort()) {
    if (readers.has(name)) continue;
    if (DOCUMENTED_WITHOUT_READER.has(name)) continue;
    findings.push({
      kind: "dead",
      name,
      detail:
        "documented in a template but nothing reads it — delete it, or add it " +
        "to DOCUMENTED_WITHOUT_READER with the reason",
    });
  }

  for (const [name, where] of [...readers].sort()) {
    if (documented.has(name)) continue;
    if (READ_WITHOUT_DOCUMENTATION.has(name)) continue;
    if (derived.has(name)) continue;
    findings.push({
      kind: "undocumented",
      name,
      detail: `read by ${[...where].sort().join(", ")} but in no template`,
    });
  }

  if (process.argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify({ findings }, null, 2)}\n`);
  } else if (findings.length === 0) {
    process.stdout.write(
      `env-audit: ${documented.size} documented, ${readers.size} read, no drift\n`,
    );
  } else {
    for (const finding of findings) {
      process.stdout.write(`${finding.kind.padEnd(13)} ${name(finding)}\n`);
    }
  }

  return findings.length === 0 ? 0 : 1;
}

function name(finding) {
  return `${finding.name}\n              ${finding.detail}`;
}

process.exit(main());
