/**
 * A backlog file's ticket number is the one in its name (P160-01).
 *
 * ## What went wrong
 *
 * Two sessions on 02.09.2026 each filed a ticket, each picked the next free
 * number in `docs/backlog/`, and both picked the same one. The collision was
 * invisible until a merge: git took two files that had both created
 * `docs/backlog/P158.md` and concatenated them, so one path now holds two
 * unrelated work orders whose commits both read `DEP-P158`. Prettier caught the
 * missing blank line between them and CI went red; nothing at all caught the
 * two tickets.
 *
 * The other session had already hit the same thing an hour earlier and fixed it
 * by hand: its work was filed as `P156.md`, PR #45 took that number, and the
 * file was renamed to `P158.md` with the heading edited to match. That rename is
 * the step this check makes non-optional — a file renamed with the heading left
 * behind is a ticket that answers to two numbers, and CLAUDE.md §10's warning
 * about two numbering schemes sharing one prefix has this as its sibling.
 *
 * ## The two rules
 *
 * 1. **Every backlog file carries at least one `# P<N> — ` heading.** A ticket
 *    with no heading of that shape is not addressable from a commit message.
 * 2. **Every such heading's number matches the filename.** `P156.md` may not
 *    contain `# P158 — …`, whichever of the two was edited last.
 *
 * Deliberately *not* a rule: one heading per file. `P158.md` genuinely holds
 * two tickets, because two sets of commits already say `DEP-P158` and no rename
 * reaches into history. Making that an error would mean shipping this check
 * with an exemption on the day it was written, which is the shape §9.1 warns
 * about. What the check enforces is that a number always means one file — not
 * that a file always means one number.
 *
 * Run by `pnpm verify` and by CI.
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const BACKLOG = join(REPO, "docs/backlog");

/** `P41.md`, `P118.md` — the ticket files. `README.md` is not one. */
const FILE_NAME = /^P(\d+)\.md$/u;

/**
 * `# P41 — the thing that broke`, and the original epics' `# Epic P0 · … `.
 * Both name a ticket; the epics were written before the `—` convention and
 * renaming their headings now would break nothing and prove nothing.
 */
const HEADING = /^# (?:Epic )?P(\d+)\b/u;

const problems = [];
let files = 0;
let headings = 0;

for (const name of readdirSync(BACKLOG).sort()) {
  const named = FILE_NAME.exec(name);
  if (named === null) continue;
  files += 1;

  const expected = named[1];
  const lines = readFileSync(join(BACKLOG, name), "utf8").split("\n");
  let found = 0;

  for (const [index, line] of lines.entries()) {
    const heading = HEADING.exec(line);
    if (heading === null) continue;
    found += 1;
    headings += 1;
    if (heading[1] !== expected) {
      problems.push(
        `${name}:${index + 1}: heading says P${heading[1]}, the file says P${expected}` +
          ` — one of the two is a rename that stopped half way`,
      );
    }
  }

  if (found === 0) {
    problems.push(
      `${name}: no "# P${expected} — …" heading, so no commit message can point at it`,
    );
  }
}

if (files === 0) {
  console.error("check-backlog-numbers: no backlog files found — wrong path?");
  process.exit(1);
}

if (problems.length > 0) {
  console.error("check-backlog-numbers: a ticket answers to more than one number\n");
  for (const problem of problems) console.error(`  ${problem}`);
  console.error(`\n${problems.length} problem(s) across ${files} backlog file(s).`);
  process.exit(1);
}

console.log(
  `check-backlog-numbers: ${headings} heading(s) in ${files} backlog file(s), every number matches its filename`,
);
