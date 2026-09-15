/**
 * Every gate in `pnpm verify` can stop a merge.
 *
 * ## The defect
 *
 * CLAUDE.md §9.11 states the rule in one direction:
 *
 *   > `pnpm verify` is the local equivalent of CI and must stay that way. A
 *   > check that runs only in CI is a check the person writing the code does
 *   > not run.
 *
 * That is P41-03, and it was fixed by adding `check:sdk` to `verify`. Nobody
 * then looked the other way, and **fifteen checks accumulated on the local side
 * that no workflow ran** — derived mechanically, not by eye, in P229-01:
 *
 *     check:i18n            check:copy             check:runtime-config
 *     check:egress          check:local-ports      check:focus-ring
 *     check:backlog         check:csp              check:seed-overwrites
 *     check:content-lock    check:eiv-settings     check:docs-commands
 *     check:aria-props      check:screen-intros    check:design-tokens
 *
 * A gate that only runs when somebody types `pnpm verify` is not a gate. It is
 * a suggestion, and `main` is protected by CI rather than by anyone's habits.
 * Among that list: `check:seed-overwrites`, which guards a seed silently
 * replacing an operator's typed course values on **every deploy** (§9.10b);
 * `check:csp`, which guards the class that blocked every video upload for
 * months (§9.13); `check:eiv-settings`, which is a §2 human-review area.
 *
 * This is §9.1's first form — *"the check is not run where the work happens"* —
 * except that here the work that matters is the **merge**, and the checks were
 * on the wrong side of it.
 *
 * ## Why a list in a workflow would not have been the fix
 *
 * Naming the twenty checks in `ci.yml` by hand reproduces the defect
 * `check-shell.mjs` was written for: *"This step used to name fourteen files
 * for shellcheck by hand … six scripts and six test files had never been
 * linted."* A hand-written list drifts silently from the thing it mirrors.
 *
 * So the checks have **one home**, `pnpm check:static`, and two callers —
 * `pnpm verify` and the workflow. §9.10b at the level of a script list. This
 * file is what makes that arrangement enforced rather than merely intended.
 *
 * ## What it asserts
 *
 * Every step of `pnpm verify` is reached by a workflow: directly by name, or
 * because it is inside `check:static` and a workflow runs `pnpm check:static`,
 * or because it is on the exemption list below — where an exemption carries the
 * CI step that covers it and why the spelling differs.
 */

