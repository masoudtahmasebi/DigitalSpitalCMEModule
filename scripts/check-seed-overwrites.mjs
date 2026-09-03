/**
 * A seed may not overwrite a value an operator typed (P171-02).
 *
 * ## The defect this exists for
 *
 * `deploy.sh` runs the seeds on **every deploy**. `medice-adhs.ts` upserts the
 * MEDICE course with `ON CONFLICT (project_id, slug) DO UPDATE SET …`, and
 * three of the assignments in that clause were unconditional:
 *
 *     title        = EXCLUDED.title,
 *     cme_points   = EXCLUDED.cme_points,
 *     cme_category = EXCLUDED.cme_category,
 *
 * So an operator who set the course to 10 CME-Punkte in Verwaltung got the
 * seed's 4 back on the next deploy. Silently: an UPDATE writing a different
 * valid value is not an error anywhere, the deploy is green, and the only
 * evidence is a number on a certificate weeks later. It was found exactly that
 * way — the client's Zertifizierung tab showed "mit 10 CME-Punkten
 * akkreditiert" three lines above "mit 4 Punkten (Kategorie D) anrechenbar".
 *
 * ## Why a script and not another assertion
 *
 * There **was** an assertion. `seeds.integration.test.ts` has covered this
 * since P108-01, under a comment claiming *"every field an operator can edit in
 * Verwaltung is asserted here together, so a field added to the DO UPDATE later
 * has to delete a named case to pass"*. That claim was false for three fields
 * for four months, and the claim is precisely what stopped anybody looking —
 * CLAUDE.md §9.1's second form, a check that silently covers less than it says.
 *
 * A list maintained by hand cannot be the guard for "did somebody add a field
 * to a list by hand". So this derives both sides:
 *
 *   * **what an operator can edit** — the keys of `adminCourseUpdateSchema`,
 *     mapped to their columns by the same camel→snake rule the Drizzle schema
 *     uses (CLAUDE.md §5);
 *   * **what the seeds assign unconditionally** — every `column = EXCLUDED.…`
 *     in an `ON CONFLICT … DO UPDATE SET` clause, ignoring assignments wrapped
 *     in `COALESCE(`, a `CASE` or any other reference to the existing row.
 *
 * An overlap is the defect. There is nothing to configure and nothing to keep
 * in step.
 *
 * ## What is deliberately not checked
 *
 * `ds-demo.ts`. That tenant is a fixture whose whole purpose is to be restored
 * to a known state — the client's own rule, P165-01: *"seed should be only on
 * ds tenant, not medice."* Restoring a demo course is the feature; restoring a
 * customer's is the bug. The allow-list below is by **file**, so a new seed for
 * a real customer is checked from the moment it exists.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Seeds whose job is to restore a fixture tenant to a known state. */
const FIXTURE_SEEDS = new Set(["packages/seed/src/ds-demo.ts"]);

const SEED_FILES = [
  "packages/seed/src/medice-adhs.ts",
  "packages/seed/src/ds-demo.ts",
  "packages/seed/src/ds-default.ts",
];

const DTO = "apps/api/src/modules/admin/admin.dto.ts";

/** `cmePoints` → `cme_points`, the one mapping rule this repository uses. */
function toColumn(key) {
  return key.replace(/[A-Z]/gu, (c) => `_${c.toLowerCase()}`);
}

/**
 * The keys of `adminCourseUpdateSchema`.
 *
 * Read from the source rather than by importing it: this script runs before
 * anything is built, and a check that needs a build is a check the person
 * writing the code does not run (§9.11).
 */
function editableColumns() {
  const source = readFileSync(join(REPO, DTO), "utf8");
  const start = source.indexOf("export const adminCourseUpdateSchema = z.object({");
  if (start === -1) throw new Error(`${DTO}: adminCourseUpdateSchema not found`);

  // To the closing `});` of that object literal, which is the first line that
  // begins at column 0 with `});`.
  const end = source.indexOf("\n});", start);
  if (end === -1) throw new Error(`${DTO}: adminCourseUpdateSchema is not closed`);

  const body = source.slice(start, end);
  const keys = new Set();
  // A key is `name: z.` or `name: percent`, at the object's own indent level.
  for (const match of body.matchAll(/^ {2}([A-Za-z][A-Za-z0-9]*):/gmu)) {
    keys.add(toColumn(match[1]));
  }
  if (keys.size === 0) throw new Error(`${DTO}: no keys parsed — the shape changed`);
  return keys;
}

