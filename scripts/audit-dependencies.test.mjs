#!/usr/bin/env node
/**
 * The audit wrapper's two branches, driven with a stubbed `pnpm` (P182-02).
 *
 * The whole value of `audit-dependencies.mjs` is that it tells "the registry
 * did not answer" apart from "there is an advisory" — and those are exactly the
 * two states that are inconvenient to produce on demand. So `pnpm` is stubbed
 * on `PATH` and made to behave like each of them in turn.
 *
 * Without this the wrapper would be a §9.1 gate: one that has never been seen
 * to block, and whose "do not block on a network failure" branch is one typo
 * away from never blocking at all.
 */

import { mkdtempSync, writeFileSync, chmodSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("./audit-dependencies.mjs", import.meta.url));

let passed = 0;
let failed = 0;

/** Runs the wrapper with a `pnpm` that prints `stdout` and exits `code`. */
function withStubbedPnpm(stdout, stderr, code) {
  const dir = mkdtempSync(join(tmpdir(), "ds-audit-"));
  const stub = join(dir, "pnpm");

  writeFileSync(
    stub,
    `#!/usr/bin/env bash\ncat <<'OUT'\n${stdout}\nOUT\ncat >&2 <<'ERR'\n${stderr}\nERR\nexit ${code}\n`,
  );
  chmodSync(stub, 0o755);

  return spawnSync(process.execPath, [SCRIPT, "--prod"], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${dir}:${process.env["PATH"] ?? ""}` },
  });
}

function check(what, actual, expected) {
  if (actual === expected) {
    passed += 1;
  } else {
    console.error(`FAIL  ${what}: expected ${String(expected)}, got ${String(actual)}`);
    failed += 1;
  }
}

// ---------------------------------------------------------------------------
// A finding blocks.
// ---------------------------------------------------------------------------
{
  const report = JSON.stringify({
    advisories: {
      1: {
        severity: "high",
        module_name: "left-pad",
        title: "Prototype pollution",
        url: "https://example.invalid/advisory/1",
      },
    },
    metadata: { vulnerabilities: { critical: 0, high: 1, moderate: 0, low: 3 } },
  });

  const run = withStubbedPnpm(report, "", 1);
  check("a high advisory exits 1", run.status, 1);
  check(
    "and names the package rather than only the count",
    run.stderr.includes("left-pad"),
    true,
  );
}

// ---------------------------------------------------------------------------
// A clean report passes.
// ---------------------------------------------------------------------------
{
  const report = JSON.stringify({
    advisories: {},
    metadata: { vulnerabilities: { critical: 0, high: 0, moderate: 0, low: 2 } },
  });

  // Exit 1 with a clean report is what pnpm does for `low` findings under a
  // `moderate` floor — the wrapper must judge the report, not the exit code.
  const run = withStubbedPnpm(report, "", 1);
  check("low-severity findings below the floor exit 0", run.status, 0);
}

// ---------------------------------------------------------------------------
// An unreachable registry does not block, and does not go quiet.
// ---------------------------------------------------------------------------
{
  const run = withStubbedPnpm(
    "",
    "ERR_SOCKET_TIMEOUT  request to https://registry.npmjs.org/... failed",
    1,
  );

  check("an unreachable registry exits 0", run.status, 0);
  check(
    "and says the audit did not happen",
    run.stderr.includes("NOT") && run.stderr.includes("audited"),
    true,
  );
  check(
    "and annotates the run rather than only the log",
    run.stdout.includes("::warning"),
    true,
  );
  check(
    "and never claims the dependencies are clean",
    run.stdout.includes("clean"),
    false,
  );
}

// ---------------------------------------------------------------------------
// Output that is not a report at all is treated as "could not ask", never as a
// pass — the safe reading when the discriminator itself fails.
// ---------------------------------------------------------------------------
{
  const run = withStubbedPnpm("<html>502 Bad Gateway</html>", "", 1);
  check("a non-JSON body does not block", run.status, 0);
  check(
    "and is reported as not audited",
    run.stderr.includes("could not be reached"),
    true,
  );
}

// ---------------------------------------------------------------------------
// `critical` is above the floor. The alphabetical trap, spelled out.
// ---------------------------------------------------------------------------
{
  const report = JSON.stringify({
    advisories: {
      9: {
        severity: "critical",
        module_name: "boom",
        title: "Remote code execution",
        url: "",
      },
    },
    metadata: { vulnerabilities: { critical: 1, high: 0, moderate: 0, low: 0 } },
  });

  const run = withStubbedPnpm(report, "", 1);
  check("a critical advisory exits 1", run.status, 1);
}

console.log(
  `audit-dependencies.test: ${String(passed)} passed, ${String(failed)} failed`,
);
process.exit(failed === 0 ? 0 : 1);
