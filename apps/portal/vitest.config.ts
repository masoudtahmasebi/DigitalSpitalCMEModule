import { defineConfig } from "vitest/config";

/**
 * `jsdom` because what is worth testing here is the login flow's browser
 * behaviour — redirect parameters, sessionStorage, the address bar — not
 * React rendering. Full E2E is out of this budget (CLAUDE.md §6).
 */
// eslint-disable-next-line no-restricted-syntax -- vitest requires a default export
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
