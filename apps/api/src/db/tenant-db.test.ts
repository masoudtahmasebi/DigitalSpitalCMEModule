import { describe, expect, it, vi } from "vitest";
import {
  runInTenant,
  TenantResolutionError,
  tenantSetupStatements,
  type PoolClientLike,
  type PoolLike,
  type TenantContext,
} from "./tenant-db.js";

const learner: TenantContext = {
  customerId: "11111111-1111-1111-1111-111111111111",
  role: "learner",
  userId: "22222222-2222-2222-2222-222222222222",
};

/**
 * A fake pool that records every statement, so the RLS setup can be asserted
 * without a live Postgres (which needs docker, unavailable in this session).
 * The behavioural guarantee that RLS actually isolates rows is proven by the
 * dedicated integration suite in P10-02 against a real database.
 */
function fakePool(): { pool: PoolLike; calls: string[]; released: () => boolean } {
  const calls: string[] = [];
  let released = false;

  const client: PoolClientLike = {
    query: vi.fn(async (text: string) => {
      calls.push(text);
      return { rows: [] };
    }),
    release: vi.fn(() => {
      released = true;
    }),
  };

  return {
    pool: { connect: async () => client },
    calls,
    released: () => released,
  };
}

describe("runInTenant sets the RLS context transaction-locally", () => {
  it("opens a transaction and sets app.customer_id and app.role LOCAL", async () => {
    const { pool, calls } = fakePool();

    await runInTenant(pool, learner, async () => "ok");

    expect(calls[0]).toBe("BEGIN");
    // The `true` third argument is what makes the setting transaction-scoped, so
    // a pooled connection cannot leak it to the next request.
    expect(calls).toContain("SELECT set_config('app.customer_id', $1, true)");
    expect(calls).toContain("SELECT set_config('app.role', $1, true)");
    expect(calls).toContain("SELECT set_config('app.user_id', $1, true)");
    expect(calls.at(-1)).toBe("COMMIT");
  });

  it("passes the customer id as a bound parameter, never interpolated", () => {
    // A customer id can never be a SQL-injection vector, because it is $1.
    const statements = tenantSetupStatements({
      customerId: "'; DROP TABLE customers; --",
      role: "customer_admin",
    });

    const customerStmt = statements.find((s) => s.text.includes("app.customer_id"));
    expect(customerStmt?.text).toBe("SELECT set_config('app.customer_id', $1, true)");
    expect(customerStmt?.values).toEqual(["'; DROP TABLE customers; --"]);
  });

  it("commits and releases on success", async () => {
    const { pool, calls, released } = fakePool();

    const result = await runInTenant(pool, learner, async () => 42);

    expect(result).toBe(42);
    expect(calls).toContain("COMMIT");
    expect(calls).not.toContain("ROLLBACK");
    expect(released()).toBe(true);
  });

  it("rolls back and still releases on error", async () => {
    const { pool, calls, released } = fakePool();

    await expect(
      runInTenant(pool, learner, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(calls).toContain("ROLLBACK");
    expect(calls).not.toContain("COMMIT");
    expect(released()).toBe(true);
  });

  it("fails closed when the customer id is missing — no query runs", async () => {
    const { pool, calls } = fakePool();

    await expect(
      runInTenant(pool, { customerId: "", role: "learner" }, async () => "ok"),
    ).rejects.toBeInstanceOf(TenantResolutionError);

    // Not even BEGIN was issued.
    expect(calls).toEqual([]);
  });

  it("omits app.user_id when there is no user (e.g. a service context)", () => {
    const statements = tenantSetupStatements({
      customerId: learner.customerId,
      role: "super_admin",
    });

    expect(statements.some((s) => s.text.includes("app.user_id"))).toBe(false);
  });
});
