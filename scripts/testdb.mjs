/**
 * Provision an isolated database for the integration suite (P32-01).
 *
 * ## The problem this solves
 *
 * The integration suite wrote into `ds_education` — the same database a
 * developer runs the console and the portal against. Nothing cleaned up, and
 * every run left roughly fifty customers behind. After a few weeks of this the
 * development database held **1096 customers**, of which three were real:
 *
 * - The console's customer picker became a wall of `tenant-a GmbH`,
 *   `Pipeline Test GmbH`, `Completion Flow GmbH` — hundreds of entries, and
 *   the two that matter buried among them.
 * - Suites became order-dependent. `eiv-worker.integration.test.ts` has to
 *   `UPDATE eiv_submissions SET status = 'held' WHERE customer_id <> $1`
 *   before it starts, because the worker's sweep is global by design and would
 *   otherwise process every other suite's leftovers and count them in its
 *   tally. That is a workaround for this, written into a test.
 * - Runs got slower every week, and nobody could say whether a failure was
 *   theirs or something a previous run had left.
 *
 * CI never saw any of it: its Postgres is a fresh container per run. So the
 * suite was green in CI and increasingly unreliable locally, which is the worst
 * arrangement — the signal people actually watch is the one that lies.
 *
 * ## What this does
 *
 * Creates (or reuses) a database named for testing, applies the role grants and
 * every migration, and leaves it empty. Cheap enough to run before every suite.
 *
 *   node scripts/testdb.mjs           # provision, keeping existing data
 *   node scripts/testdb.mjs --fresh   # drop and rebuild from nothing
 *
 * ## The guard
 *
 * `--fresh` drops a database. It refuses any name that does not end in `_test`,
 * and refuses any host that is not local. Both refusals are absolute — there is
 * no flag to override them, because the only reason to want one is the reason
 * this guard exists.
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Where the cluster is, and who may create a database on it. */
const SUPERUSER =
  process.env["POSTGRES_SUPERUSER_URL"] ??
  "postgres://postgres:postgres@127.0.0.1:5432/postgres";
const DB_NAME = process.env["TEST_DB_NAME"] ?? "ds_education_test";

const fresh = process.argv.includes("--fresh");

function fail(message) {
  console.error(`testdb: ${message}`);
  process.exit(1);
}

/**
 * Never a database that is not obviously a test database, never a host that is
 * not this machine.
 *
 * A dropped production database is not a bug you fix forward from, and the
 * distance between `ds_education_test` and `ds_education` is one word in one
 * environment variable.
 */
function assertSafeToDrop(url, name) {
  if (!name.endsWith("_test")) {
    fail(`refusing to drop "${name}": a test database name must end in _test`);
  }

  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    fail(`POSTGRES_SUPERUSER_URL is not a valid URL`);
  }

  if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
    fail(`refusing to drop a database on ${host}: only a local cluster may be rebuilt`);
  }
}

function psql(url, args, { input } = {}) {
  const result = spawnSync(
    "psql",
    [url, "-v", "ON_ERROR_STOP=1", "--no-psqlrc", "-q", ...args],
    {
      input,
      encoding: "utf8",
      stdio: input === undefined ? "pipe" : ["pipe", "pipe", "pipe"],
    },
  );

  if (result.error !== undefined) {
    fail(
      `psql could not be run (${result.error.message}). Is PostgreSQL installed and running?`,
    );
  }
  if (result.status !== 0) {
    fail(`psql failed:\n${result.stderr ?? ""}`);
  }

  return (result.stdout ?? "").trim();
}

function run(command, args, env) {
  const result = spawnSync(command, args, {
    cwd: REPO,
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  if (result.status !== 0) fail(`${command} ${args.join(" ")} failed`);
}

// --- 1. Is the cluster there at all? ---------------------------------------
//
// Checked first and reported plainly. "connection refused" from six layers
// down, halfway through a test run, is the single most common way this suite
// wastes somebody's afternoon.
const alive = spawnSync("psql", [SUPERUSER, "-tAc", "SELECT 1"], { encoding: "utf8" });
if (alive.status !== 0) {
  fail(
    [
      "cannot reach PostgreSQL.",
      "",
      `  tried: ${SUPERUSER.replace(/:[^:@/]*@/u, ":***@")}`,
      "",
      "  docker compose -f infra/docker-compose.yml up -d postgres redis",
      "",
      "or set POSTGRES_SUPERUSER_URL if your cluster is elsewhere.",
    ].join("\n"),
  );
}

// --- 2. The database ---------------------------------------------------------
const exists =
  psql(SUPERUSER, ["-tAc", `SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}'`]) ===
  "1";

if (fresh && exists) {
  assertSafeToDrop(SUPERUSER, DB_NAME);
  // Terminate stragglers first: a vitest run killed with ^C leaves its pool
  // connected, and DROP DATABASE fails while anything holds it open.
  psql(SUPERUSER, [
    "-c",
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${DB_NAME}' AND pid <> pg_backend_pid()`,
  ]);
  psql(SUPERUSER, ["-c", `DROP DATABASE ${DB_NAME}`]);
  console.warn(`testdb: dropped ${DB_NAME}`);
}

if (fresh || !exists) {
  psql(SUPERUSER, ["-c", `CREATE DATABASE ${DB_NAME}`]);
  console.warn(`testdb: created ${DB_NAME}`);
}

// --- 3. Roles ----------------------------------------------------------------
//
// `init-roles.sql` is database-agnostic on purpose — it grants against
// `current_database()` rather than a literal name — so the same file that
// bootstraps production applies here unchanged. Roles are cluster-wide, so
// re-running it is idempotent by design.
const target = new URL(SUPERUSER);
target.pathname = `/${DB_NAME}`;
psql(target.toString(), ["-f", join(REPO, "infra/postgres/init-roles.sql")]);

// --- 4. Migrations -----------------------------------------------------------
//
// Through the real migrator, not a schema dump. A dump would drift, and the
// migrations are themselves the thing under test whenever one is added.
const appUrl = `postgres://ds_app:ds_app_dev@${target.host}/${DB_NAME}`;
const migratorUrl = `postgres://ds_migrator:ds_migrator_dev@${target.host}/${DB_NAME}`;

run("pnpm", ["--filter", "@ds/migrator...", "build"], {});
run("pnpm", ["db:migrate"], {
  DATABASE_URL: appUrl,
  MIGRATION_DATABASE_URL: migratorUrl,
});

console.warn(`testdb: ${DB_NAME} ready`);
console.warn(`  DATABASE_URL=${appUrl}`);
