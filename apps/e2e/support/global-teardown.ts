/**
 * Nothing this run created outlives it — pass or fail (P36-01).
 *
 * ## Why teardown drops the database rather than deleting rows
 *
 * The suite's data is a whole tenant: a customer, a department, a project, two
 * courses with their module/chapter/content trees, a participant, an enrolment,
 * progress, a certificate and an EIV submission. Deleting that by hand means a
 * DELETE per table in dependency order, kept in step with every future
 * migration — `seed-default.integration.test.ts` has exactly that list, twenty
 * statements long, and it is a maintenance burden that silently rots the day
 * somebody adds a table.
 *
 * Dropping the database removes all of it in one statement that cannot fall out
 * of date.
 *
 * ## Why this runs even when tests fail
 *
 * Playwright runs `globalTeardown` after the run regardless of outcome, and
 * that is the point: **the failure case is exactly when leftovers matter**. A
 * suite that cleans up only on success leaves its worst state behind, which is
 * how the development database reached 1096 customers (P32).
 *
 * Every step is individually guarded. A teardown that throws half-way leaves
 * the rest undone, and the one thing worse than not cleaning up is cleaning up
 * unpredictably.
 *
 * `E2E_KEEP_DATABASE=1` keeps it, for the case this is written for: something
 * failed and the state is the evidence.
 */

import { spawnSync } from "node:child_process";
import { DB_NAME } from "./world.js";

function psql(url: string, sql: string): void {
  spawnSync("psql", [url, "-v", "ON_ERROR_STOP=1", "--no-psqlrc", "-q", "-c", sql], {
    encoding: "utf8",
  });
}

// eslint-disable-next-line no-restricted-syntax -- Playwright loads these by default export
export default async function globalTeardown(): Promise<void> {
  try {
    await globalThis.__dsStack?.stop();
  } catch (error) {
    // Reported, not thrown: the database below matters more than a tidy exit,
    // and a stack that failed to stop is usually a process that already died.
    console.error(`e2e: the stack did not stop cleanly: ${String(error)}`);
  }

  if (process.env["E2E_KEEP_DATABASE"] === "1") {
    console.warn(`e2e: keeping ${DB_NAME} — E2E_KEEP_DATABASE=1`);
    return;
  }

  const superuser =
    process.env["POSTGRES_SUPERUSER_URL"] ??
    "postgres://postgres:postgres@127.0.0.1:5432/postgres";

  try {
    // The API's pool may still be closing. Terminating first is what makes the
    // DROP reliable rather than "usually".
    psql(
      superuser,
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
        WHERE datname = '${DB_NAME}' AND pid <> pg_backend_pid()`,
    );
    psql(superuser, `DROP DATABASE IF EXISTS ${DB_NAME}`);
  } catch (error) {
    console.error(`e2e: could not drop ${DB_NAME}: ${String(error)}`);
  }
}
