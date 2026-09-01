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

    // And every table given RLS afterwards, one ALTER at a time.
    for (const [, name] of sql.matchAll(
      /ALTER TABLE\s+([a-z_]+)\s+ENABLE ROW LEVEL SECURITY/giu,
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
    reason:
      "list_customer_registry() is SECURITY DEFINER: the registry is the one " +
      "cross-tenant read a super_admin is entitled to, and it exists precisely " +
      "so the customers table itself is never read outside a tenant context.",
  },
  {
    file: "apps/api/src/subject-erasure.ts",
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
    reason:
      "resolve() runs before a tenant context can exist — it is what decides " +
      "which tenant the request belongs to. It goes through the SECURITY " +
      "DEFINER lookup added by 0002_project_binding_lookup.sql, which is why " +
      "that migration exists.",
  },
];

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
      if (ALLOWED.some((entry) => relative === entry.file)) continue;
      findings.push({ file: relative, line, table });
    }
  }
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
