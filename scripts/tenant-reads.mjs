#!/usr/bin/env node
/**
 * Every statement against a tenant-scoped table runs inside `runInTenant`
 * (CLAUDE.md §9.6, P134-01).
 *
 * ## The failure this exists for
 *
 * `projects` is under FORCE ROW LEVEL SECURITY. Read on the **bare pool** it
 * matches zero rows — correctly, because an unset `app.customer_id` matches
 * nothing and the system fails closed — and a repository method that maps
 * `rows[0]` to nulls turns that into "not configured". So a correctly
 * configured project silently sent no mail while the endpoint answered 202
 * (P40-03). The same mistake is documented one method up on `findParticipant`.
 *
 * Nothing fails. There is no error, no log line and no red test: RLS makes a
 * missing tenant context look exactly like missing data, which is why this has
 * to be found by reading rather than by running.
 *
 * ## Why a script rather than a review note
 *
 * Twenty-four tables times every repository method is not a thing a person
 * checks reliably, and it has to be re-checked on every new repository. §9.12:
 * if four roles by nine screens is the question, a person clicking is the wrong
 * instrument. This is the same shape.
 *
 * ## What it does and does not prove
 *
 * It proves that no `pool.query(...)` **statement text** in `apps/api/src`
 * names a table that is under RLS, outside the allow-list below. It cannot see
 * a table named through string concatenation, and it does not check the
 * reverse direction — a `runInTenant` block reading a table that is *not*
 * tenant-scoped is legal and common. Saying so is the point: a check whose
 * reach is overstated is how §9.1's defects survive.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const REPO = new URL("..", import.meta.url).pathname;

/**
 * The tables under RLS, read from the migrations rather than restated here.
 *
 * A hand-kept second list would be wrong the first time somebody adds a table,
 * and wrong in the safe-looking direction: a table missing from the list is a
 * table this check silently stops covering.
 */
function tenantTables() {
  const dir = join(REPO, "db/migrations");
  const tables = new Set();

  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql"))) {
    const sql = readFileSync(join(dir, file), "utf8");

    // The `0001_init.sql` DO block, which names them in one array literal.
    const block = /tenant_tables\s+text\[\]\s*:=\s*ARRAY\[([\s\S]*?)\]/u.exec(sql);
    if (block !== null) {
      for (const [, name] of block[1].matchAll(/'([a-z_]+)'/gu)) tables.add(name);
    }

    /*
     * And every table given RLS afterwards, one ALTER at a time.
     *
     * `(?:ONLY\s+)?` is defensive, not a fix: `grep -c "ALTER TABLE ONLY"` over
     * `db/migrations` returns **0** today, and the nine names this extracts are
     * all real tables. But `ALTER TABLE ONLY x ENABLE ROW LEVEL SECURITY` is
     * legal Postgres, and without this the regex would capture `only` as the
     * table name *and* silently drop the real one — shrinking the checked set
     * while still reporting a number, which is §9.1's second form.
     */
    for (const [, name] of sql.matchAll(
      /ALTER TABLE\s+(?:ONLY\s+)?([a-z_]+)\s+ENABLE ROW LEVEL SECURITY/giu,
    )) {
      tables.add(name);
    }
  }

  if (tables.size === 0) {
    throw new Error(
      "found no tenant-scoped tables in db/migrations — the parser has drifted " +
        "from the migrations, and a check that finds nothing to check is not a " +
        "passing check",
    );
  }
  return tables;
}

/**
 * Statements that read a tenant table on the bare pool **on purpose**.
 *
 * Every entry names why. An entry with no reason is not an exemption, it is an
 * unreviewed bug with a comment.
 */
const ALLOWED = [
  {
    file: "apps/api/src/modules/customers/customer.repository.ts",
    table: "customers",
    statement: "list_customer_registry",
    documents: true,
    reason:
      "list_customer_registry() is SECURITY DEFINER: the registry is the one " +
      "cross-tenant read a super_admin is entitled to, and it exists precisely " +
      "so the customers table itself is never read outside a tenant context.",
  },
  {
    file: "apps/api/src/subject-erasure.ts",
    table: "audit_log",
    statement: "INSERT INTO audit_log",
    reason:
      "The one write here is the P149-02 audit row saying an erasure proceeded " +
      "on an unverified schema. It runs as ds_migrator, outside any tenant " +
      "context by design — an erasure spans customers, which is why the whole " +
      "tool refuses to run as ds_app — and it inserts customer_id NULL, the " +
      "same shape AuditService.recordSystem uses for events with no tenant. " +
      "0014_policies_tolerate_empty_context.sql is what makes that row legal. " +
      "Wrapping it in runInTenant would require inventing a customer for a " +
      "cross-customer fact.",
  },
  {
    file: "apps/api/src/modules/projects/project-binding.repository.ts",
    table: "projects",
    statement: "resolve_project_binding",
    documents: true,
    reason:
      "resolve() runs before a tenant context can exist — it is what decides " +
      "which tenant the request belongs to. It goes through the SECURITY " +
      "DEFINER lookup added by 0002_project_binding_lookup.sql, which is why " +
      "that migration exists.",
  },
];

