/**
 * Every integration file starts from an empty database (P32-02).
 *
 * ## The failure this fixes
 *
 * P32-01 truncated once per run, which removed weeks of accumulated leftovers
 * but left the run itself sequential-but-shared: file eleven still saw whatever
 * files one to ten had written. The suite passed twice consecutively and then
 * failed on the third run:
 *
 *   - Expected  { considered: 1, submitted: 1 }
 *   + Received  { considered: 2, submitted: 1 }
 *
 * `EivService.sweep` is **global on purpose** — a reporting deadline does not
 * care whose tenant it belongs to, and a per-tenant sweep would need something
 * to enumerate tenants, which is the bug this design avoids. So a test that
 * asserts a sweep's tally is asserting something about the entire database, and
 * that assertion is only true when the database holds that test's fixtures and
 * nothing else.
 *
 * The alternative was to weaken the assertion to "at least one submitted",
 * which would have kept the suite green and stopped it from being able to
 * detect the worker considering rows it should not. The tally is the part worth
 * checking.
 *
 * ## Why this is affordable
 *
 * `fileParallelism: false` is already set — these suites share one Postgres and
 * one Redis and one rate-limit keyspace — so there is no concurrent file whose
 * fixtures this could delete. One `TRUNCATE` of empty-to-small tables costs a
 * few milliseconds; the whole suite grew by under a second.
 *
 * Vitest runs `setupFiles` hooks before the file's own `beforeAll`, which is
 * the ordering this depends on: the database is empty by the time a suite seeds
 * its fixtures.
 */

import { beforeAll } from "vitest";
import { resetDatabase } from "./reset.js";

/**
 * Truncating requires being asked, or a database that says what it is.
 *
 * `pnpm test:integration` sets `INTEGRATION_RESET=1` and points at
 * `ds_education_test`, so both are true. `pnpm test:integration:ci` sets
 * neither by itself — CI supplies the flag in the workflow, where the Postgres
 * is a container discarded with the job.
 *
 * Without this, a developer who ran the CI-shaped command at a terminal with
 * `DATABASE_URL` pointing at `ds_education` would empty the database they
 * develop against, on the first test file, silently. That is worse than the
 * pollution this ticket set out to fix, and it would have been introduced by
 * fixing it.
 */
function requested(url: string): boolean {
  if (process.env["INTEGRATION_RESET"] === "1") return true;

  try {
    return new URL(url).pathname.replace(/^\//u, "").endsWith("_test");
  } catch {
    return false;
  }
}

beforeAll(async () => {
  // The superuser, because RLS applies to `ds_app` and truncation must not be a
  // tenant-scoped operation.
  const url = process.env["POSTGRES_SUPERUSER_URL"] ?? process.env["DATABASE_URL"];
  if (url === undefined || url === "") {
    throw new Error("POSTGRES_SUPERUSER_URL or DATABASE_URL must be set.");
  }

  if (requested(url)) await resetDatabase(url);
});
