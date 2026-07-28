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
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
