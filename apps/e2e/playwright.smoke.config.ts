/**
 * The same journey, against the installation the client actually looks at
 * (P68-03).
 *
 * ## Why a second config rather than a flag
 *
 * `playwright.config.ts` rebuilds a database, starts an API and serves two
 * SPAs, and every other spec in `tests/` depends on the tenant that setup
 * seeds. Pointing that at a deployment would either drop a production database
 * or run five specs that assume fixtures nobody put there.
 *
 * So this config runs **one** spec and starts nothing. `journey.spec.ts` was
 * written for both targets from the beginning — `support/target.ts` is where it
 * chooses — and everything it needs on the far side is seeded by `deploy.sh`.
 *
 * ## What this run can see that the local one cannot
 *
 * Real Caddy and its headers, real cookie attributes on real hostnames, a real
 * bucket in another region with its own CORS, the built images rather than a
 * `dist/` on somebody's disk, and the seed step of the deploy itself. Every
 * defect the client found on 12.08 lived in one of those.
 *
 * ## No retries, deliberately
 *
 * A flake here is a failed deploy, which is expensive — but a retry that turns
 * a real intermittent failure green is more expensive, because it produces a
 * green deploy for a platform that half works. If this is flaky, that is a
 * finding about the deployment.
 */

import { defineConfig, devices } from "@playwright/test";

// eslint-disable-next-line no-restricted-syntax -- Playwright loads these by default export
export default defineConfig({
  testDir: "./tests",
  /*
   * Both journeys, against the installation (P88-04).
   *
   * `journey.spec.ts` walks one module with one exam — MEDICE's accredited
   * shape. `zwei-module.spec.ts` walks an exam on every module, which is the
   * shape the client asked for in P87 and the one whose gate is new. §9.13's
   * rule is that the deploy runs the same spec the rig runs; a new journey that
   * only ever ran locally would be the half of that rule nobody applied.
   *
   * It costs about fifty seconds and leaves one more course on the DS Test
   * tenant, which keeps its data on purpose. The `EIV_ALLOW_LIVE` refusal in
   * `run-smoke.mjs` covers both, so neither can queue a Punktemeldung against
   * an installation that reports live.
   */
  testMatch: /(journey|zwei-module)\.spec\.ts$/u,
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  reporter: [["list"]],
  // Everything crosses a network and a TLS handshake rather than a loopback
  // socket, and the deployed machine is doing other things.
  timeout: 600_000,
  expect: { timeout: 30_000 },
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    actionTimeout: 30_000,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        /*
         * Only when one was found. Unlike the local rig, this config also runs
         * on a CI runner where `playwright install` has put a browser in
         * Playwright's own cache — and an empty `executablePath` there is a
         * launch failure rather than a fallback.
         */
        ...(process.env["E2E_CHROMIUM"] === undefined ||
        process.env["E2E_CHROMIUM"] === ""
          ? {}
          : { launchOptions: { executablePath: process.env["E2E_CHROMIUM"] } }),
      },
    },
  ],
});
