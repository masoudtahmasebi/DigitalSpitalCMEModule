import { defineConfig } from "vitest/config";

/**
 * Real-Postgres tests, kept out of `pnpm test` for the same reason the API's
 * are: the default suite runs on every commit with no infrastructure to hand.
 */
// eslint-disable-next-line no-restricted-syntax -- vitest requires a default export
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Each test owns a throwaway database, but they contend on CREATE DATABASE
    // and on the advisory lock, so a single worker keeps the output readable.
    fileParallelism: false,
  },
});
