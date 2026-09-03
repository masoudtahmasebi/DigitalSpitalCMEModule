#!/usr/bin/env node
/**
 * `pnpm audit`, with a finding told apart from an unreachable registry
 * (P182-02).
 *
 * ## The failure this exists for
 *
 * CI on `main` went red on the merge of P179/P180 with every test, every
 * typecheck and every other static check green. The blocking step was
 * `pnpm audit --prod --audit-level=moderate`, and what it reported was:
 *
 *     ERR_SOCKET_TIMEOUT  request to
 *     https://registry.npmjs.org/-/npm/v1/security/audits/quick failed
 *
 * Four minutes of retries against npm, then a non-zero exit. No dependency had
 * changed in that commit.
 *
 * ## Why that is worse than a flaky step
 *
 * `pnpm audit` exits non-zero for **two unrelated reasons** — it found
 * something, and it could not ask — and the job could not tell them apart. So a
 * registry hiccup produced a red build that reads exactly like a real advisory,
 * which is the fastest possible route to somebody adding `|| true`.
 *
 * And it took the rest of the job with it. Seven checks ran after it in the
 * same job — configuration drift, the role matrix, tenant reads, outbound
 * deadlines, gitleaks — none of which touches the network, and all of which
 * were **skipped**. A registry outage silently disabled the secret scanner.
 * That is CLAUDE.md §9.1's third form: not green for the wrong reason, but red
 * for the wrong reason and *not running* what would have been evidence.
 *
 * ## The rule
 *
 * | Outcome | Exit | Why |
 * | --- | --- | --- |
 * | advisories at or above the floor | 1 | the gate doing its job |
 * | a clean report | 0 | |
 * | the registry could not be reached | 0, loudly | not evidence of anything |
 *
 * The third is the judgement call and it is deliberate. An unreachable registry
 * says nothing about the dependencies; blocking on it trades a real gate for a
 * flaky one, and a flaky gate gets removed. What it must not do is pass
 * *quietly* — so it prints a warning, emits a GitHub Actions `::warning::`
 * annotation that appears on the run, and says plainly that the audit did not
 * happen.
 *
 * The nightly `Dependency review` job and Dependabot both cover the case where
 * a whole day's audits could not run; this covers the ten minutes in which one
 * push could not reach npm.
 */

import { spawnSync } from "node:child_process";

const PRODUCTION_ONLY = process.argv.includes("--prod");
const FLOOR = "moderate";

/**
 * Severities at or above the floor, most severe first.
 *
 * Spelled out rather than compared with `>=` on a string: "high" > "critical"
 * alphabetically, and a gate that let critical advisories through while
 * blocking high ones would be the funniest possible way to fail.
 */
const BLOCKING = ["critical", "high", "moderate"];

const result = spawnSync(
  "pnpm",
  ["audit", "--json", ...(PRODUCTION_ONLY ? ["--prod"] : [])],
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
);

if (result.error !== undefined) {
  warn(`could not run pnpm audit: ${result.error.message}`);
  process.exit(0);
}

const stdout = result.stdout ?? "";
const stderr = result.stderr ?? "";

/**
 * The report, or `undefined` when the registry never answered.
 *
 * Parsing is the discriminator, and that is the point: `pnpm audit --json`
 * prints a JSON document when it got an answer, whatever that answer was, and
 * prints a stack trace when it did not. Deciding on the exit code alone is what
 * conflated the two.
 */
const report = parse(stdout);

if (report === undefined) {
  warn(
    "the npm advisory database could not be reached, so dependencies were NOT " +
      "audited on this run. This is not a finding and does not block — an " +
      "unreachable registry is evidence of nothing. It is also not a pass.\n" +
      indent(stderr.trim().split("\n").slice(0, 6).join("\n")),
  );
  process.exit(0);
}

const counts = report.metadata?.vulnerabilities ?? {};
const blocking = BLOCKING.map((severity) => [severity, Number(counts[severity] ?? 0)])
  .filter(([, count]) => count > 0)
  .map(([severity, count]) => `${String(count)} ${severity}`);

if (blocking.length === 0) {
  const scope = PRODUCTION_ONLY ? "production" : "all";
  console.log(`audit-dependencies: ${scope} dependencies clean at "${FLOOR}" and above`);
  process.exit(0);
}

console.error(
  `audit-dependencies: ${blocking.join(", ")} advisory/advisories at "${FLOOR}" ` +
    `or above in ${PRODUCTION_ONLY ? "production" : "all"} dependencies.\n`,
);

// The advisories themselves, so the log says which package rather than only how
// many — the number alone sends somebody to run the command again by hand.
for (const advisory of Object.values(report.advisories ?? {})) {
  if (!BLOCKING.includes(String(advisory.severity))) continue;
  console.error(
    `  ${String(advisory.severity).padEnd(8)} ${String(advisory.module_name)}  ` +
      `${String(advisory.title)}\n` +
      `           ${String(advisory.url ?? "")}`,
  );
}

process.exit(1);

function parse(text) {
  // pnpm prints one JSON document, but a warning line can precede it — so the
  // first `{` is where the report starts.
  const start = text.indexOf("{");
  if (start === -1) return undefined;
  try {
    return JSON.parse(text.slice(start));
  } catch {
    return undefined;
  }
}

function warn(message) {
  console.error(`audit-dependencies: ${message}`);
  // Visible on the run's summary page, not only in a log nobody opens.
  console.log(`::warning title=Dependency audit did not run::${message.split("\n")[0]}`);
}

function indent(text) {
  return text
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");
}
