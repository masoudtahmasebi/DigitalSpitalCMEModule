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
 * 2. No application source **reads** any of the three — from `process.env`,
 *    from the parsed config, or through a helper that takes the name as a
 *    string.
 * 3. No **instructional document** tells somebody to set one.
 *
 * Prose is allowed: this file, the migration, the tickets and the comments
 * that say where the settings went all name them, and a check that forbade the
 * words would forbid explaining the rule.
 *
 * ## What 2 and 3 cost before they were added (P182-05)
 *
 * The first version looked for `process.env["X"]`, `process.env.X` and
 * `config.X`, and reported success while `apps/api/src/eiv-check.ts` —
 * `./dsc eiv`, the operator's instrument for proving the EIV connection — read
 * both `EIV_BASE_URL` and `EIV_ALLOW_LIVE` through its own `env("…")` helper.
 * That is CLAUDE.md §9.1's second form exactly: a check that silently covers
 * less than it claims. A name reached as a *string* is now a hit wherever it
 * appears outside a comment, which is a blunter rule and the right one — the
 * question is whether the name is live in the file at all.
 *
 * The documents were worse, because a document is the interface. Five of them
 * still instructed an operator to set variables that had moved, and one of
 * those instructions had become the exact thing `deploy.sh` refuses. Nothing
 * read documentation, so nothing said so.
 *
 * Documents that record history — `docs/backlog/`, `docs/adr/`, the changelogs
 * — are not read, for the reason `check-docs-commands.mjs` gives at greater
 * length: a correct entry there may name a setting that was rightly removed
 * afterwards, and requiring history to stay current would mean rewriting it.
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
  /*
   * `.env.example` was on this list and named none of the three — the entry
   * outlived the sentence it was written for. The staleness check above found
   * it on its first run, which is the argument for the check (P182-05).
   */
  "apps/api/src/config/config.ts",
  "packages/eiv-client/src/endpoint.ts",
  "packages/seed/src/ds-demo.ts",
  /*
   * The smoke runner's refusal *message* names `EIV_ALLOW_LIVE` — in a string,
   * not a comment, because it is telling an operator which variable this one
   * replaced and why the old guard could never fire (P113-01). That sentence is
   * the point of the file's guard, and a check that forbade it would delete the
   * explanation to protect the rule.
   */
  "scripts/run-smoke.mjs",
  /*
   * The environment audit's own allowlist has to *name* the three, because what
   * it is recording is that they appear in no template on purpose — see the
   * entry there. Two static checks, each of which must mention what the other
   * forbids, is a small circle and better written down than worked around.
   */
  "scripts/env-audit.mjs",
];

/*
 * An exemption that no longer explains anything is an exemption that has become
 * a hole (§9.1's third form). Every entry above must be a file that exists and
 * that still names one of the three — otherwise it is silently exempting a file
 * for a reason that stopped being true.
 */
const explainProblems = [];
for (const file of EXPLAINS) {
  let text;
  try {
    text = readFileSync(new URL(file, `file://${root}`), "utf8");
  } catch {
    explainProblems.push(
      `${file} is on the "explains the move" list and does not exist.`,
    );
    continue;
  }
  if (!MOVED.some((name) => text.includes(name))) {
    explainProblems.push(
      `${file} is exempted as explaining where these settings went, and names ` +
        `none of them any more. Delete the entry.`,
    );
  }
}

function tracked(pattern) {
  const out = execFileSync("git", ["ls-files", pattern], { cwd: root, encoding: "utf8" });
  return out.split("\n").filter((line) => line !== "");
}

const problems = [...explainProblems];

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
  // `apps/e2e` has no `src/`, so four globs aimed at `src` never saw the rig
  // that stands up the product — where a dead `EIV_WORKER_ENABLED: "no"` sat
  // reading as the reason the suite was stable (P182-05). `scripts/` is the
  // same shape: `run-smoke.mjs` is the guard between a smoke run and a
  // statutory register and lives in neither an app nor a package.
  ...tracked("apps/e2e/**/*.ts"),
  ...tracked("scripts/*.mjs"),
]
  .filter((file, index, all) => all.indexOf(file) === index)
  .filter((file) => !EXPLAINS.includes(file) && !file.endsWith(".test.ts"));