import { readFileSync, globSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const scripts = pkg.scripts;

/**
 * Steps a workflow covers under a different name, each with the step that
 * covers it. Not a mute button: an entry names the CI step and is wrong the
 * moment that step is renamed, because then the reason no longer reads true —
 * which is a thing a person has to notice, and is still more than was happening
 * when nothing was written down at all.
 */
const COVERED_DIFFERENTLY = new Map([
  [
    "pnpm test:integration",
    "the `integration` job runs `pnpm test:integration:ci` — the same suite " +
      "through turbo, against the Postgres that job starts, rather than " +
      "through `run-integration.mjs` which brings up its own",
  ],
]);

function stepsOf(name) {
  const body = scripts[name];
  if (body === undefined) return null;
  return body.split("&&").map((step) => step.trim());
}

const verify = stepsOf("verify");
const staticChecks = stepsOf("check:static");

if (verify === null || verify.length < 5) {
  console.error(
    "check-ci-parity: parsed fewer than five steps out of `verify`, so this " +
      "run proves nothing. The script was renamed or the parser is broken.",
  );
  process.exit(1);
}
if (staticChecks === null || staticChecks.length < 5) {
  console.error(
    "check-ci-parity: parsed fewer than five steps out of `check:static`, so " +
      "a workflow running it would cover almost nothing and this check would " +
      "still pass. Refusing to agree.",
  );
  process.exit(1);
}

/**
 * A workflow with its comment lines removed.
 *
 * Written after this check's **first run went green for the wrong reason.**
 * `pnpm test:integration` is covered in CI as `pnpm test:integration:ci`, and
 * the boundary test below is written to tell those apart — but `ci.yml` line
 * 262 is a *comment* reading "`pnpm test:integration` is the developer's
 * command", and a backtick is not a name character, so the step looked
 * directly named and the exemption was never consulted.
 *
 * That is `check-deadlines`' defect from CLAUDE.md §11 — *"it was matching
 * prose in doc comments"* — and the third time in one lineage of checks
 * (`aria-props.mjs`, `screen-intros.mjs`, here). The shape, written down
 * again because apparently it needs to be: **a checker that greps a file is
 * reading the explanation as well as the instructions, and the explanation is
 * where the thing being looked for is most likely to be named.**
 *
 * Only **whole-line** comments are removed — a `#` at the start of a line,
 * after whitespace. That covers YAML comments and the shell comments inside
 * `run:` blocks, and it can never truncate a command, which a general "strip
 * from `#` to end of line" could do to a URL fragment or a flag.
 */
function withoutComments(yaml) {
  return yaml
    .split("\n")
    .map((line) => (/^\s*#/.test(line) ? "" : line))
    .join("\n");
}

const workflows = globSync(".github/workflows/*.yml");
const ci = workflows
  .map((file) => withoutComments(readFileSync(file, "utf8")))
  .join("\n");
if (workflows.length === 0 || ci.length === 0) {
  console.error("check-ci-parity: found no workflow files. The tree moved.");
  process.exit(1);
}

/**
 * Whether a workflow runs this exact command.
 *
 * The right-hand boundary is the point: without it `pnpm test` matches
 * `pnpm test:integration:ci`, and every step would look covered by the first
 * loosely-similar line in the file — §9.1's third form, a check green because
 * of what it is not really scanning.
 */
function namedInAWorkflow(step) {
  const at = ci.indexOf(step);
  if (at === -1) return false;
  const next = ci[at + step.length] ?? "\n";
  return !/[A-Za-z0-9:_@/-]/.test(next);
}

const runsStatic = namedInAWorkflow("pnpm check:static");
const problems = [];
const how = new Map();
const used = new Set();

for (const step of verify) {
  if (step === "pnpm check:static") {
    if (runsStatic) how.set(step, "named in a workflow");
    else
      problems.push(
        "`pnpm check:static` is in `verify` and in no workflow, so all " +
          `${staticChecks.length} checks inside it can be pushed past.`,
      );
    continue;
  }
  if (namedInAWorkflow(step)) {
    how.set(step, "named in a workflow");
    continue;
  }
  const reason = COVERED_DIFFERENTLY.get(step);
  if (reason !== undefined) {
    how.set(step, "covered differently");
    used.add(step);
    continue;
  }
  problems.push(
    `\`${step}\` is a step of \`pnpm verify\` that no workflow runs, so it ` +
      "cannot stop a merge. Put it inside `pnpm check:static`, name it in a " +
      "workflow, or add it to COVERED_DIFFERENTLY with the step that covers it.",
  );
}

/*
 * And the other direction, which is §9.11's original wording: a check named in
 * a workflow that `verify` does not reach is one the author cannot run before
 * pushing. `check:static` membership counts, since `verify` runs it.
 */
const reachedLocally = new Set([...verify, ...staticChecks]);
for (const match of ci.matchAll(/(?:^|\n)\s*run:\s*(pnpm check:[a-z:-]+)\s*(?:\n|$)/g)) {
  const step = match[1];
  if (!reachedLocally.has(step)) {
    problems.push(
      `\`${step}\` runs in a workflow and is not reachable from ` +
        "`pnpm verify`, so it fails ten minutes after a push instead of " +
        "before one (§9.11, P41-03).",
    );
  }
}

/*
 * An exemption nobody needs is the thing that turns a documented exception into
 * a mute button: it sits there reading as deliberate, and the next person adds
 * one beside it. So the list has to stay exactly as long as the set of steps
 * that genuinely need it.
 */
for (const [step, reason] of COVERED_DIFFERENTLY) {
  if (used.has(step)) continue;
  if (!verify.includes(step)) {
    problems.push(
      `COVERED_DIFFERENTLY names \`${step}\`, which is not a step of ` +
        "`pnpm verify` at all. Remove it.",
    );
    continue;
  }
  problems.push(
    `COVERED_DIFFERENTLY names \`${step}\` — "${reason}" — but a workflow ` +
      "runs it under its own name, so the exemption is unused. Remove it, or " +
      "the list stops meaning anything.",
  );
}

if (problems.length > 0) {
  console.error(`check-ci-parity: ${problems.length} problem(s)\n`);
  for (const problem of problems) console.error("  " + problem);
  process.exit(1);
}

const differently = [...how.values()].filter((v) => v === "covered differently").length;
console.log(
  `check-ci-parity: ${verify.length} verify step(s), of which ` +
    `${staticChecks.length} are inside \`check:static\` and run by ` +
    `${workflows.length} workflow(s); ${differently} covered under another ` +
    "name, none unreachable from a merge gate.",
);