/**
 * Every `column = EXCLUDED.…` assigned with no reference to the existing row.
 *
 * The parse is deliberately blunt: an assignment counts as guarded if its
 * right-hand side mentions the table name at all, which covers
 * `COALESCE(courses.x, EXCLUDED.x)` and every `CASE WHEN … courses.x …` form
 * in these files. A guard the parse cannot see fails **closed** — it is
 * reported, and the fix is to write it in a form a reader can see too.
 */
function unconditionalAssignments(file) {
  /*
   * Comments come out **first**, and that is not tidiness (§9.1).
   *
   * The first version of this parser matched up to the next backtick, on the
   * reasoning that a backtick ends the SQL template literal. Every clause in
   * these files is preceded by a long explanatory comment, and those comments
   * quote identifiers `like this` — so the capture ended inside the comment,
   * before a single assignment, and the check reported "0 unconditional
   * assignments" on a seed that had three. It was watched red only because it
   * refused to go red: two deliberate sabotages both passed.
   *
   * So: strip block and line comments, then parse. A clause whose assignments
   * cannot be parsed at all is reported rather than skipped — see below.
   */
  const source = readFileSync(join(REPO, file), "utf8")
    .replaceAll(/\/\*[\s\S]*?\*\//gu, " ")
    .replaceAll(/--[^\n]*/gu, " ");
  const found = [];
  let clauses = 0;

  for (const clause of source.matchAll(
    /ON CONFLICT[^;`]*?DO UPDATE SET([\s\S]*?)(?:RETURNING|`)/giu,
  )) {
    const body = clause[1];
    clauses += 1;

    /*
     * Split on the commas that separate assignments — the ones outside any
     * parentheses. Anchoring on line starts was the second thing this parser
     * got wrong: `slug = EXCLUDED.slug, name = EXCLUDED.name` is one line in
     * two of these files, and a line-anchored regex read zero assignments from
     * it. Depth-aware splitting handles both shapes and `COALESCE(a, b)` with
     * them.
     */
    const parts = [];
    let depth = 0;
    let current = "";
    for (const char of body) {
      if (char === "(") depth += 1;
      if (char === ")") depth -= 1;
      if (char === "," && depth === 0) {
        parts.push(current);
        current = "";
        continue;
      }
      current += char;
    }
    parts.push(current);

    let assignmentsSeen = 0;
    for (const part of parts) {
      const assignment = /^\s*([a-z_]+)\s*=\s*([\s\S]+)$/iu.exec(part);
      if (assignment === null) continue;
      assignmentsSeen += 1;
      const column = assignment[1];
      const value = assignment[2];
      if (!/EXCLUDED\./iu.test(value)) continue;
      // Guarded if the existing row is named anywhere on the right.
      if (/\bcourses\./iu.test(value)) continue;
      found.push({ column, value: value.trim().replace(/\s+/gu, " ") });
    }

    /*
     * Fail closed. A clause the parser cannot read is a clause this check is
     * not checking, and the version of that mistake this file exists to prevent
     * is exactly "it printed a reassuring number while seeing nothing".
     */
    if (assignmentsSeen === 0 && body.trim().length > 0) {
      throw new Error(
        `${file}: an ON CONFLICT DO UPDATE clause was found but no assignment in it ` +
          `could be parsed — the check would pass without looking:\n${body.trim().slice(0, 300)}`,
      );
    }
  }

  return found;
}

const editable = editableColumns();
const problems = [];
let checked = 0;
let guarded = 0;

for (const file of SEED_FILES) {
  if (FIXTURE_SEEDS.has(file)) continue;
  for (const { column, value } of unconditionalAssignments(file)) {
    checked += 1;
    if (editable.has(column)) {
      problems.push(`  ${relative(REPO, file)}: ${column} = ${value}`);
    } else {
      guarded += 1;
    }
  }
}

if (problems.length > 0) {
  console.error(
    "check-seed-overwrites: a seed overwrites a field an operator can edit\n\n" +
      problems.join("\n") +
      "\n\n" +
      "  Every deploy runs the seeds, so this replaces what somebody typed in\n" +
      "  Verwaltung with what is compiled into the seed — silently, on a green\n" +
      "  deploy. Write it as COALESCE(courses.<column>, EXCLUDED.<column>) so\n" +
      "  the seed supplies a starting value and never a replacement.\n",
  );
  process.exit(1);
}

console.log(
  `check-seed-overwrites: ${String(editable.size)} operator-editable column(s), ` +
    `${String(checked)} unconditional assignment(s) in customer seeds, none of them editable`,
);
