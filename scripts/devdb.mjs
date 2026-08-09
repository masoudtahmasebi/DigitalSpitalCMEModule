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

function psql(url, args) {
  const result = spawnSync(
    "psql",
    [url, "-v", "ON_ERROR_STOP=1", "--no-psqlrc", "-q", ...args],
    {
      encoding: "utf8",
    },
  );
  if (result.status !== 0) fail(`psql failed:\n${result.stderr ?? ""}`);
  return (result.stdout ?? "").trim();
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

const alive = spawnSync("psql", [SUPERUSER, "-tAc", "SELECT 1"], { encoding: "utf8" });
if (alive.status !== 0) {
  fail(
    "cannot reach PostgreSQL. docker compose -f infra/docker-compose.yml up -d postgres redis",
  );
}

if (!keep) {
  psql(SUPERUSER, [
    "-c",
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
      WHERE datname = '${DB_NAME}' AND pid <> pg_backend_pid()`,
  ]);
  psql(SUPERUSER, ["-c", `DROP DATABASE IF EXISTS ${DB_NAME}`]);
  psql(SUPERUSER, ["-c", `CREATE DATABASE ${DB_NAME}`]);
  console.warn(`devdb: recreated ${DB_NAME}`);
}

const target = new URL(SUPERUSER);
target.pathname = `/${DB_NAME}`;
psql(target.toString(), ["-f", join(REPO, "infra/postgres/init-roles.sql")]);

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
