/**
 * Customer lifecycle (P12-04). Application layer — ADR-0006.
 *
 * Orchestration only: whether a customer may be deleted is decided by
 * `deletionVerdict` in `packages/domain`, which is pure and exhaustively
 * tested. This file gathers the counts, turns a verdict into an HTTP refusal
 * and writes the audit row.
 *
 * ## Why deletion refuses instead of cascading
 *
 * A cascade from here would remove a customer's departments, projects, courses,
 * every learner's recorded progress and every certificate, from one request,
 * transactionally, with no way back. The schema already refuses it — every
 * `customer_id` foreign key is `ON DELETE RESTRICT` — so cascading would mean
 * fighting the schema to do the more dangerous thing. The refusal names the
 * counts, because "cannot delete" without them sends somebody hunting through
 * six levels for the one course they forgot.
 *
 * ## Why every write is audited with the operator's own id
 *
 * The repository opens each tenant context with `role: "system"`, since the
 * platform is acting on the tenant record rather than a person browsing inside
 * it. That would leave no trace of *which* operator did it, so the audit row is
 * written here, with the staff account id and `identity: "staff"` (ADR-0012).
 * Creating and deleting a customer are the two most consequential operations in
 * the product; neither may be anonymous.
 */

import { randomUUID } from "node:crypto";
import { deletionVerdict, type HierarchyLevel } from "@ds/domain";
import type { AuditServicePort } from "../../audit/audit.service.js";
import { AppError } from "../../shared/problem-details.js";
import type { CustomerRepositoryPort } from "./customer.repository.js";
import type { CustomerCreate, CustomerSummary, CustomerUpdate } from "./customer.dto.js";

/** Who is acting. Always a staff account — no learner reaches this module. */
export interface OperatorContext {
  readonly staffUserId: string;
}

/** German labels for the refusal message. Plural, because a refusal counts. */
const LEVEL_LABEL: Readonly<Record<HierarchyLevel, string>> = {
  customer: "Kunden",
  department: "Abteilungen",
  project: "Projekte",
  course: "Kurse",
  module: "Module",
  chapter: "Kapitel",
  content: "Inhalte",
};

export class CustomerService {
  constructor(
    private readonly repository: CustomerRepositoryPort,
    private readonly audit: AuditServicePort,
  ) {}

  async list(): Promise<CustomerSummary[]> {
    return (await this.repository.list()).map(toSummary);
  }

  async get(slug: string): Promise<CustomerSummary> {
    return toSummary(await this.require(slug));
  }

  async create(input: CustomerCreate, actor: OperatorContext): Promise<CustomerSummary> {
    if (await this.repository.slugExists(input.slug)) {
      throw new AppError(
        "conflict",
        `customer slug=${input.slug} already exists`,
        `Der Kürzel „${input.slug}" ist bereits vergeben.`,
      );
    }

    // Generated here, not defaulted by the database, because the tenant context
    // has to be opened on this id before the insert — that is what makes the
    // row legal under the RLS policy rather than exempt from it.
    const id = randomUUID();
    await this.repository.create({ id, slug: input.slug, name: input.name });

    await this.audit.recordForCustomer(id, {
      actor: { identity: "staff", id: actor.staffUserId },
      action: "customer.create",
      subject: id,
      detail: { slug: input.slug },
    });

    return toSummary(await this.require(input.slug));
  }

  async update(
    slug: string,
    input: CustomerUpdate,
    actor: OperatorContext,
  ): Promise<CustomerSummary> {
    const existing = await this.require(slug);
    const renamed = await this.repository.rename(existing.id, input.name);
    if (!renamed) {
      // The registry said it exists and the tenant-scoped update disagreed.
      // Concurrent deletion is the ordinary explanation.
      throw AppError.notFound(`customer slug=${slug} disappeared during update`);
    }

    await this.audit.recordForCustomer(existing.id, {
      actor: { identity: "staff", id: actor.staffUserId },
      action: "customer.update",
      subject: existing.id,
      // The name itself is a company name, not personal data, but it is also
      // not needed to answer "who changed what" — the before and after are both
      // recoverable from the row's history.
      detail: { slug },
    });

    return toSummary(await this.require(slug));
  }

  async remove(slug: string, actor: OperatorContext): Promise<void> {
    const existing = await this.require(slug);

    const verdict = deletionVerdict({
      learnerRecords: await this.repository.learnerRecords(existing.id),
      children: await this.repository.census(existing.id),
    });

    if (!verdict.ok) throw refusal(verdict, existing.name);

    const removed = await this.repository.remove(existing.id);
    if (!removed)
      throw AppError.notFound(`customer slug=${slug} disappeared during delete`);

    // Audited *after* the row is gone, and against the id that no longer
    // resolves. `audit_log.customer_id` has no foreign key precisely so the
    // trail survives the thing it describes.
    await this.audit.recordForCustomer(existing.id, {
      actor: { identity: "staff", id: actor.staffUserId },
      action: "customer.delete",
      subject: existing.id,
      detail: { slug },
    });
  }

  private async require(slug: string) {
    const entry = await this.repository.findBySlug(slug);
    if (entry === undefined) throw AppError.notFound(`customer slug=${slug} not found`);
    return entry;
  }
}

function refusal(
  verdict: Exclude<ReturnType<typeof deletionVerdict>, { ok: true }>,
  name: string,
): AppError {
  if (verdict.reason === "learner_records") {
    return new AppError(
      "conflict",
      `refused: ${verdict.learnerRecords} learner records reference customer`,
      `Für „${name}" sind bereits ${verdict.learnerRecords} Teilnahmen erfasst. Der Kunde kann nicht gelöscht werden, weil damit der Nachweis zu bereits vergebenen CME-Punkten verloren ginge.`,
    );
  }

  const listed = verdict.children
    .map((child) => `${child.count} ${LEVEL_LABEL[child.level]}`)
    .join(", ");

  return new AppError(
    "conflict",
    `refused: customer still contains ${listed}`,
    `„${name}" enthält noch ${listed}. Diese müssen zuerst gelöscht werden.`,
  );
}

function toSummary(entry: {
  slug: string;
  name: string;
  createdAt: Date;
  departmentCount: number;
  projectCount: number;
  courseCount: number;
}): CustomerSummary {
  return {
    slug: entry.slug,
    name: entry.name,
    createdAt: entry.createdAt.toISOString(),
    departmentCount: entry.departmentCount,
    projectCount: entry.projectCount,
    courseCount: entry.courseCount,
  };
}
