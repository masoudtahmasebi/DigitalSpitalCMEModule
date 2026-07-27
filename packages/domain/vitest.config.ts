import { defineConfig } from "vitest/config";

/**
 * Coverage thresholds for the pure compliance core.
 *
 * `CLAUDE.md` §6: this is the one place where coverage is expected to be
 * effectively total. It is enforced here rather than as a repo-wide average,
 * because an average lets thorough coverage of trivial code hide a gap in the
 * function that decides whether a physician earns a CME point.
 *
 * These numbers are a floor, not a target. If a threshold is in the way, the
 * answer is a missing test, not a lower number.
 */
// eslint-disable-next-line no-restricted-syntax -- vitest requires a default export
export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/index.ts"],
      thresholds: {
        statements: 95,
        branches: 90,
        functions: 95,
        lines: 95,
      },
    },
  },
});
