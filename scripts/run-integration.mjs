/**
 * One command that runs the integration suite (P32-01).
 *
 * ## Why this exists rather than a line in the README
 *
 * Running the suite by hand meant this, every time:
 *
 *   DATABASE_URL=postgres://ds_app:ds_app_dev@127.0.0.1:5432/ds_education \
 *   MIGRATION_DATABASE_URL=postgres://ds_migrator:ds_migrator_dev@… \
 *   POSTGRES_SUPERUSER_URL=postgres://postgres:postgres@… \
 *   REDIS_URL=redis://127.0.0.1:6379 \
 *   npx vitest run -c vitest.integration.config.ts
 *
 * Four URLs, from memory, from `apps/api`, with the workspace packages built
 * beforehand or the run silently tests yesterday's code. Every one of those is
 * a way to get a wrong answer, and all of them were got wrong in practice —
 * usually the build, which fails in the most confusing way available: the fix
 * you just made does not appear.
 *
 * So the command is `pnpm test:integration`, and it:
 *
 *   1. provisions an isolated test database (never the development one)
 *   2. builds the workspace packages the suites import through
 *   3. runs every suite against it, truncated first
 *
 * `--fresh` rebuilds the database from nothing. Worth it after a migration, and
 * not otherwise — creating and migrating takes a few seconds.
 *
 * CI does not use this: its Postgres is a fresh container per run and its
 * workflow already sequences the same steps explicitly, which is the right
 * shape there because each one is a named step that can fail visibly.
 * `pnpm test:integration:ci` is that path.
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");

const DB_NAME = process.env["TEST_DB_NAME"] ?? "ds_education_test";
const HOST = process.env["TEST_DB_HOST"] ?? "127.0.0.1:5432";
const REDIS = process.env["REDIS_URL"] ?? "redis://127.0.0.1:6379";

const passThrough = process.argv.slice(2).filter((arg) => arg !== "--fresh");
const fresh = process.argv.includes("--fresh");

function step(command, args, env = {}) {
  const result = spawnSync(command, args, {
    cwd: REPO,
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

step("node", ["scripts/testdb.mjs", ...(fresh ? ["--fresh"] : [])]);

/*
 * Build before running, always.
 *
 * `turbo run test:integration` would do this through `dependsOn: ["^build"]`,
 * but going through turbo also swallows vitest's `-t` and file filters, which
 * is the whole reason somebody runs one suite by hand. Building explicitly
 * keeps both.
 */
step("pnpm", ["build"]);

const env = {
  DATABASE_URL: `postgres://ds_app:ds_app_dev@${HOST}/${DB_NAME}`,
  MIGRATION_DATABASE_URL: `postgres://ds_migrator:ds_migrator_dev@${HOST}/${DB_NAME}`,
  POSTGRES_SUPERUSER_URL: `postgres://postgres:postgres@${HOST}/${DB_NAME}`,
  REDIS_URL: REDIS,
  // Truncate first. Safe here because this database exists only for this.
  INTEGRATION_RESET: "1",
};

const result = spawnSync(
  "npx",
  ["vitest", "run", "-c", "vitest.integration.config.ts", ...passThrough],
  { cwd: join(REPO, "apps/api"), stdio: "inherit", env: { ...process.env, ...env } },
);

process.exit(result.status ?? 1);
