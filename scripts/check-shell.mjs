#!/usr/bin/env node
/**
 * Every shell script is linted and every shell test is run — locally, the same
 * way CI does it (P182-08).
 *
 * ## The failure
 *
 * `pnpm check:shell` was `for t in infra/deploy/*.test.sh; do "$t"; done`. CI's
 * step of the **same name** ran shellcheck first, over a hand-written list of
 * files, and then those tests. So a `pnpm verify` that passed said nothing
 * about shellcheck, and P182-07 went to CI with an `SC2006` in a message
 * string — backticks around a table name inside a `die`, which shellcheck reads
 * as a command substitution.
 *
 * That is CLAUDE.md §9.1's first form exactly: **the check is not run where the
 * work happens.** The two commands shared a name, which is what made it
 * invisible — the local one is what a person runs, and it covered less.
 *
 * ## And the list was the second form
 *
 * CI's shellcheck line named fourteen files by hand. The repository has 27
 * tracked `.sh` files plus `dsc`. So `eiv-endpoint.sh`, `watchdog.sh`,
 * `release-guards.sh`, `caddy-config.sh`, `backup-state.sh` and six test
 * scripts had never been linted at all — including two written today. A
 * hand-maintained list of files to check is a list that stops matching the
 * directory, silently, the first time somebody adds a file.
 *
 * Both halves are fixed by deriving the list from git and running one command
 * in both places: CI now installs shellcheck and calls this.
 *
 * ## Why a missing shellcheck is an error and not a skip
 *
 * A skip is how a gate becomes decorative. If it cannot lint, it says so and
 * fails, with the line to install it — the same standard `test:wp` holds for
 * `php`.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

/**
 * A floor, so a broken glob cannot make this green by checking nothing.
 * `git ls-files '*.sh'` returned 27 when this was written.
 */
const MINIMUM_SCRIPTS = 25;

function tracked(pattern) {
  return execFileSync("git", ["ls-files", pattern], { cwd: root, encoding: "utf8" })
    .split("\n")
    .filter((line) => line !== "");
}

/*
 * `dsc` has no extension — it is a command an operator types, not a file they
 * source — so the glob misses it and it is named. It is the only one; anything
 * else without `.sh` should get the extension rather than a line here.
 */
const scripts = [...tracked("*.sh"), "infra/deploy/dsc"].filter((file) =>
  existsSync(new URL(file, `file://${root}`)),
);

if (scripts.length < MINIMUM_SCRIPTS) {
  console.error(
    `check-shell: found ${String(scripts.length)} shell scripts, expected at ` +
      `least ${String(MINIMUM_SCRIPTS)}. The file list is broken, not the repository.`,
  );
  process.exit(1);
}

if (spawnSync("shellcheck", ["--version"], { stdio: "ignore" }).status !== 0) {
  console.error(
    "check-shell: shellcheck is not installed, and this refuses to skip it.\n\n" +
      "  Debian/Ubuntu   sudo apt-get install -y shellcheck\n" +
      "  macOS           brew install shellcheck\n\n" +
      "A shell defect reaches production through a deploy script, which is the\n" +
      "one place with no test between the code and the customer's data.",
  );
  process.exit(1);
}

/*
 * `-x` follows `source`, which is the whole point here: `deploy.sh` sources
 * `eiv-endpoint.sh` and `watchdog.sh` sources `backup-state.sh`, and a function
 * checked without its caller is checked in the wrong context.
 *
 * Run from each file's own directory so a relative `source` resolves — the same
 * reason CI's line wrapped its invocation in `(cd infra/deploy && …)`.
 *
 * UTF-8 forced: shellcheck writes its own report through the locale's encoding
 * and dies with `commitBuffer: invalid argument` under `LC_ALL=C` the moment a
 * finding quotes a line containing an em dash. Every message string in
 * `deploy.sh` contains one.
 */
let failures = 0;

for (const file of scripts) {
  const slash = file.lastIndexOf("/");
  const dir = slash === -1 ? root : new URL(`${file.slice(0, slash)}/`, `file://${root}`);
  const name = slash === -1 ? file : file.slice(slash + 1);

  const result = spawnSync("shellcheck", ["-x", name], {
    cwd: dir,
    stdio: "inherit",
    env: { ...process.env, LC_ALL: "C.UTF-8", LANG: "C.UTF-8" },
  });
  if (result.status !== 0) failures += 1;
}

if (failures > 0) {
  console.error(`\ncheck-shell: shellcheck failed on ${String(failures)} file(s).`);
  process.exit(1);
}

// Then the behaviour tests, which is what this script used to be.
const tests = tracked("infra/deploy/*.test.sh");
for (const test of tests) {
  const result = spawnSync(new URL(test, `file://${root}`).pathname, [], {
    cwd: root,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    console.error(`\ncheck-shell: ${test} failed.`);
    process.exit(1);
  }
}

console.log(
  `\ncheck-shell: ${String(scripts.length)} script(s) linted, ` +
    `${String(tests.length)} shell test file(s) passed`,
);
