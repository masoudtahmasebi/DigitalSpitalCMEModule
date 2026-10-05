/**
 * Migration 0056 re-reads stored validity dates as German days (P243-01).
 *
 * The migration has already run on this database — every suite starts from a
 * migrated schema — so this file plants rows in the shapes the old writers
 * produced and runs the file's SQL again. That is also the idempotency check:
 * a second run over rows it already fixed must change nothing.
 *
 * What would go wrong without it: the MEDICE course's stored end is 01:59 on
 * 13.10. in Berlin, so the warning P243-01 adds would name the wrong last day,
 * and a course whose dates came from the old console would end at 02:00 on its
 * last accredited day.
 */

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { createPool } from "@ds/postgres";
import { requireEnv } from "./support/env.js";

const SUPERUSER_URL = requireEnv("POSTGRES_SUPERUSER_URL");
const MIGRATION = fileURLToPath(
  new URL(
    "../../../../db/migrations/0056_validity_window_is_berlin_days.sql",
    import.meta.url,
  ),
);

let pool: Pool;
let customerId: string;
let projectId: string;
const suffix = randomUUID().slice(0, 8);

async function insertCourse(
  slug: string,
  validFrom: string | null,
  validTo: string | null,
): Promise<void> {
  // Created inside this file's own tenant and read back by slug, never by
  // `LIMIT 1` over a shared table (§9.6).
  await pool.query(
    `INSERT INTO courses (customer_id, project_id, slug, title, required_watch_percent,
                          pass_threshold_percent, status, valid_from, valid_to)
     VALUES ($1,$2,$3,$3,100,70,'draft',$4,$5)`,
    [customerId, projectId, slug, validFrom, validTo],
  );
}

async function windowOf(
  slug: string,
): Promise<{ from: string | null; to: string | null }> {
  const { rows } = await pool.query<{ valid_from: Date | null; valid_to: Date | null }>(
    "SELECT valid_from, valid_to FROM courses WHERE slug = $1",
    [slug],
  );
  const row = rows[0];
  if (row === undefined) throw new Error(`no course ${slug}`);
  return {
    from: row.valid_from?.toISOString() ?? null,
    to: row.valid_to?.toISOString() ?? null,
  };
}

async function runMigration(): Promise<void> {
  await pool.query(await readFile(MIGRATION, "utf8"));
}

beforeAll(async () => {
  pool = createPool({ connectionString: SUPERUSER_URL });
  const customer = await pool.query<{ id: string }>(
    "INSERT INTO customers (slug, name) VALUES ($1,$2) RETURNING id",
    [`vw-customer-${suffix}`, "Validity Window GmbH"],
  );
  customerId = customer.rows[0]!.id;
  const department = await pool.query<{ id: string }>(
    "INSERT INTO departments (customer_id, slug, name) VALUES ($1,'default','Default') RETURNING id",
    [customerId],
  );
  const project = await pool.query<{ id: string }>(
    `INSERT INTO projects (customer_id, department_id, slug, name, keycloak_issuer, keycloak_audience)
     VALUES ($1,$2,$3,'VW project','http://127.0.0.1:1/realms/vw','ds-education-api') RETURNING id`,
    [customerId, department.rows[0]!.id, `vw-project-${suffix}`],
  );
  projectId = project.rows[0]!.id;

  await insertCourse(
    `vw-console-${suffix}`,
    "2025-10-13T00:00:00Z",
    "2026-10-12T00:00:00Z",
  );
  await insertCourse(`vw-seed-${suffix}`, "2025-10-13T00:00:00Z", "2026-10-12T23:59:59Z");
  await insertCourse(`vw-winter-${suffix}`, null, "2026-12-31T23:59:59.999Z");
  await insertCourse(
    `vw-other-${suffix}`,
    "2025-10-13T08:30:00Z",
    "2026-10-12T15:00:00Z",
  );
  await insertCourse(`vw-open-${suffix}`, null, null);

  await runMigration();
});

afterAll(async () => {
  await pool.query("DELETE FROM courses WHERE customer_id = $1", [customerId]);
  await pool.end();
});

describe("0056: validity dates are German days", () => {
  it("moves a console-written end from 02:00 on the last day to its last instant", async () => {
    expect(await windowOf(`vw-console-${suffix}`)).toEqual({
      from: "2025-10-12T22:00:00.000Z",
      to: "2026-10-12T21:59:59.999Z",
    });
  });

  it("pulls a seed-written end back from 01:59 the next day", async () => {
    expect((await windowOf(`vw-seed-${suffix}`)).to).toBe("2026-10-12T21:59:59.999Z");
  });

  it("uses the winter offset where the day is in winter", async () => {
    expect((await windowOf(`vw-winter-${suffix}`)).to).toBe("2026-12-31T22:59:59.999Z");
  });

  it("leaves a time somebody chose on purpose, and an open window, alone", async () => {
    expect(await windowOf(`vw-other-${suffix}`)).toEqual({
      from: "2025-10-13T08:30:00.000Z",
      to: "2026-10-12T15:00:00.000Z",
    });
    expect(await windowOf(`vw-open-${suffix}`)).toEqual({ from: null, to: null });
  });

  it("changes nothing on a second run", async () => {
    const before = await windowOf(`vw-console-${suffix}`);
    await runMigration();
    expect(await windowOf(`vw-console-${suffix}`)).toEqual(before);
  });

  it("leaves courses under FORCE ROW LEVEL SECURITY", async () => {
    const { rows } = await pool.query<{ ok: boolean }>(
      `SELECT relrowsecurity AND relforcerowsecurity AS ok FROM pg_class WHERE relname = 'courses'`,
    );
    expect(rows[0]!.ok).toBe(true);
  });
});
