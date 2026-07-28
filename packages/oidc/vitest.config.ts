import { defineConfig } from "vitest/config";

/** `jsdom`, because what this package does is browser behaviour. */
// eslint-disable-next-line no-restricted-syntax -- vitest requires a default export
export default defineConfig({
  test: { environment: "jsdom", include: ["src/**/*.test.ts"] },
});
