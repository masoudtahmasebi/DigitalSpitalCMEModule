/**
 * The database's own opinion about an embed origin (P94-04).
 *
 * ## Why this file exists when the grammar is already tested next door
 *
 * `packages/domain/src/embed-origin.test.ts` proves what the *rule* accepts.
 * This proves what the *column* accepts, and the two are different questions
 * with different failure modes:
 *
 * - The console is not the only way a row gets written. A seed, a migration or
 *   an operator with `psql` can write one, and the DTO is not in the way.
 * - A CORS refusal is invisible from the server — the browser blocks the
 *   request and nothing reaches a log (CLAUDE.md §9.13). A row the API cannot
 *   use is therefore not a 500 somebody notices; it is an embed that quietly
 *   never works.
 *
 * The CHECK is the backstop. `is_origin_list` was written in migration 0032 to
 * refuse wildcards, on reasoning that was true then and is not now, and this is
 * where "the schema is the version the code expects" gets asserted (§9.9).
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { createPool } from "@ds/postgres";
import { isEmbedOriginPattern } from "@ds/domain";
import { requireEnv } from "./support/env.js";

const SUPERUSER_URL = requireEnv("POSTGRES_SUPERUSER_URL");

let admin: Pool;
let customerId: string;
let departmentId: string;

beforeAll(async () => {
  admin = createPool({ connectionString: SUPERUSER_URL });
  const suffix = randomUUID().slice(0, 8);

  const {
    rows: [customer],
  } = await admin.query<{ id: string }>(
    "INSERT INTO customers (slug, name) VALUES ($1, $2) RETURNING id",
    [`origins-customer-${suffix}`, "Origins Test GmbH"],
  );
  customerId = customer!.id;

  const {
    rows: [department],
  } = await admin.query<{ id: string }>(
    "INSERT INTO departments (customer_id, slug, name) VALUES ($1, $2, $3) RETURNING id",
    [customerId, "default", "Default"],
  );
  departmentId = department!.id;
});

afterAll(async () => {
  await admin.end();
});

/** Try to store a list; resolve to the constraint's verdict rather than throw. */
async function store(origins: readonly string[]): Promise<boolean> {
  const slug = `origins-project-${randomUUID().slice(0, 8)}`;
  try {
    await admin.query(
      `INSERT INTO projects (customer_id, department_id, slug, name, identity_provider, embed_origins)
       VALUES ($1, $2, $3, $4, 'local', $5)`,
      [customerId, departmentId, slug, "Origins project", origins],
    );
    return true;
  } catch {
    return false;
  }
}

describe("what the column stores", () => {
  it("takes the three shapes the client asked for", async () => {
    expect(
      await store([
        "https://www.medice.de",
        "https://*.medice-staging.de",
        "http://localhost:*",
        "https://*.vercel.app:*",
      ]),
    ).toBe(true);
  });

  it("refuses a wildcard nobody has registered", async () => {
    // The one that matters. This API answers with
    // `Access-Control-Allow-Credentials: true`, and the fetch specification
    // forbids that with a wildcard origin because it would let any page on the
    // web make authenticated requests as a signed-in physician.
    for (const value of ["*", "https://*", "https://*.de", "*://*"]) {
      expect(await store([value]), value).toBe(false);
    }
  });

  it("refuses anything that is not scheme, host and port", async () => {
    for (const value of [
      "https://www.medice.de/",
      "https://www.medice.de/kurs",
      "www.medice.de",
      "ftp://www.medice.de",
    ]) {
      expect(await store([value]), value).toBe(false);
    }
  });

  it("agrees with the rule the console validates against", async () => {
    /*
     * Two grammars, written in two languages, and nothing else makes them
     * agree — the SQL is a regex and the TypeScript is a parser, deliberately,
     * because a CHECK constraint cannot call the application. This is the seam
     * where they are compared, over the cases that decide whether an embed
     * works.
     *
     * A disagreement in either direction is a defect: the column accepting
     * what the rule refuses lets an unusable row exist, and the column refusing
     * what the rule accepts is an operator told "Gespeichert" by a form whose
     * save then fails.
     */
    const cases = [
      "https://www.medice.de",
      "https://*.medice.de",
      "http://localhost:*",
      "http://localhost:5173",
      "https://*.vercel.app:*",
      "https://www.medice.de:8443",
      "*",
      "https://*",
      "https://*.de",
      "https://www.medice.de/",
      "https://user:pw@www.medice.de",
      "ftp://www.medice.de",
      "www.medice.de",
    ];

    for (const value of cases) {
      expect(await store([value]), `column and rule disagree about ${value}`).toBe(
        isEmbedOriginPattern(value),
      );
    }
  });
});

describe("what the resolver returns", () => {
  it("hands the API every project's patterns, whatever tenant is set", async () => {
    // `projects` is RLS-scoped and CORS runs before any tenant context exists,
    // which is why this goes through a SECURITY DEFINER function at all. A
    // direct read here would return zero rows and every embedded widget would
    // break (§9.6).
    const pattern = `https://*.resolver-${randomUUID().slice(0, 8)}.example`;
    expect(await store([pattern])).toBe(true);

    const { rows } = await admin.query<{ resolve_embed_origins: string }>(
      "SELECT resolve_embed_origins()",
    );
    expect(rows.map((row) => row.resolve_embed_origins)).toContain(pattern);
  });
});
