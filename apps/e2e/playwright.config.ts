import { defineConfig, devices } from "@playwright/test";

/**
 * Browser tests against the built platform (P35-01).
 *
 * ## Why this exists, given CLAUDE.md §6 said not to build it
 *
 * §6 says "Full E2E is not in this budget; do not build a Playwright suite
 * unless a ticket asks for it." A ticket now asks for it — explicitly, on the
 * client's instruction — so this is the deviation §6 anticipated, recorded here
 * and in `docs/backlog/P35.md` rather than absorbed silently.
 *
 * ## What it is for, given fifteen integration suites already exist
 *
 * Those drive the API over HTTP. Everything between a rendered pixel and a
 * request is invisible to them: whether the gate a physician sees matches the
 * gate the server enforces, whether the player's progress reaches the API at
 * all, whether the certificate button is reachable by keyboard. Two of the
 * defects P29 found were exactly there — a widget that tore its own player down
 * on every progress flush, and a locked overlay that was never centred.
 *
 * ## Serial, one worker
 *
 * The suite shares one database and one participant account, and the learner
 * journey is inherently ordered: you cannot pass a quiz before watching. Two
 * workers would race for the same enrolment. `fullyParallel: false` with one
 * worker costs about a minute and removes the whole class.
 */
// eslint-disable-next-line no-restricted-syntax -- Playwright loads these by default export
export default defineConfig({
  testDir: "./tests",
  globalSetup: "./support/global-setup.ts",
  globalTeardown: "./support/global-teardown.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env["CI"]),
  // One retry, and only where a run is unattended. Locally a flake should be
  // seen, not smoothed over — P32 is a whole phase about what hiding one costs.
  retries: process.env["CI"] === undefined ? 0 : 1,
  reporter: [["list"]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://127.0.0.1:4180`,
    // Kept only for a failure. A trace per passing test is gigabytes nobody
    // reads; a trace for the one that broke is the whole debugging session.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    actionTimeout: 15_000,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // The image ships the browser; nothing here downloads one.
        // `run-e2e.mjs` finds it and refuses to start if there is none, so an
        // absent value here means somebody ran `playwright test` directly.
        launchOptions: { executablePath: process.env["E2E_CHROMIUM"] ?? "" },
      },
    },
  ],
});
