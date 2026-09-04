#!/usr/bin/env node
/**
 * Anything that runs `docker compose` against the stack loads the host's
 * secrets first (P194-04).
 *
 * ## Why this check exists
 *
 * `docker-compose.prod.yml` interpolates `${SECRETS_KMS_KEY:?…}`, and the `:?`
 * form aborts compose **while it parses the file** — before it looks at which
 * service the command names. So a caller that loaded only `config.env` cannot
 * run `ps`, `exec`, `logs` or `config`; every one of them dies identically with
 * an error about a variable the caller never mentions.
 *
 * That is invisible three ways at once, which is why it survived:
 *
 *   * the code that has the bug does not name the variable it is missing;
 *   * the error arrives on stderr, and every one of these callers redirects it
 *     away so a transient docker failure cannot kill a report;
 *   * what is left is an empty answer, which reads as "nothing to report".
 *
 * Deploys 115–118 failed closed and skipped the post-deploy journey for this,
 * with the reason discarded for the first three (P189-01). `watchdog.sh` had
 * it too: its container census swallowed the error into `|| true` and iterated
 * over nothing, so a host with every container down produced no problem from
 * check 1 (P194-01).
 *
 * ## What it asserts
 *
 * For every shell script and every workflow `run:` block that invokes
 * `docker compose` against the production compose file: the same file must also
 * load the host environment — `ds_load_host_env`, `ds_ensure_secrets`, or a
 * direct `secrets.env` source.
 *
 * ## What it deliberately does not cover
 *
 * It is a text check, not an execution. It cannot tell that the load *precedes*
 * the call, and it cannot see a caller that shells out to something else which
 * then runs compose. What it does catch is the whole observed class: a second
 * reader that reproduced half of what `deploy.sh` does.
 *
 * `*.test.sh` is excluded — those parse the compose file rather than driving a
 * stack, and requiring a fixture to source a host's real secrets would be the
 * opposite of what they are for.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

/*
 * Two patterns, both required, because the file is rarely named at the call.
 * `deploy.sh` and `watchdog.sh` both do
 *
 *     COMPOSE_FILE="${SCRIPT_DIR}/docker-compose.prod.yml"
 *     compose() { docker compose -f "$COMPOSE_FILE" "$@"; }
 *
 * so a pattern matching only `docker compose -f …docker-compose.prod.yml`
 * finds neither — it reported two callers and claimed to cover the class,
 * which is the §9.1 shape this whole ticket is about. Requiring the two
 * separately catches the indirection without resolving shell variables.
 */
const COMPOSE_CALL = /docker\s+compose\s+(?:-f|--file)\s/;
const PROD_STACK = /docker-compose\.prod\.yml/;
const LOADS_ENV = /ds_load_host_env|ds_ensure_secrets|secrets\.env/;

/** Strip `#` comments so a compose command quoted in a header is not a call. */
function stripComments(text) {
  return text
    .split("\n")
    .map((line) => (/^\s*#/.test(line) ? "" : line))
    .join("\n");
}

const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" })
  .split("\n")
  .filter(Boolean);

const failures = [];
let checked = 0;

// --- shell scripts ---------------------------------------------------------
for (const path of tracked) {
  if (!/^infra\/.*(\.sh|\/dsc)$/.test(path)) continue;
  if (path.endsWith(".test.sh")) continue;
  const body = stripComments(readFileSync(path, "utf8"));
  if (!COMPOSE_CALL.test(body) || !PROD_STACK.test(body)) continue;
  checked += 1;
  if (!LOADS_ENV.test(body)) {
    failures.push(
      `${path} runs docker compose against docker-compose.prod.yml but never ` +
        `loads secrets.env — source host-env.sh and call ds_load_host_env.`,
    );
  }
}

// --- workflow run blocks ---------------------------------------------------
//
// Per block, not per file: two steps in one workflow are two callers, and the
// step that loaded the environment does not help the step that did not — each
// `run:` is its own shell.
for (const path of tracked) {
  if (!/^\.github\/workflows\/.*\.ya?ml$/.test(path)) continue;
  const lines = readFileSync(path, "utf8").split("\n");
  let block = null;
  const blocks = [];
  for (const line of lines) {
    const start = line.match(/^(\s*)-?\s*run:\s*\|?\s*(.*)$/);
    if (start) {
      if (block) blocks.push(block);
      block = { indent: start[1].length, line: lines.indexOf(line), text: start[2] };
      continue;
    }
    if (!block) continue;
    if (line.trim() === "") {
      block.text += "\n";
      continue;
    }
    const indent = line.length - line.trimStart().length;
    if (indent <= block.indent) {
      blocks.push(block);
      block = null;
      continue;
    }
    block.text += "\n" + line;
  }
  if (block) blocks.push(block);

  for (const b of blocks) {
    const body = stripComments(b.text);
    if (!COMPOSE_CALL.test(body) || !PROD_STACK.test(body)) continue;
    checked += 1;
    if (!LOADS_ENV.test(body)) {
      failures.push(
        `${path}: a run: block runs docker compose against ` +
          `docker-compose.prod.yml without loading secrets.env. Call one of the ` +
          `scripts in infra/deploy/ instead of assembling the connection here.`,
      );
    }
  }
}

if (failures.length > 0) {
  for (const f of failures) console.error(`check-compose-env: ${f}`);
  console.error(
    `\ncheck-compose-env: ${failures.length} caller(s) cannot reach the stack.`,
  );
  process.exit(1);
}

console.log(`check-compose-env: ${checked} compose caller(s) load the host environment`);
