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
 * So the run refuses when the **installation** reports live, and says why
 * rather than skipping quietly. It asks the host, via `EIV_REPORTS_LIVE`, and
 * refuses just as loudly when it cannot get an answer — see the guard below for
 * why that direction matters and how the previous version of it never fired.
 *
 * The alternative — a per-course "does not report" switch — is product surface
 * this budget does not have, and it is recorded in `docs/backlog/P68.md` as the
 * thing to build if the smoke ever has to run on a live-reporting installation.
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

/*
 * Does the installation we are about to drive file Punktemeldungen for real?
 *
 * ## Why this is not `EIV_ALLOW_LIVE` any more (P113-01)
 *
 * It was, and it never worked. `EIV_ALLOW_LIVE` is set in the **host's**
 * `config.env`; this script runs in a GitHub Actions runner, where that
 * variable has never been set by anything. So the guard read an always-empty
 * value, concluded "not live", and let every run through. It has never been
 * able to fire — §9.1's third form, green because of what it was not scanning,
 * in the one guard standing between a smoke test and a statutory register.
 *
 * The workflow already knows how to do this properly, and says so where it
 * asks the host for its own hostnames: *"Ask the host what it believes its own
 * API hostname is, rather than rebuilding the derivation here from a copy of
 * the configuration this workflow no longer holds."* The EIV posture is the
 * one thing that was never asked. Now it is: `deploy.yml` runs the host's own
 * `ds_eiv_worker_will_file_live` — the same function `deploy.sh` uses — over
 * the host's own settings, and passes the answer in as `EIV_REPORTS_LIVE`.
 *
 * Since P180-01 those settings are rows in `platform_settings` rather than
 * lines in `config.env`, which changes where the workflow reads them and
 * changes nothing here: this end still refuses to start without a definite
 * answer from the server.
 *
 * ## Why absence is refused rather than assumed safe
 *
 * The old guard failed open: no variable meant no danger. That is exactly the
 * shape of §9.6 — a missing answer indistinguishable from a legitimate "no" —
 * and it is why nobody noticed for the life of the file. So an unset or
 * unrecognised value is now a refusal that names the workflow step responsible,
 * not a shrug. A run that cannot establish what it is pointed at does not
 * start.
 */
const reportsLive = process.env["EIV_REPORTS_LIVE"] ?? "";

if (reportsLive !== "yes" && reportsLive !== "no") {
  console.error(
    "smoke: cannot establish whether this installation reports to EIV-FOBI live.\n\n" +
      `EIV_REPORTS_LIVE is ${reportsLive === "" ? "unset" : `"${reportsLive}"`}; it must be\n` +
      'exactly "yes" or "no", and it comes from the host rather than from this runner —\n' +
      "the `derive` step in .github/workflows/deploy.yml asks the server itself.\n\n" +
      "This refuses instead of assuming 'no' on purpose. The variable it replaced\n" +
      "(EIV_ALLOW_LIVE) was only ever set on the host, so reading it here always said\n" +
      "'not live' and the guard could never fire (P113-01).",
  );
  process.exit(2);
}

if (reportsLive === "yes") {
  console.error(
    "smoke: refusing to run against an installation that reports to EIV-FOBI live.\n\n" +
      "The journey publishes an accredited Fortbildung and completes it, which queues\n" +
      "a Punktemeldung. Its VNR is reserved and belongs to no Veranstaltung, so every\n" +
      "such submission would be refused by the Ärztekammer and would raise an alert a\n" +
      "person then has to dismiss — once per deploy, for ever.\n\n" +
      "Switch the worker off in the console (Plattform → Punktemeldung) to run the\n" +
      "smoke, or see docs/backlog/P68.md for what to build if this run has to happen\n" +
      "anyway. Since P180-01 that is a switch in a browser rather than a redeploy.",
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
