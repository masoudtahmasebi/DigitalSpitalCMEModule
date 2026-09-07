/**
 * A variable a workflow sets reaches the turbo task that reads it (P206-03).
 *
 * ## The failure this exists for
 *
 * `.github/workflows/ci.yml` sets `INTEGRATION_RESET: "1"` on the integration
 * job, with a comment explaining that the suites "ask for this explicitly" so
 * that the same command at a developer's terminal cannot empty the database
 * they develop against. The job then runs `pnpm test:integration:ci`, which is
 * `turbo run test:integration`.
 *
 * Turbo 2 runs tasks in **strict** environment mode: a task sees only the
 * variables its `env` / `passThroughEnv` list declares, plus turbo's own system
 * set. `INTEGRATION_RESET` was not declared, so the variable the workflow set,
 * commented and relied on was `undefined` by the time vitest read it — and
 * `requested()` fell through to its other branch, which asks whether the
 * database name ends in `_test`. In CI it is `ds_education`. It does not.
 *
 * So P32-02's per-file truncation — written because "file eleven still saw
 * whatever files one to ten had written", and because the suite passed twice
 * and failed on the third run — **has never run in CI**. It runs at a
 * developer's terminal, where the database is named `ds_education_test` and the
 * other branch answers true, which is why nobody noticed. Every green CI run
 * since is a run of a suite that was not doing the thing its setup file says it
 * does, and the comment in ci.yml asserting "CI supplies the flag in the
 * workflow" was a sentence, not a mechanism (CLAUDE.md §9.9's corollary).
 *
 * It surfaced when P206-02 added a rate-limit reset to the same setup file
 * under the same gate: green locally, red in CI on a case four hundred lines
 * from the change, with `expected 429 to be 409`.
 *
 * ## What this checks
 *
 * For every workflow job that sets job-level `env:` **and** runs a `pnpm`
 * script that resolves to `turbo run <task>`, every variable that job sets must
 * be declared for that task — in the task's own `env` or `passThroughEnv`, or
 * in `globalEnv` / `globalPassThroughEnv`. Anything else is a variable the
 * workflow believes it is passing and turbo will strip.
 *
 * It cannot check the reverse — a variable declared in turbo.json that nothing
 * reads — and does not try. This is the direction that fails silently.
 *
 * Hand-parsed rather than through a YAML library, for the reason
 * `check-workflow-shell.mjs` gives: a dependency here would be a dependency of
 * `pnpm verify`, and this has to work on a checkout that has not installed.
 */

import { readFileSync } from "node:fs";

const WORKFLOWS = [".github/workflows/ci.yml", ".github/workflows/deploy.yml"];

/**
 * Below this, the parser has stopped matching the workflows' shape and is
 * reporting success over nothing — §9.1's third form, which is the failure this
 * script is about.
 */
const MINIMUM_PAIRS = 1;
const MINIMUM_VARIABLES = 4;

/** Turbo passes these through in strict mode without being asked. */
const SYSTEM =
  /^(?:CI|PATH|HOME|SHELL|TZ|TERM|LANG|LC_[A-Z_]+|NODE_ENV|GITHUB_[A-Z_]+|RUNNER_[A-Z_]+|TURBO_[A-Z_]+|VERCEL_[A-Z_]+)$/u;

const turbo = JSON.parse(readFileSync("turbo.json", "utf8"));
const rootScripts = JSON.parse(readFileSync("package.json", "utf8")).scripts ?? {};

/** Every variable turbo will let `task` see, beyond the system set. */
function declaredFor(task) {
  const own = turbo.tasks?.[task] ?? {};
  return new Set([
    ...(turbo.globalEnv ?? []),
    ...(turbo.globalPassThroughEnv ?? []),
    ...(own.env ?? []),
    ...(own.passThroughEnv ?? []),
  ]);
}

/**
 * The turbo tasks a root script runs, following one level of `pnpm <script>`.
 *
 * `test:integration:ci` is `turbo run test:integration`; the workflow calls the
 * former and the task named in turbo.json is the latter, which is exactly the
 * indirection that makes this hard to see by reading.
 */
function tasksOf(script, seen = new Set()) {
  if (seen.has(script)) return [];
  seen.add(script);
  const body = rootScripts[script];
  if (body === undefined) return [];

  const tasks = [...body.matchAll(/turbo\s+run\s+([\w:.-]+)/gu)].map((m) => m[1]);
  for (const next of body.matchAll(/pnpm\s+(?:run\s+)?([\w:.-]+)/gu)) {
    tasks.push(...tasksOf(next[1], seen));
  }
  return tasks;
}

/**
 * Jobs, each with the variables it sets and the `pnpm` scripts it runs.
 *
 * The shape matched is narrow on purpose: a job is a two-space key under
 * `jobs:`, its `env:` is a four-space key, and its variables are six-space
 * `NAME: value` lines. Anything else is not recognised, which the minimum
 * counts above turn into a failure rather than a pass.
 */
function jobs(text) {
  const found = [];
  let job;
  let inEnv = false;

  for (const line of text.split("\n")) {
    const start = /^ {2}([A-Za-z0-9_-]+):\s*$/u.exec(line);
    if (start !== null) {
      job = { name: start[1], variables: [], scripts: [] };
      found.push(job);
      inEnv = false;
      continue;
    }
    if (job === undefined) continue;

    if (/^ {4}env:\s*$/u.test(line)) {
      inEnv = true;
      continue;
    }
    if (inEnv) {
      const variable = /^ {6}([A-Za-z_][A-Za-z0-9_]*):/u.exec(line);
      if (variable !== null) {
        job.variables.push(variable[1]);
        continue;
      }
      if (line.trim() !== "" && !line.startsWith("      ")) inEnv = false;
    }

    for (const call of line.matchAll(/pnpm\s+(?:run\s+)?([\w:.-]+)/gu)) {
      job.scripts.push(call[1]);
    }
  }
  return found;
}

const problems = [];
let pairs = 0;
let variables = 0;

for (const path of WORKFLOWS) {
  for (const job of jobs(readFileSync(path, "utf8"))) {
    if (job.variables.length === 0) continue;

    const tasks = new Set(job.scripts.flatMap((script) => tasksOf(script)));
    for (const task of tasks) {
      pairs += 1;
      const declared = declaredFor(task);
      for (const name of job.variables) {
        if (SYSTEM.test(name)) continue;
        variables += 1;
        if (declared.has(name)) continue;
        problems.push(
          `${path} job "${job.name}" sets ${name}, but turbo task "${task}" ` +
            `does not declare it — strict mode will strip it before the task runs`,
        );
      }
    }
  }
}

if (pairs < MINIMUM_PAIRS || variables < MINIMUM_VARIABLES) {
  console.error(
    `check-turbo-env: found ${pairs} job/task pair(s) and ${variables} variable(s), ` +
      `expected at least ${MINIMUM_PAIRS} and ${MINIMUM_VARIABLES}. The parser has ` +
      `stopped matching the workflows — fix it rather than lowering the floor.`,
  );
  process.exit(1);
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`check-turbo-env: ${problem}`);
  process.exit(1);
}

console.log(
  `check-turbo-env: ${variables} workflow variable(s) across ${pairs} job/task pair(s), ` +
    `every one declared where turbo will pass it through`,
);
