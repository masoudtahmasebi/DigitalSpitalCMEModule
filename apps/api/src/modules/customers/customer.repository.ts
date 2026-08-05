/**
 * The customer registry (P12-04). Infrastructure layer — ADR-0006.
 *
 * `Customer` is the top of `Customer → Department → Project → Course → Modul →
 * Kapitel → Inhalt` and the only level that had no endpoint, because
 * `customers` is RLS-scoped to a single tenant and a platform operator's first
 * screen is a list of all of them.
 *
 * ## Two access paths, deliberately unequal
 *
 * `list` goes through `list_customer_registry()`, the one SECURITY DEFINER
 * function that can see across tenants (migration 0021). It is the only method
 * here that escapes RLS, and it returns registry metadata and child counts —
 * never tenant content.
 *
 * **Everything else runs as `ds_app` inside the target customer's own tenant
 * context** and pays full row-level security like any other write. That is not
 * a stylistic choice: it means a bug in the customer service cannot reach
 * another customer's row, because the policy still says
 * `id = current_setting('app.customer_id')`. Creating works because the API
 * generates the uuid and opens the tenant context on it, so the row's `id`
 * *is* the tenant and the policy's `WITH CHECK` is satisfied honestly.
 *
 * The counts used to decide whether a customer may be deleted are gathered the
 * same way — inside that customer's context — which is why they are here rather
 * than folded into the registry function.
 */

import { sql } from "drizzle-orm";
import type { Pool } from "pg";
import type { ChildCensus } from "@ds/domain";
import { runInTenant, type Db } from "../../db/tenant-db.js";

export interface CustomerRegistryEntry {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly createdAt: Date;
  readonly departmentCount: number;
  readonly projectCount: number;
  readonly courseCount: number;
}

export interface CustomerRepositoryPort {
  list(): Promise<readonly CustomerRegistryEntry[]>;
  findBySlug(slug: string): Promise<CustomerRegistryEntry | undefined>;
  slugExists(slug: string): Promise<boolean>;
  create(input: { id: string; slug: string; name: string }): Promise<void>;
  rename(id: string, name: string): Promise<boolean>;
  /** How many of each level sit inside, for the deletion refusal. */
  census(id: string): Promise<ChildCensus>;
  /** Learner evidence anywhere inside, which makes deletion permanent-refused. */
  learnerRecords(id: string): Promise<number>;
  remove(id: string): Promise<boolean>;
}

interface RegistryRow {
  id: string;
  slug: string;
  name: string;
  created_at: Date;
  department_count: number;
  project_count: number;
  course_count: number;
}

export class CustomerRepository implements CustomerRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async list(): Promise<readonly CustomerRegistryEntry[]> {
    const result = await this.pool.query<RegistryRow>(
      "SELECT * FROM list_customer_registry()",
    );
    return result.rows.map(toEntry);
  }

  /**
   * Reads the registry rather than the table.
   *
   * A `SELECT … FROM customers WHERE slug = $1` outside a tenant context
   * returns nothing — correctly — so this would silently 404 every customer.
   * Filtering the registry keeps one source of truth for "what customers
   * exist", which is also what `slugExists` needs.
   */
  async findBySlug(slug: string): Promise<CustomerRegistryEntry | undefined> {
    return (await this.list()).find((entry) => entry.slug === slug);
  }

  async slugExists(slug: string): Promise<boolean> {
    return (await this.findBySlug(slug)) !== undefined;
  }

  /**
   * The id is supplied rather than defaulted, because the tenant context has to
   * be opened on it *before* the insert — that is what makes the row legal
   * under the policy instead of exempt from it.
   */
  async create(input: { id: string; slug: string; name: string }): Promise<void> {
    await this.inTenant(input.id, async (db) => {
      await db.execute(
        sql`INSERT INTO customers (id, slug, name) VALUES (${input.id}, ${input.slug}, ${input.name})`,
      );
    });
  }

  async rename(id: string, name: string): Promise<boolean> {
    return this.inTenant(id, async (db) => {
      const result = await db.execute(
        sql`UPDATE customers SET name = ${name} WHERE id = ${id}`,
      );
      // Zero rows means the policy refused it, which is the same answer as "no
      // such customer" and is deliberately not distinguished.
      return (result.rowCount ?? 0) > 0;
    });
  }

  async census(id: string): Promise<ChildCensus> {
    return this.inTenant(id, async (db) => {
      const result = await db.execute<{
        departments: number;
        projects: number;
        courses: number;
      }>(sql`
        SELECT (SELECT count(*)::int FROM departments) AS departments,
               (SELECT count(*)::int FROM projects)    AS projects,
               (SELECT count(*)::int FROM courses)     AS courses
      `);

      // No WHERE clause needed and none written: RLS has already restricted
      // every one of these tables to this customer. A `WHERE customer_id = …`
      // here would be defence in depth over a policy that is doing the work
      // (ADR-0002) — harmless, but it would also imply the policy might not be.
      const row = result.rows[0];
      return {
        department: row?.departments ?? 0,
        project: row?.projects ?? 0,
        course: row?.courses ?? 0,
      };
    });
  }

  async learnerRecords(id: string): Promise<number> {
    return this.inTenant(id, async (db) => {
      const result = await db.execute<{ total: number }>(sql`
        SELECT (SELECT count(*) FROM enrolments)
             + (SELECT count(*) FROM content_progress)
             + (SELECT count(*) FROM quiz_attempts)
             + (SELECT count(*) FROM certificates) AS total
      `);
      return Number(result.rows[0]?.total ?? 0);
    });
  }

  async remove(id: string): Promise<boolean> {
    return this.inTenant(id, async (db) => {
      const result = await db.execute(sql`DELETE FROM customers WHERE id = ${id}`);
      return (result.rowCount ?? 0) > 0;
    });
  }

  /**
   * `role: "system"` because this is not a person acting inside the tenant —
   * it is the platform acting on the tenant record itself, and the audit trail
   * should not read as though a super admin browsed in. The *operator* who
   * triggered it is recorded separately, by the service, with their staff id.
   */
  private inTenant<T>(customerId: string, work: (db: Db) => Promise<T>): Promise<T> {
    return runInTenant(this.pool, { customerId, role: "system" }, work);
  }
}

function toEntry(row: RegistryRow): CustomerRegistryEntry {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    createdAt: row.created_at,
    departmentCount: row.department_count,
    projectCount: row.project_count,
    courseCount: row.course_count,
  };
}
