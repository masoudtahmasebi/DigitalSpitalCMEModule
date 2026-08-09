import { defineConfig } from "vitest/config";

/**
 * Separate config for tests needing real infrastructure (Postgres, Redis).
 *
 * Kept apart from the default `vitest run` so `pnpm test` — run on every
 * commit, with no infrastructure available — never tries to reach a database.
 * `pnpm test:integration` runs this explicitly, in CI against the `postgres`
 * and `redis` services declared in `.github/workflows/ci.yml`.
 */
// eslint-disable-next-line no-restricted-syntax -- vitest requires a default export
export default defineConfig({
  test: {
    include: ["test/integration/**/*.test.ts"],

    /**
     * Three guards before the first test (P32-01): the database must be local,
     * the workspace builds must not be stale, and — when asked — every tenant
     * table is truncated so a run means the same thing on the hundredth day as
     * the first. See `test/integration/setup.ts` for why each one exists.
     */
    globalSetup: ["./test/integration/setup.ts"],

    /**
     * And every **file** starts from an empty database (P32-02).
     *
     * The run-level truncation above is not enough on its own: file eleven
     * still saw files one to ten. `EivService.sweep` is global by design, so
     * `eiv-worker`'s tally assertion is a claim about the whole database, and
     * it broke on the third run — `considered: 2` where the file had queued
     * exactly one. See `support/reset-each-file.ts`.
     */
    setupFiles: ["./test/integration/support/reset-each-file.ts"],
    testTimeout: 20_000,
    hookTimeout: 20_000,

    /**
     * One file at a time.
     *
     * These suites share **one Postgres and one Redis**, and two of them share
     * something narrower than that: the rate limiter is keyed on the client IP,
     * which is `127.0.0.1` for every one of them. So a suite that resets a
     * counter resets it for whatever else is mid-flight.
     *
     * That is exactly what happened. `participants.integration.test.ts` clears
     * `ratelimit:participantSignIn:*` before each of its tests — correctly, so
     * its own sign-ins are not throttled — and in CI it interleaved with
     * `participant-auth`'s deliberate "stops an online guessing run", wiping
     * the counter that test had just spent eight requests building. It passed
     * locally and failed in CI, which is the signature of a race rather than a
     * bug in either test.
     *
     * Serialising costs about ten seconds and removes the whole class. The
     * alternative — giving each suite its own Redis database, or its own source
     * address — is more machinery guarding a property that only matters here.
     */
    fileParallelism: false,
  },
});
