/**
 * P10-02: proves ADR-0002's tenant isolation against a real PostgreSQL, not a
 * mock. A mock would happily "prove" an isolation guarantee that does not
 * exist — the guarantee here is a property of the database (row-level
 * security policies + `FORCE ROW LEVEL SECURITY`), so it can only honestly be
 * demonstrated against one. `tenant-db.test.ts` covers `runInTenant`'s own
 * mechanics (statement order, rollback, fail-closed) with a fake pool; this
 * suite is the behavioural half those tests explicitly defer to "the
 * dedicated integration suite".
 *
 * Also carries P1-05's own acceptance criterion: "a test that issues
 * interleaved requests for two customers over a pool of one connection shows
 * no leakage" — see the last `describe` block.
 *
 * Fixtures are seeded through the PostgreSQL superuser (`POSTGRES_SUPERUSER_URL`,
 * BYPASSRLS) — that is test setup only, never the path the application takes.
 * Every assertion below goes through `ds_app` (`DATABASE_URL`) and
 * `runInTenant`, exactly as the running API does.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { runInTenant, TenantResolutionError } from "../../src/db/tenant-db.js";
import { courses } from "../../src/db/schema.js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(
      `${name} must be set to run the integration suite — see .env.example.`,
    );
  }
  return value;
}

const DATABASE_URL = requireEnv("DATABASE_URL");
const SUPERUSER_URL = requireEnv("POSTGRES_SUPERUSER_URL");

const seedPool = new Pool({ connectionString: SUPERUSER_URL });
const appPool = new Pool({ connectionString: DATABASE_URL, max: 5 });

interface SeededTenant {
  customerId: string;
  projectId: string;
  courseId: string;
}

let tenantA: SeededTenant;
let tenantB: SeededTenant;

beforeAll(async () => {
  tenantA = await seedTenant("tenant-a");
  tenantB = await seedTenant("tenant-b");
});

afterAll(async () => {
  await seedPool.end();
  await appPool.end();
});

async function seedTenant(label: string): Promise<SeededTenant> {
  const suffix = randomUUID().slice(0, 8);

  const {
    rows: [customer],
  } = await seedPool.query<{ id: string }>(
    "INSERT INTO customers (slug, name) VALUES ($1, $2) RETURNING id",
    [`${label}-${suffix}`, `${label} GmbH`],
  );
  const {
    rows: [department],
  } = await seedPool.query<{ id: string }>(
    "INSERT INTO departments (customer_id, slug, name) VALUES ($1, $2, $3) RETURNING id",
    [customer!.id, "default", "Default"],
  );
  const {
    rows: [project],
  } = await seedPool.query<{ id: string }>(
    `INSERT INTO projects (customer_id, department_id, slug, name)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [customer!.id, department!.id, `${label}-project-${suffix}`, `${label} project`],
  );
  const {
    rows: [course],
  } = await seedPool.query<{ id: string }>(
    `INSERT INTO courses (customer_id, project_id, slug, title)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [customer!.id, project!.id, `${label}-course-${suffix}`, `${label} course`],
  );

  return { customerId: customer!.id, projectId: project!.id, courseId: course!.id };
}

describe("ds_app sees only its own tenant's rows (ADR-0002)", () => {
  it("returns zero rows with no tenant context set at all", async () => {
    const client = await appPool.connect();
    try {
      const result = await client.query("SELECT * FROM courses");
      expect(result.rows).toEqual([]);
    } finally {
      client.release();
    }
  });

  it("customer A sees exactly its own course, none of customer B's", async () => {
    const rows = await runInTenant(
      appPool,
      { customerId: tenantA.customerId, role: "learner" },
      (db) => db.select({ id: courses.id }).from(courses),
    );
    expect(rows.map((row) => row.id)).toEqual([tenantA.courseId]);
  });

  it("customer B sees exactly its own course, none of customer A's", async () => {
    const rows = await runInTenant(
      appPool,
      { customerId: tenantB.customerId, role: "learner" },
      (db) => db.select({ id: courses.id }).from(courses),
    );
    expect(rows.map((row) => row.id)).toEqual([tenantB.courseId]);
  });

  it("rejects an insert claiming another customer's id — WITH CHECK, not application code", async () => {
    let caught: unknown;
    try {
      await runInTenant(
        appPool,
        { customerId: tenantB.customerId, role: "customer_admin" },
        (db) =>
          db.insert(courses).values({
            // Acting as tenant B, but claiming tenant A's customer_id — exactly
            // the mistake a bug in an application-level WHERE filter could make.
            customerId: tenantA.customerId,
            projectId: tenantA.projectId,
            slug: `cross-tenant-attempt-${randomUUID().slice(0, 8)}`,
            title: "Should never be written",
          }),
      );
    } catch (error) {
      caught = error;
    }

    // Drizzle wraps the driver error in "Failed query: ...";  the actual
    // Postgres message — proof this is the RLS policy and not some other
    // constraint — is on `.cause`.
    expect(caught).toBeInstanceOf(Error);
    const cause = (caught as Error & { cause?: unknown }).cause;
    expect(cause).toBeInstanceOf(Error);
    expect((cause as Error).message).toMatch(/row-level security/i);
  });

  it("fails closed with no query run when the tenant cannot be resolved", async () => {
    await expect(
      runInTenant(
        appPool,
        { customerId: "", role: "learner" },
        async () => "unreachable",
      ),
    ).rejects.toBeInstanceOf(TenantResolutionError);
  });
});

describe("no leakage across a pool of one connection (P1-05 acceptance criterion)", () => {
  it("interleaved requests for two customers over a single pooled connection stay isolated", async () => {
    const singleConnectionPool = new Pool({ connectionString: DATABASE_URL, max: 1 });

    try {
      // Both run concurrently against a pool that can only ever hand out one
      // physical connection: the second `connect()` blocks until the first
      // transaction commits and releases. That reuse is exactly the scenario
      // `SELECT set_config(..., true)` (transaction-LOCAL) exists to make safe.
      const [rowsA, rowsB] = await Promise.all([
        runInTenant(
          singleConnectionPool,
          { customerId: tenantA.customerId, role: "learner" },
          (db) => db.select({ id: courses.id }).from(courses),
        ),
        runInTenant(
          singleConnectionPool,
          { customerId: tenantB.customerId, role: "learner" },
          (db) => db.select({ id: courses.id }).from(courses),
        ),
      ]);

      expect(rowsA.map((row) => row.id)).toEqual([tenantA.courseId]);
      expect(rowsB.map((row) => row.id)).toEqual([tenantB.courseId]);
    } finally {
      await singleConnectionPool.end();
    }
  });
});
