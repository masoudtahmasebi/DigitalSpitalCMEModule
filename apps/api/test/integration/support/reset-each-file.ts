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

import { afterAll, beforeAll, beforeEach } from "vitest";
import Redis from "ioredis";
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

/**
 * …and every **case** starts with an empty rate-limit keyspace (P206-02).
 *
 * ## The failure this fixes
 *
 * `POST /completion` carries `@RateLimit("completion")` — five per subject per
 * sixty seconds. A whole integration file runs in about twelve seconds, so
 * every case in it shares one window, and the subject is one seeded learner. The
 * budget is therefore a bounded resource shared by the whole file, spent in
 * source order and never replenished.
 *
 * `learning-flow` had spent exactly five of it. P206 added a case near the top
 * that legitimately posts a sixth, and the case that failed was
 * "refuses completion, for the retraction rather than the missing conditions",
 * four hundred lines below, with `expected 429 to be 409` — a rate limit
 * reported as a defect in an unrelated feature. That is CLAUDE.md §9.8's
 * ambient-state lesson at the level of a service: state that outlives a case is
 * a failure attributed to the wrong code.
 *
 * ## Why it belongs here rather than in the file that hit it
 *
 * It is not that file's property. `hierarchy` already carries a comment
 * explaining that it creates **one** account across four cases "on purpose"
 * because `POST /admin/staff` is limited and "a suite that spends the bucket
 * makes later, unrelated tests fail with 429"; `participant-auth`,
 * `participant-merge` and `participants` each hand-roll their own clear of the
 * one bucket that bit them. Four files had met the same class and each solved
 * it locally, which is how the fifth was still able to.
 *
 * So the reset is global, and the constraint those comments describe is lifted
 * rather than restated. Their own narrower clears are left in place: they are
 * idempotent, they record why each was added, and removing them buys nothing.
 *
 * ## What it must not do
 *
 * Two cases deliberately exhaust a bucket and assert the 429 —
 * `participant-auth`'s "stops an online guessing run" and `hierarchy`'s reset
 * throttle. Both spend their requests **inside a single `it`**, so a `beforeEach`
 * cannot reach between them. That is checked by grep rather than assumed, and it
 * is the property to re-check before anyone writes a throttling assertion split
 * across two cases: it would pass alone and fail here, which is the wrong way
 * round.
 *
 * Gated on the same `requested()` predicate as the truncation above, for the
 * same reason — a developer whose `REDIS_URL` points at something shared should
 * not have keys deleted out from under them by running a test command.
 */
let redis: Redis | undefined;

beforeAll(() => {
  const url = process.env["REDIS_URL"];
  const database =
    process.env["POSTGRES_SUPERUSER_URL"] ?? process.env["DATABASE_URL"] ?? "";
  if (url === undefined || url === "" || !requested(database)) return;
  redis = new Redis(url, { maxRetriesPerRequest: 3 });
});

beforeEach(async () => {
  if (redis === undefined) return;
  const keys = await redis.keys("ratelimit:*");
  if (keys.length > 0) await redis.del(...keys);
});

afterAll(() => {
  redis?.disconnect();
  redis = undefined;
});
