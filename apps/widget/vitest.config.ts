import { defineConfig } from "vitest/config";

/**
 * Widget tests.
 *
 * `jsdom` because the element under test is a custom element with a shadow
 * root — the interesting behaviour is the DOM contract with the host page, and
 * that cannot be exercised in node. The React screens are not component-tested
 * here beyond gating and status rendering: full E2E is explicitly out of this
 * budget (CLAUDE.md §6).
 */
// eslint-disable-next-line no-restricted-syntax -- vitest requires a default export
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
