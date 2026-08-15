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
import type { PoolClient } from "pg";
import { createPool } from "@ds/postgres";
import { runInTenant, TenantResolutionError } from "../../src/db/tenant-db.js";
import { courses } from "../../src/db/schema.js";
import { addCredential, seedLearner } from "./support/seed-learner.js";
import { requireEnv } from "./support/env.js";

const DATABASE_URL = requireEnv("DATABASE_URL");
const SUPERUSER_URL = requireEnv("POSTGRES_SUPERUSER_URL");

const seedPool = createPool({ connectionString: SUPERUSER_URL });
const appPool = createPool({ connectionString: DATABASE_URL, max: 5 });

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
    `INSERT INTO courses (customer_id, project_id, slug, title, status)
     VALUES ($1, $2, $3, $4, 'published') RETURNING id`,
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
    const singleConnectionPool = createPool({ connectionString: DATABASE_URL, max: 1 });

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
    const user = await seedLearner(seedPool, {
      realm: `http://127.0.0.1/realms/efn-${unique}`,
      subject: `efn-sub-${unique}`,
    });
    await seedPool.query(
      `INSERT INTO enrolments (customer_id, course_id, user_id,
                               required_watch_percent, pass_threshold_percent)
       VALUES ($1,$2,$3,100,70)`,
      [tenant.customerId, tenant.courseId, user.id],
    );
    await seedPool.query("INSERT INTO efn_profiles (user_id, efn) VALUES ($1,$2)", [
      user.id,
      efn,
    ]);
    return user.id;
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

/**
 * One person across two customers (P21-01).
 *
 * The acceptance criteria this covers are the two halves of the same decision.
 * A physician who learns with MEDICE *and* with DS is **one** `users` row — one
 * `user.id`, one EFN, one certificate history — because the EFN belongs to the
 * physician and not to the customer (ADR-0004). If they were two rows, they
 * would be two EFNs on file and a Punktemeldung could credit the wrong
 * Punktekonto, which looks exactly like success.
 *
 * The membership, on the other hand, is *not* shared. `user_customers` carries
 * a `customer_id` and an RLS policy, so a customer admin sees that the person
 * learns with them and learns nothing about anywhere else the person learns.
 *
 * These two facts pull in opposite directions, which is why both are asserted
 * against the same seeded person rather than against convenient separate ones.
 */
describe("one person, many customers (P21-01)", () => {
  let personId: string;

  beforeAll(async () => {
    const unique = randomUUID().slice(0, 8);
    const person = await seedLearner(seedPool, {
      realm: `http://127.0.0.1/realms/both-${unique}`,
      subject: `both-sub-${unique}`,
      firstName: "Beate",
      lastName: "Beispiel",
    });
    personId = person.id;

    // A second credential, as P21-05 will one day create. Only a test may do
    // this directly — no authentication path links a credential to a person who
    // already has one, which is what stops an unverified email claim becoming
    // account takeover.
    await addCredential(seedPool, personId, {
      provider: "keycloak",
      realm: `http://127.0.0.1/realms/other-${unique}`,
      subject: `other-sub-${unique}`,
    });

    for (const tenant of [tenantA, tenantB]) {
      await seedPool.query(
        `INSERT INTO enrolments (customer_id, course_id, user_id,
                                 required_watch_percent, pass_threshold_percent)
         VALUES ($1,$2,$3,100,70)`,
        [tenant.customerId, tenant.courseId, personId],
      );
      await seedPool.query(
        "INSERT INTO user_customers (user_id, customer_id) VALUES ($1,$2)",
        [personId, tenant.customerId],
      );
    }
  });

  it("resolves both credentials to exactly one person", async () => {
    const { rows } = await seedPool.query<{ n: string }>(
      "SELECT count(DISTINCT user_id) AS n FROM user_identities WHERE user_id = $1",
      [personId],
    );
    expect(rows[0]?.n).toBe("1");

    // And the person carries one EFN slot, not one per customer — the primary
    // key on efn_profiles is what makes that structural rather than hoped for.
    await seedPool.query("INSERT INTO efn_profiles (user_id, efn) VALUES ($1,$2)", [
      personId,
      "333333333333333",
    ]);
    await expect(
      seedPool.query("INSERT INTO efn_profiles (user_id, efn) VALUES ($1,$2)", [
        personId,
        "444444444444444",
      ]),
    ).rejects.toThrow(/duplicate key/i);
  });

  it("keeps one enrolment per customer, both pointing at that one person", async () => {
    const { rows } = await seedPool.query<{ customer_id: string }>(
      "SELECT customer_id FROM enrolments WHERE user_id = $1",
      [personId],
    );
    const customers = rows.map((row) => row.customer_id).sort();
    expect(customers).toEqual([tenantA.customerId, tenantB.customerId].sort());
  });

  it("does not let a membership in one customer reveal the person in another", async () => {
    const client = await appPool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.customer_id', $1, true)", [
        tenantA.customerId,
      ]);

      const visible = await client.query<{ customer_id: string }>(
        "SELECT customer_id FROM user_customers WHERE user_id = $1",
        [personId],
      );

      // The membership in tenant A is visible; the one in tenant B is not —
      // even though the query named neither and the person is the same row.
      expect(visible.rows).toEqual([{ customer_id: tenantA.customerId }]);
      await client.query("COMMIT");
    } finally {
      client.release();
    }
  });

  it("returns no memberships at all with no tenant context", async () => {
    const client = await appPool.connect();
    try {
      const result = await client.query("SELECT * FROM user_customers");
      expect(result.rows).toEqual([]);
    } finally {
      client.release();
    }
  });

  it("refuses to write a membership into a customer the context does not name", async () => {
    const client = await appPool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.customer_id', $1, true)", [
        tenantA.customerId,
      ]);
      await expect(
        client.query("INSERT INTO user_customers (user_id, customer_id) VALUES ($1,$2)", [
          personId,
          tenantB.customerId,
        ]),
      ).rejects.toThrow(/row-level security/i);
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });
});