/**
 * Does this entry justify *this* statement?
 *
 * File **and** table **and** a fragment of the statement itself — because an
 * entry that matched on the file alone silenced every bare-pool read of every
 * tenant table in it, for ever (P150-01). Each reason above is written about
 * one specific statement; the exemption now reaches exactly that far.
 *
 * A fragment rather than a line number, which is a deviation from the letter of
 * the request and, I think, its intent: a line number in this list drifts every
 * time somebody edits anything above the statement, and a check that fails for
 * that reason trains people to bump the number without re-reading the reason —
 * which is the review this list exists to force. The fragment moves with the
 * code and stops matching when the statement genuinely changes.
 */
function justifies(entry, finding, argument) {
  return (
    finding.file === entry.file &&
    finding.table === entry.table &&
    argument.includes(entry.statement)
  );
}

/** Every `.ts` under a directory, tests excluded. */
function sources(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...sources(path));
    else if (path.endsWith(".ts") && !path.includes(".test.")) out.push(path);
  }
  return out;
}

/**
 * The argument list of a call starting at `open`, by counting parentheses.
 *
 * A fixed-size window was the first version and it read past the end of the
 * statement into the next method's comment, reporting a documented *warning
 * about* a bare-pool read as a bare-pool read. Balanced parens is the honest
 * boundary.
 */
function callArguments(source, open) {
  let depth = 0;
  for (let at = open; at < source.length; at += 1) {
    const char = source[at];
    if (char === "(") depth += 1;
    else if (char === ")") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, at);
    }
  }
  return source.slice(open + 1);
}

const tables = tenantTables();
const findings = [];
/** Entries that silenced a real finding, so a stale one can be reported. */
const used = new Set();

for (const path of sources(join(REPO, "apps/api/src"))) {
  const source = readFileSync(path, "utf8");
  const relative = path.slice(REPO.length);

  for (const match of source.matchAll(/(?:this\.)?pool\.query\s*(?:<[^>]*>)?\s*\(/gu)) {
    const open = match.index + match[0].length - 1;
    const argument = callArguments(source, open);
    const line = source.slice(0, match.index).split("\n").length;

    for (const table of tables) {
      const named = new RegExp(`\\b(?:FROM|JOIN|INTO|UPDATE|TABLE)\\s+${table}\\b`, "iu");
      if (!named.test(argument)) continue;
      const finding = { file: relative, line, table };
      const entry = ALLOWED.find((candidate) => justifies(candidate, finding, argument));
      if (entry !== undefined) {
        used.add(entry);
        continue;
      }
      findings.push(finding);
    }
  }
}

/*
 * An exemption that silences nothing is a claim about code that has moved
 * (§11 rule 9: a comment is a claim, not a fact).
 *
 * Two of the three entries here document calls the scanner does **not** flag —
 * `list_customer_registry()` and `resolve_project_binding()` name a SECURITY
 * DEFINER function rather than a table, so no `FROM customers` or
 * `FROM projects` ever appears in the argument. Their reasons are worth
 * keeping; calling them exemptions was not, because an inert entry reads as
 * active protection. They carry `documents: true`, and the two checks below
 * hold that honest in both directions.
 */
const stale = ALLOWED.filter((entry) => entry.documents !== true && !used.has(entry));
const inert = ALLOWED.filter((entry) => entry.documents === true && used.has(entry));

if (stale.length > 0 || inert.length > 0) {
  for (const entry of stale) {
    console.error(
      `tenant-reads: the exemption for ${entry.file} (${entry.table}, ` +
        `"${entry.statement}") silenced nothing.\n` +
        "  Either the statement moved and the exemption is now stale, or the\n" +
        "  scanner never flagged it — in which case mark it `documents: true`.\n",
    );
  }
  for (const entry of inert) {
    console.error(
      `tenant-reads: ${entry.file} (${entry.table}) is marked \`documents: true\`\n` +
        "  but the scanner did flag it. It is a real exemption: drop the flag so\n" +
        "  the entry is reviewed as one.\n",
    );
  }
  process.exit(1);
}

if (findings.length > 0) {
  console.error(
    `tenant-reads: ${findings.length} statement(s) read a tenant-scoped table ` +
      "on the bare pool, outside runInTenant.\n" +
      "Under RLS these match zero rows and look like missing data (§9.6).\n",
  );
  for (const found of findings) {
    console.error(`  ${found.file}:${found.line} — ${found.table}`);
  }
  console.error(
    "\nEither wrap the read in runInTenant, or add it to ALLOWED in this " +
      "script with the reason it is safe.",
  );
  process.exit(1);
}

console.log(
  `tenant-reads: ${tables.size} tenant-scoped tables, ` +
    `${ALLOWED.length} reviewed exemptions, no unguarded reads`,
);
