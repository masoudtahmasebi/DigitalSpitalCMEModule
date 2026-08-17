/**
 * The rule, run over the real files (P81-02).
 *
 * ## Why this file exists
 *
 * `index.test.ts` exercises `stripTransactionControl` exhaustively — against
 * strings written in the test. It would have been green on a repository whose
 * `db/migrations/` directory was entirely malformed, because nothing there
 * reads the directory. That is CLAUDE.md §9.7 exactly: a rule tested in
 * isolation, with no test that anything calls it on the thing it governs.
 *
 * It cost a red CI run. `0043_media_library.sql` shipped without `BEGIN;` and
 * `COMMIT;`, every static gate passed, and the failure surfaced in the
 * integration job — the one place a Postgres exists, four minutes in, several
 * jobs downstream of where the mistake was made. The rule was enforced only by
 * running it, and running it needs a database.
 *
 * It does not: the rule is pure text. So it runs here, in the unit suite, in
 * `pnpm verify`, on the machine where the file was written.
 *
 * ## Why it imports the migrator's own function
 *
 * A second implementation of "must open with BEGIN" is a second rule, and the
 * two would eventually disagree about a dollar-quoted block or a trailing
 * comment — with the copy in the fast check being the one that says yes. There
 * is one implementation and this calls it.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { stripTransactionControl } from "./index.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../db/migrations", import.meta.url));

function migrationFiles(): readonly string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

describe("db/migrations", () => {
  it("has migrations to check at all", () => {
    // Without this, a wrong path or a renamed directory would make every
    // assertion below vacuous and the suite would still be green (§9.1).
    expect(migrationFiles().length).toBeGreaterThan(40);
  });

  it.each(migrationFiles())("%s is wrapped in one transaction", (filename) => {
    const sql = readFileSync(join(MIGRATIONS_DIR, filename), "utf8");
    // Throws with the migrator's own message if the file is not runnable by
    // hand or cannot carry its ledger row atomically.
    const body = stripTransactionControl(sql, filename);
    expect(body.trim()).not.toBe("");
  });

  it("numbers every migration uniquely, so ordering is total", () => {
    // Two files with the same prefix apply in an order decided by the rest of
    // the name, which is not the order anybody intended.
    const prefixes = migrationFiles().map((name) => name.slice(0, 4));
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });
});
