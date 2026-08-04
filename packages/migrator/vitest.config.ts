import { defineConfig } from "vitest/config";

/**
 * Unit tests only — `src/**`.
 *
 * Without an explicit `include`, vitest's default glob also matches
 * `test/atomicity.test.ts`, which needs a real Postgres and would fail
 * `pnpm test` on a machine that has none. That suite is run by
 * `vitest.integration.config.ts` instead.
 */
// eslint-disable-next-line no-restricted-syntax -- vitest requires a default export
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
