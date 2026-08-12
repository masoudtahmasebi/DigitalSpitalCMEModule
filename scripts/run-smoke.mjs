/**
 * The post-deploy smoke run (P68-03).
 *
 * ## What it is for
 *
 * A green deploy that cannot enrol a learner is not a green deploy. This drives
 * the whole journey — sign in, author a course, upload a video, publish, enrol,
 * watch, pass, certify — against the hostnames the client looks at, after
 * `deploy.sh` has finished. It is the run that would have caught the CSP that
 * blocked every upload and the 403 on enrolment, on the machine they happened
 * on, before anybody clicked.
 *
 * ## Why it refuses rather than defaults
 *
 * Every input is named explicitly and a missing one stops the run. A smoke test
 * that quietly fell back to `localhost` would report a healthy deployment while
 * looking at nothing at all, which is precisely the failure mode CLAUDE.md §9.9
 * is about: a report about a running system is a report about a commit, and
 * this one has to be able to say which.
 *
 * ## The one thing it will not do
 *
 * The journey publishes an **accredited** course — it has to, because a
 * Teilnahmebescheinigung requires CME points and a VNR, and generating one is
 * half of what this exists to prove. Completing that course queues a
 * Punktemeldung.
 *
 * The VNR is a reserved number the Ärztekammer has issued to nobody, so the
 * submission cannot be credited to any real Veranstaltung. What it must never
 * do is *reach* the Ärztekammer at all: an installation reporting live would
 * accumulate one refused submission per deploy, each one an alert somebody has
 * to read and dismiss.
 *
 * So the run refuses when `EIV_ALLOW_LIVE` is set, and says why rather than
 * skipping quietly. The alternative — a per-course "does not report" switch —
 * is product surface this budget does not have, and it is recorded in
 * `docs/backlog/P68.md` as the thing to build if the smoke ever has to run on a
 * live-reporting installation.
 */

import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Every variable this run needs, and what it is. */
const REQUIRED = [
  ["E2E_PORTAL_URL", "the learner portal, e.g. https://fortbildung.example.com"],
  ["E2E_ADMIN_URL", "the admin console, e.g. https://verwaltung.example.com"],
  ["E2E_API_URL", "the API, e.g. https://api.example.com"],
  [
    "SEED_TEST_STAFF_PASSWORD",
    "the password the deploy seeded the DS Test operator with",
  ],
];

const missing = REQUIRED.filter(([name]) => {
  const value = process.env[name];
  return value === undefined || value === "";
});

if (missing.length > 0) {
  console.error("smoke: this run is not pointed at anything.\n");
  for (const [name, what] of missing) console.error(`  ${name} — ${what}`);
  console.error(
    "\nAll four are required. A smoke test with a default would report a healthy\n" +
      "deployment while looking at a machine nobody deployed to.",
  );
  process.exit(2);
}

if ((process.env["EIV_ALLOW_LIVE"] ?? "") !== "") {
  console.error(
    "smoke: refusing to run against an installation that reports to EIV-FOBI live.\n\n" +
      "The journey publishes an accredited Fortbildung and completes it, which queues\n" +
      "a Punktemeldung. Its VNR is reserved and belongs to no Veranstaltung, so every\n" +
      "such submission would be refused by the Ärztekammer and would raise an alert a\n" +
      "person then has to dismiss — once per deploy, for ever.\n\n" +
      "docs/backlog/P68.md records what to build if this run has to happen anyway.",
  );
  process.exit(2);
}

/** Where the pre-installed Chromium lives, newest layout first. */
function findChromium() {
  const explicit = process.env["E2E_CHROMIUM"];
  if (explicit !== undefined && explicit !== "") return explicit;

  const root = process.env["PLAYWRIGHT_BROWSERS_PATH"] ?? "/opt/pw-browsers";
  for (const candidate of [
    join(root, "chromium", "chrome-linux", "chrome"),
    join(root, "chromium-1194", "chrome-linux", "chrome"),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

/*
 * A browser this image already ships, if there is one — and otherwise nothing,
 * so Playwright resolves its own. The local rig has Chromium at a fixed path
 * and no way to download one; a CI runner has run `playwright install` and
 * knows where it put it. Insisting on the first would break the second.
 */
const chromium = findChromium();

console.warn(`smoke: driving ${process.env["E2E_PORTAL_URL"]} as a physician,`);
console.warn(`       and ${process.env["E2E_ADMIN_URL"]} as an operator.`);

const result = spawnSync(
  "npx",
  [
    "playwright",
    "test",
    "--config",
    "playwright.smoke.config.ts",
    ...process.argv.slice(2).filter((arg) => arg !== "--"),
  ],
  {
    cwd: join(REPO, "apps/e2e"),
    stdio: "inherit",
    env: {
      ...process.env,
      ...(chromium === undefined ? {} : { E2E_CHROMIUM: chromium }),
    },
  },
);

process.exit(result.status ?? 1);