/** A floor, for the same reason as `MINIMUM_CONFIG_FILES`. */
const MINIMUM_SOURCE_FILES = 280;
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
    /*
     * The name anywhere in the code, not one of three shapes.
     *
     * It used to look for `process.env["X"]`, `process.env.X` and `config.X`,
     * and missed `env("EIV_BASE_URL")` — one helper call, in the entrypoint an
     * operator uses to prove the EIV connection (P182-05). Enumerating the ways
     * a string can be reached is a losing game; the honest question is whether
     * the name is live in this file at all, and the comment stripping above is
     * what keeps explanation legal.
     */
    const read = new RegExp(`\\b${name}\\b`, "u");
    if (read.test(text)) {
      problems.push(
        `${file} reads ${name}. The worker asks platform_settings on every ` +
          `sweep (P180-01); reading the environment here would make the ` +
          `console's switch decorative.`,
      );
    }
  }
}

// 3. Instructions in documentation.
/*
 * A document is an interface, and this is the half that was missing entirely.
 *
 * Five instructional documents still told an operator to set variables that had
 * moved — and `docs/eiv-test-system.md` told them to put `EIV_ALLOW_LIVE=yes`
 * and `EIV_BASE_URL=…` into `config.env`, which is now precisely what stops the
 * next deploy. A person following our own documentation would have broken their
 * installation with it (P182-05).
 *
 * The rule is narrower than the source rule, deliberately: a document may
 * **name** these — every one of them explains where the setting went — and may
 * not show one being **set**. `EIV_ALLOW_LIVE=yes`, `EIV_BASE_URL: …`, or the
 * name inside an `export`. That is the difference between recording history and
 * issuing an instruction, and it is the same line `check-docs-commands.mjs`
 * draws.
 */
const HISTORY = [/^docs\/backlog\//u, /^docs\/adr\//u, /CHANGELOG/u];

/*
 * The one document exempted from rule 3, and why it needs its own line.
 *
 * `docs/show-stoppers.md` is a running record of open questions and their dated
 * answers, and one of those entries — "Update 09.08 — an environment now points
 * at the test system" — quotes the configuration as it stood that day. Editing
 * it to the current names would falsify the record; leaving it makes this check
 * red for ever.
 *
 * It is exempted by name rather than by pattern, and a **stale** exemption is a
 * failure below: if the file stops naming these, the entry has to go with it.
 * That is what keeps an exemption from quietly becoming the reason the check is
 * green — which is the whole of §9.1's third form.
 *
 * Its live instructions were fixed rather than exempted: the harness lines now
 * read `EIV_HARNESS_*`, which is what the harness has taken since P180-01.
 */
const DOCUMENT_EXEMPT = [
  {
    file: "docs/show-stoppers.md",
    why: "a dated record of what one environment was configured to on 09.08, kept as history",
  },
];

const documents = tracked("*.md").filter(
  (file) => !HISTORY.some((pattern) => pattern.test(file)) && !EXPLAINS.includes(file),
);

const exemptUsed = new Set();

/** A floor, for the same reason as the other two. */
const MINIMUM_DOCUMENTS = 40;
if (documents.length < MINIMUM_DOCUMENTS) {
  problems.push(
    `only ${String(documents.length)} document(s) matched, expected at least ` +
      `${String(MINIMUM_DOCUMENTS)}. A glob has stopped matching (§9.1).`,
  );
}

for (const file of documents) {
  const text = readFileSync(new URL(file, `file://${root}`), "utf8");
  for (const name of MOVED) {
    // Being set, not being mentioned: `X=…`, `X: …`, or exported. A bare
    // mention is how a document explains that the setting moved.
    const assigned = new RegExp(`(^|[\\s\`'"(]|export\\s+)${name}\\s*[:=]`, "mu");
    if (!assigned.test(text)) continue;

    const exemption = DOCUMENT_EXEMPT.find((entry) => entry.file === file);
    if (exemption !== undefined) {
      exemptUsed.add(file);
      continue;
    }

    {
      problems.push(
        `${file} shows ${name} being set. It moved to platform_settings ` +
          `(P180-01) and \`deploy.sh\` refuses a config.env that still has it — ` +
          `so this instruction breaks the installation of anybody who follows ` +
          `it. Name where the setting went instead.`,
      );
    }
  }
}

for (const entry of DOCUMENT_EXEMPT) {
  if (!exemptUsed.has(entry.file)) {
    problems.push(
      `${entry.file} is exempted from the documentation rule (${entry.why}) and ` +
        `no longer names any of the three. Delete the exemption — a dead one is ` +
        `how a check stops covering what it was written for.`,
    );
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
  `check-eiv-settings: ${String(configFiles.length)} config file(s), ` +
    `${String(sourceFiles.length)} source file(s) and ` +
    `${String(documents.length)} document(s) scanned, none assigns, reads or ` +
    `instructs setting EIV_WORKER_ENABLED, EIV_BASE_URL or EIV_ALLOW_LIVE`,
);
