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
import { Pool, type PoolClient } from "pg";
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
  it("returns zero rows on a connection that previously served a tenant", async () => {
    // Not the same test as "a fresh connection sees nothing", and the
    // difference is the whole point (migration 0014). `set_config(…, true)` is
    // transaction-local, and at COMMIT the setting reverts to the **empty
    // string** rather than disappearing — so on every pooled connection after
    // its first tenant request, the old policies evaluated `''::uuid` and
    // raised `invalid input syntax for type uuid` instead of matching nothing.
    //
    // Fail-closed either way, but an exception is not "matches nothing", and
    // the guarantee in migration 0001's comment was only true on connection
    // number one.
    const client = await appPool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.customer_id', $1, true)", [
        tenantA.customerId,
      ]);
      await client.query("SELECT * FROM courses");
      await client.query("COMMIT");

      const result = await client.query("SELECT * FROM courses");
      expect(result.rows).toEqual([]);
    } finally {
      client.release();
    }
  });

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

/**
 * `efn_profiles` (security audit, migration 0013).
 *
 * The table has no `customer_id` — one physician has one EFN across every
 * customer (ADR-0004) — so migration 0001's policy loop, which keys on
 * `customer_id`, skipped it. For a while it was protected by application code
 * alone, which `CLAUDE.md` §4 invariant 3 says must never be the only defence.
 *
 * These are the assertions that make the replacement policy real. The one that
 * matters most is the last: an admin may see *that* a participant has an EFN and
 * may never write one, because the EFN is the physician's own claim to their
 * Ärztekammer and an admin who could set it could credit the wrong Punktekonto.
 */
describe("EFN rows are scoped by the database, not by a WHERE clause", () => {
  let learnerA: string;
  let learnerB: string;

  beforeAll(async () => {
    learnerA = await seedLearnerWithEfn(tenantA, "111111111111111");
    learnerB = await seedLearnerWithEfn(tenantB, "222222222222222");
  });

  async function seedLearnerWithEfn(tenant: SeededTenant, efn: string): Promise<string> {
    const unique = randomUUID().slice(0, 8);
    const {
      rows: [user],
    } = await seedPool.query<{ id: string }>(
      `INSERT INTO users (keycloak_realm, keycloak_sub) VALUES ($1,$2) RETURNING id`,
      [`http://127.0.0.1/realms/efn-${unique}`, `efn-sub-${unique}`],
    );
    await seedPool.query(
      `INSERT INTO enrolments (customer_id, course_id, user_id,
                               required_watch_percent, pass_threshold_percent)
       VALUES ($1,$2,$3,100,70)`,
      [tenant.customerId, tenant.courseId, user!.id],
    );
    await seedPool.query("INSERT INTO efn_profiles (user_id, efn) VALUES ($1,$2)", [
      user!.id,
      efn,
    ]);
    return user!.id;
  }

  /** One transaction with the given context, so the policy is what decides. */
  async function inContext<T>(
    context: { customerId: string; userId?: string; role?: string },
    run: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await appPool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.customer_id', $1, true)", [
        context.customerId,
      ]);
      await client.query("SELECT set_config('app.role', $1, true)", [
        context.role ?? "learner",
      ]);
      if (context.userId !== undefined) {
        await client.query("SELECT set_config('app.user_id', $1, true)", [
          context.userId,
        ]);
      }
      const result = await run(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  it("returns nothing with no context at all", async () => {
    const client = await appPool.connect();
    try {
      const result = await client.query("SELECT * FROM efn_profiles");
      expect(result.rows).toEqual([]);
    } finally {
      client.release();
    }
  });

  it("lets a learner read their own EFN", async () => {
    const rows = await inContext(
      { customerId: tenantA.customerId, userId: learnerA },
      async (client) =>
        (
          await client.query("SELECT efn FROM efn_profiles WHERE user_id = $1", [
            learnerA,
          ])
        ).rows,
    );
    expect(rows).toEqual([{ efn: "111111111111111" }]);
  });

  it("hides another tenant's physician even from an unfiltered query", async () => {
    // The point of the whole exercise: a query that forgot its WHERE clause
    // used to return every physician's EFN across every customer.
    const rows = await inContext(
      { customerId: tenantA.customerId, userId: learnerA, role: "customer_admin" },
      async (client) => (await client.query("SELECT user_id FROM efn_profiles")).rows,
    );

    const ids = rows.map((row: { user_id: string }) => row.user_id);
    expect(ids).toContain(learnerA);
    expect(ids).not.toContain(learnerB);
  });

  it("lets an admin see that their own participant has one", async () => {
    // The participant list's "EFN: ja/nein" column, which reads other people's
    // rows — but only people enrolled in this customer's courses.
    const rows = await inContext(
      { customerId: tenantA.customerId, userId: randomUUID(), role: "customer_admin" },
      async (client) =>
        (
          await client.query("SELECT user_id FROM efn_profiles WHERE user_id = $1", [
            learnerA,
          ])
        ).rows,
    );
    expect(rows).toHaveLength(1);
  });

  it("refuses to let anyone write somebody else's EFN", async () => {
    // `WITH CHECK` allows only your own. An admin who could write an EFN could
    // credit a different physician's Punktekonto (ADR-0004).
    await expect(
      inContext(
        { customerId: tenantA.customerId, userId: randomUUID(), role: "customer_admin" },
        async (client) =>
          client.query("INSERT INTO efn_profiles (user_id, efn) VALUES ($1,$2)", [
            learnerA,
            "999999999999999",
          ]),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("refuses an update that would retarget a row", async () => {
    await expect(
      inContext({ customerId: tenantA.customerId, userId: learnerA }, async (client) =>
        client.query("UPDATE efn_profiles SET efn = $1 WHERE user_id = $2", [
          "888888888888888",
          learnerB,
        ]),
      ),
    ).resolves.toMatchObject({ rowCount: 0 });
  });
});
