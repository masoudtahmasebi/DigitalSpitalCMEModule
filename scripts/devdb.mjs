/**
 * Rebuild the development database to a known state (P32-01).
 *
 * ## Why a command rather than "just be careful"
 *
 * The development database had accumulated **1096 customers**, of which three
 * were real. Not because anybody was careless — because until P32-01 the
 * integration suite wrote into it and nothing cleaned up. The console's
 * customer picker became a list of `tenant-a GmbH` and `Pipeline Test GmbH`
 * with `MEDICE` somewhere among them, and "is this broken or is this leftovers"
 * became a question somebody had to answer by hand before every session.
 *
 * The suite no longer writes here. This exists for the state already
 * accumulated, and for the ordinary case of wanting to start again.
 *
 *   pnpm db:dev:reset          drop, migrate, seed every tenant
 *   pnpm db:dev:reset --keep   migrate and seed without dropping
 *
 * ## What it seeds
 *
 * All three tenants — `medice`, `ds` and `dscustomer` — through
 * `packages/seed`, which is the same code the deploy runs, so a developer's
 * database and a fresh installation cannot drift. Seeding all three rather
 * than one is deliberate: the portal takes its tenant from the URL path, so
 * `/medice` and `/ds` are only exercisable when both exist, and a
 * single-tenant database hides every cross-tenant mistake by construction.
 *
 * It does **not** create a staff account: `bootstrap-admin` prints a password
 * once, and a password printed by a script somebody ran three weeks ago is not
 * a credential anybody should still be using.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");

const SUPERUSER =
  process.env["POSTGRES_SUPERUSER_URL"] ??
  "postgres://postgres:postgres@127.0.0.1:5432/postgres";
const DB_NAME = process.env["DEV_DB_NAME"] ?? "ds_education";
const keep = process.argv.includes("--keep");

function fail(message) {
  console.error(`devdb: ${message}`);
  process.exit(1);
}

/**
 * Whether the host has a `psql` binary of its own (P44-04).
 *
 * It usually does not. `postgresql-client` is not something Node, pnpm or
 * Docker pull in, so a developer with a clean machine and a working
 * `pnpm infra:up` still met
 *
 *     devdb: cannot reach PostgreSQL
 *
 * with a Postgres container running perfectly beside them — the diagnosis was
 * "your database is down" and the cause was a missing client. Setting up local
 * development should not require installing a database client to talk to a
 * database that arrived in a container.
 *
 * So the container's own `psql` is the fallback. Same binary, same version as
 * the server, nothing to install.
 */
const HOST_PSQL = spawnSync("psql", ["--version"], { stdio: "ignore" }).status === 0;

/**
 * Run SQL, either from the host's client or inside the postgres container.
 *
 * `input` is `{ sql }` or `{ file }`. A file is read here and piped rather than
 * passed as a path, because in the container path the file lives on the *host*
 * and `-f /repo/infra/...` would be a path the container cannot see — the kind
 * of difference between two code paths that only shows up on the machine that
 * takes the second one.
 */
function psql(url, input, extra = []) {
  const sql = "file" in input ? readFileSync(input.file, "utf8") : input.sql;
  const flags = ["-v", "ON_ERROR_STOP=1", "--no-psqlrc", "-q", ...extra, "-f", "-"];

  const result = HOST_PSQL
    ? spawnSync("psql", [url, ...flags], { encoding: "utf8", input: sql })
    : spawnSync(
        "docker",
        [
          "compose",
          "-f",
          join(REPO, "infra/docker-compose.yml"),
          "exec",
          "-T",
          "postgres",
          "psql",
          // Inside the container the server is on its own loopback, whatever
          // host:port the developer reaches it by.
          containerUrl(url),
          ...flags,
        ],
        { cwd: REPO, encoding: "utf8", input: sql },
      );

  if (result.status !== 0) {
    fail(
      `psql failed${HOST_PSQL ? "" : " (via the postgres container)"}:\n` +
        `${result.stderr ?? ""}`,
    );
  }
  return (result.stdout ?? "").trim();
}

function containerUrl(url) {
  const inner = new URL(url);
  inner.hostname = "127.0.0.1";
  inner.port = "5432";
  return inner.toString();
}

function run(command, args, env = {}) {
  const result = spawnSync(command, args, {
    cwd: REPO,
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  if (result.status !== 0) fail(`${command} ${args.join(" ")} failed`);
}

/**
 * The same refusal as `testdb.mjs`, for the same reason.
 *
 * This one drops a database whose name does *not* end in `_test`, so the host
 * check is the only thing between a typo in `POSTGRES_SUPERUSER_URL` and a
 * production outage. It is absolute.
 */
let host;
try {
  host = new URL(SUPERUSER).hostname;
} catch {
  fail("POSTGRES_SUPERUSER_URL is not a valid URL");
}
if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
  fail(
    `refusing to touch a database on ${host}: this rebuilds a local development database only`,
  );
}

// Reachability, through whichever client we are going to use — asking with one
// and then working with the other is how a check passes on a system the work
// cannot run on (CLAUDE.md §9.1).
try {
  psql(SUPERUSER, { sql: "SELECT 1" }, ["-tA"]);
} catch {
  fail("cannot reach PostgreSQL. Run: pnpm infra:up");
}

if (!keep) {
  psql(SUPERUSER, {
    sql: `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
           WHERE datname = '${DB_NAME}' AND pid <> pg_backend_pid()`,
  });
  psql(SUPERUSER, { sql: `DROP DATABASE IF EXISTS ${DB_NAME}` });
  psql(SUPERUSER, { sql: `CREATE DATABASE ${DB_NAME}` });
  console.warn(`devdb: recreated ${DB_NAME}`);
}

const target = new URL(SUPERUSER);
target.pathname = `/${DB_NAME}`;
psql(target.toString(), { file: join(REPO, "infra/postgres/init-roles.sql") });

const appUrl = `postgres://ds_app:ds_app_dev@${target.host}/${DB_NAME}`;
const migratorUrl = `postgres://ds_migrator:ds_migrator_dev@${target.host}/${DB_NAME}`;
const env = { DATABASE_URL: appUrl, MIGRATION_DATABASE_URL: migratorUrl };

run("pnpm", ["build"]);
run("pnpm", ["db:migrate"], env);

// Every seed is idempotent on its slugs, so `--keep` re-runs them harmlessly.
for (const seed of ["db:seed", "db:seed:ds", "db:seed:default"]) {
  run("pnpm", [seed], env);
}

console.warn("");
console.warn(`devdb: ${DB_NAME} ready — medice, ds and dscustomer seeded.`);
console.warn("  A staff account is not created here. To make one:");
console.warn("    pnpm --filter @ds/api exec node dist/bootstrap-admin.js");
