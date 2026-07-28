import { defineConfig } from "vitest/config";

/**
 * The default `pnpm test` config — unit tests only, no infrastructure.
 *
 * Without an explicit `include`, Vitest's own default glob
 * (`**\/*.{test,spec}.*`) would also pick up `test/integration/**`, which
 * needs a real Postgres and Redis. Excluding it here is what lets `pnpm test`
 * stay something every commit can run, with `pnpm test:integration`
 * (`vitest.integration.config.ts`) as the separate, infrastructure-backed
 * suite CI runs in its own job.
 */
// eslint-disable-next-line no-restricted-syntax -- vitest requires a default export
export default defineConfig({
  test: {
    // `test/contract` belongs here, not in the integration suite: those are
    // compile-time type assertions and need no infrastructure at all.
    include: ["src/**/*.test.ts", "test/contract/**/*.test.ts"],
  },
});
