/**
 * Every `run:` block in every workflow parses as a shell script (P193-01).
 *
 * ## Why this exists
 *
 * P189-01 shipped a `run:` step containing
 *
 *     ${said:-nothing beyond compose's own warnings}
 *
 * Inside `${parameter:-word}`, bash treats `'` as a quoting character **even
 * within double quotes**. The apostrophe in "compose's" opened a quote that
 * never closed, and the step died with
 *
 *     line 86: unexpected EOF while looking for matching `''
 *
 * It took the deploy with it — twice — and nothing in `pnpm verify` could have
 * noticed. `check:shell` runs shellcheck over `git ls-files '*.sh'`; a shell
 * script embedded in YAML is not a `.sh` file, so the largest and most
 * consequential shell scripts in this repository — the ones that deploy it —
 * were the only ones nothing checked.
 *
 * That is CLAUDE.md §9.1's third form: green because of what it is not
 * scanning.
 *
 * ## What it does, and what it deliberately does not
 *
 * `bash -n` on each step's script, with `${{ … }}` replaced first — GitHub
 * substitutes those before a shell ever sees them, so leaving them in would
 * report syntax errors that do not exist.
 *
 * It is a **parse**, not an execution: it catches unbalanced quotes, `if`
 * without `fi`, a stray `)`. It cannot catch a command that does not exist on
 * the runner or a variable that is empty at 3am. Those want their own checks,
 * and saying so here is the difference between a check and a claim.
 *
 * The verification that was skipped when P189 shipped was exactly this, done by
 * hand and done wrong: the payload was extracted from inside the `ssh "…"`
 * string and its backslashes stripped, which is not what bash receives. Running
 * the **whole step** is the only version that reproduces the failure.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const DIR = ".github/workflows";

/**
 * Below this, somebody has deleted the workflows or pointed this at the wrong
 * tree, and a check that reports success over nothing is worse than none.
 */
const MINIMUM_STEPS = 15;

/**
 * Every `run:` block, with the line it starts on.
 *
 * Hand-parsed rather than through a YAML library, for one reason worth stating:
 * a dependency here would be a dependency of `pnpm verify`, and this file has
 * to keep working on a checkout that has not run `pnpm install`. The shape it
 * matches is narrow — `run: |` or `run: >` followed by an indented block — and
 * a `run:` written any other way is reported as unscanned rather than skipped
 * silently.
 */
function runBlocks(text, file) {
  const lines = text.split("\n");
  const blocks = [];
  let unscanned = 0;

  for (let i = 0; i < lines.length; i += 1) {
    // A single-line `run: cmd`. Quoted forms are left alone: YAML's own
    // escaping would have to be undone first, and getting that subtly wrong
    // would report syntax errors that are not there.
    const inline = /^\s*-?\s*run:\s+([^|>'"\s].*)$/u.exec(lines[i]);
    if (inline !== null) {
      blocks.push({ file, line: i + 1, script: inline[1] });
      continue;
    }
    if (/^\s*-?\s*run:\s+['"]/u.test(lines[i])) unscanned += 1;

    const opener = /^(\s*)-?\s*run:\s*([|>][-+]?)?\s*$/u.exec(lines[i]);
    if (opener === null || opener[2] === undefined) continue;

    const indent = opener[1].length;
    const body = [];
    let j = i + 1;
    for (; j < lines.length; j += 1) {
      const line = lines[j];
      if (line.trim() === "") {
        body.push("");
        continue;
      }
      const lead = line.length - line.trimStart().length;
      if (lead <= indent) break;
      body.push(line);
    }

    // Strip the common indent so the script reads as it will run.
    const margin = Math.min(
      ...body
        .filter((line) => line.trim() !== "")
        .map((l) => l.length - l.trimStart().length),
    );
    blocks.push({
      file,
      line: i + 1,
      script: body.map((line) => line.slice(margin)).join("\n"),
    });
    i = j - 1;
  }

  return { blocks, unscanned };
}

const files = readdirSync(DIR).filter((name) => /\.ya?ml$/u.test(name));
let steps = 0;
let unscanned = 0;
const failures = [];

for (const name of files) {
  const path = join(DIR, name);
  const found = runBlocks(readFileSync(path, "utf8"), path);
  unscanned += found.unscanned;

  for (const block of found.blocks) {
    steps += 1;
    /*
     * `${{ … }}` is GitHub's, not the shell's — it is replaced before bash sees
     * the script. Left in place it would be read as a `${…}` expansion of an
     * empty name and reported as a syntax error that cannot happen.
     */
    const script = block.script.replaceAll(/\$\{\{[^}]*\}\}/gu, "GITHUB_EXPRESSION");
    const result = spawnSync("bash", ["-n", "-c", script], { encoding: "utf8" });
    if (result.status !== 0) {
      failures.push(`${block.file}:${block.line}\n    ${(result.stderr ?? "").trim()}`);
    }
  }
}

if (steps < MINIMUM_STEPS) {
  console.error(
    `check-workflow-shell: only ${steps} run blocks found, expected at least ` +
      `${MINIMUM_STEPS}. The parser or the directory is wrong; refusing to ` +
      `report success over nothing.`,
  );
  process.exit(1);
}

if (failures.length > 0) {
  console.error("check-workflow-shell: these run: blocks are not valid shell\n");
  console.error(failures.join("\n\n"));
  process.exit(1);
}

console.log(
  `check-workflow-shell: ${steps} run block(s) in ${files.length} workflow(s) parse` +
    (unscanned > 0 ? `; ${unscanned} single-line run: not scanned` : ""),
);
