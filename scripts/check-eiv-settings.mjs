#!/usr/bin/env node
/**
 * The EIV register settings stay out of the environment (P180-01).
 *
 * ## Why this is a script and not a code review
 *
 * `EIV_WORKER_ENABLED`, `EIV_BASE_URL` and `EIV_ALLOW_LIVE` decided whether
 * statutory Punktemeldungen leave this installation and who receives them.
 * They moved into `platform_settings` because changing them took a deploy —
 * and the failure mode of that move is not dramatic: somebody adds
 * `EIV_BASE_URL` back to a config file for a good local reason, a reader picks
 * it up, and the console's switch quietly stops being the thing that decides.
 *
 * Nothing would fail. The screen would say one thing and the worker would do
 * another, which is the shape CLAUDE.md §9.10b names — two homes for one value,
 * and the expensive direction is the quiet one.
 *
 * So the names are refused everywhere except the places that *explain* the
 * move. In `pnpm verify` and in CI.
 *
 * ## What it checks
 *
 * 1. No config or compose file **assigns** any of the three.
 * 2. No application source **reads** any of the three from `process.env` or
 *    from the parsed config.
 *
 * Prose is allowed: this file, the migration, the tickets and the comments
 * that say where the settings went all name them, and a check that forbade the
 * words would forbid explaining the rule.
 */

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

/** The three that moved. `EIV_MOCK_BASE_URL` is deliberately not one of them. */
const MOVED = ["EIV_WORKER_ENABLED", "EIV_BASE_URL", "EIV_ALLOW_LIVE"];

/** Files whose whole purpose is to record that these moved. */
const EXPLAINS = [
  "scripts/check-eiv-settings.mjs",
  "db/migrations/0051_platform_settings.sql",
  "infra/deploy/config.env.example",
  ".env.example",
  "apps/api/src/config/config.ts",
  "packages/eiv-client/src/endpoint.ts",
  "packages/seed/src/ds-demo.ts",
];

function tracked(pattern) {
  const out = execFileSync("git", ["ls-files", pattern], { cwd: root, encoding: "utf8" });
  return out.split("\n").filter((line) => line !== "");
}

const problems = [];

// 1. Assignments in anything that configures a deployment.
/*
 * Two globs for infra, and the recursive one does not imply the shallow
 * one.
 *
 * git's pathspec double-star matches whole directory levels, so the
 * recursive form found
 * `infra/deploy/docker-compose.prod.yml` and missed `infra/docker-compose.yml`
 * and `infra/docker-compose.apps.yml` — which is where the dev stack sets its
 * environment. The first run of this check reported "1 config file scanned" and
 * passed, with `EIV_BASE_URL` still assigned two files away.
 *
 * That is §9.1's third form exactly: green because of what it is not scanning.
 * The count below is printed for the same reason, and `MINIMUM_CONFIG_FILES`
 * fails the check if the set ever collapses again.
 */
const configFiles = [
  ...tracked("*.env"),
  ...tracked("*.env.example"),
  ...tracked("infra/*.yml"),
  ...tracked("infra/**/*.yml"),
  ...tracked("infra/*.yaml"),
  ...tracked("infra/**/*.yaml"),
  ...tracked("docker-compose*.yml"),
]
  .filter((file, index, all) => all.indexOf(file) === index)
  .filter((file) => !EXPLAINS.includes(file));

/**
 * The three compose files that configure a deployment today.
 *
 * A floor, not a count: adding one is fine, and losing them to a glob that
 * stopped matching is the failure this exists to catch.
 */
const MINIMUM_CONFIG_FILES = 3;
if (configFiles.length < MINIMUM_CONFIG_FILES) {
  problems.push(
    `only ${String(configFiles.length)} config file(s) matched, expected at ` +
      `least ${String(MINIMUM_CONFIG_FILES)}. A glob has stopped matching and ` +
      `this check is green for the wrong reason (§9.1).`,
  );
}

for (const file of configFiles) {
  const text = readFileSync(new URL(file, `file://${root}`), "utf8");
  for (const name of MOVED) {
    // An assignment, not a mention: `EIV_BASE_URL=…` or `EIV_BASE_URL: …`.
    if (new RegExp(`^\\s*(-\\s*)?${name}\\s*[:=]`, "mu").test(text)) {
      problems.push(
        `${file} assigns ${name}. It moved to platform_settings (P180-01) — ` +
          `a value here would be a second home for the setting the console shows.`,
      );
    }
  }
}

// 2. Reads in application source.
/*
 * Four globs, for the reason the config list needs six: the recursive form
 * matches nested files and not `apps/eiv-harness/src/cli.ts`, which sits
 * directly in `src`. The first version of this check scanned 153 files, passed,
 * and had never looked at the one file in the repository that still read
 * `EIV_BASE_URL`.
 */
const sourceFiles = [
  ...tracked("apps/*/src/*.ts"),
  ...tracked("apps/*/src/**/*.ts"),
  ...tracked("packages/*/src/*.ts"),
  ...tracked("packages/*/src/**/*.ts"),
]
  .filter((file, index, all) => all.indexOf(file) === index)
  .filter((file) => !EXPLAINS.includes(file) && !file.endsWith(".test.ts"));

/** A floor, for the same reason as `MINIMUM_CONFIG_FILES`. */
const MINIMUM_SOURCE_FILES = 250;
if (sourceFiles.length < MINIMUM_SOURCE_FILES) {
  problems.push(
    `only ${String(sourceFiles.length)} source file(s) matched, expected at ` +
      `least ${String(MINIMUM_SOURCE_FILES)}. A glob has stopped matching (§9.1).`,
  );
}

for (const file of sourceFiles) {
  /*
   * Comments stripped first, and this is not a nicety.
   *
   * The header promises that prose may name these — the migration, the
   * tickets and the comments recording where the settings went all do, and a
   * check that forbade the words would forbid explaining the rule. Its own
   * first run proved the point: it failed on a comment in
   * `eiv-admin.controller.ts` that says "these *were* `config.EIV_BASE_URL`".
   *
   * The same mistake `check-seed-overwrites.mjs` made and the same fix.
   */
  const text = withoutComments(readFileSync(new URL(file, `file://${root}`), "utf8"));
  for (const name of MOVED) {
    // `process.env["X"]`, `process.env.X`, or `config.X` — the three ways the
    // value could be read back into a decision.
    const read = new RegExp(
      `(process\\.env\\s*(\\[\\s*["'\`]${name}["'\`]\\s*\\]|\\.${name}\\b)|config\\.${name}\\b)`,
      "u",
    );
    if (read.test(text)) {
      problems.push(
        `${file} reads ${name}. The worker asks platform_settings on every ` +
          `sweep (P180-01); reading the environment here would make the ` +
          `console's switch decorative.`,
      );
    }
  }
}

/** Block and line comments out; string contents left alone. */
function withoutComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//gu, " ").replace(/\/\/[^\n]*/gu, " ");
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`check-eiv-settings: ${problem}`);
  process.exit(1);
}

console.log(
  `check-eiv-settings: ${String(configFiles.length)} config file(s) and ` +
    `${String(sourceFiles.length)} source file(s) scanned, none assigns or reads ` +
    `EIV_WORKER_ENABLED, EIV_BASE_URL or EIV_ALLOW_LIVE`,
);
