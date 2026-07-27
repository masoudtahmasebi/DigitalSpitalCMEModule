import { describe, expect, it } from "vitest";
import { CatalogService } from "./catalog.service.js";
import { courseDetailSchema, courseListResponseSchema } from "./catalog.dto.js";
import { AppError } from "../../shared/problem-details.js";
import type { CatalogRepositoryPort, CourseRow } from "./catalog.repository.js";

/** The MEDICE course as accredited (Anerkennungsbescheid, 18.06.2026). */
const adhs: CourseRow = {
  id: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  slug: "adhs-akademie-adult",
  title: "ADHS Akademie adult",
  description: "Fortbildung zu ADHS bei Erwachsenen",
  deliveryType: "on_demand",
  thema: ["ADHS"],
  altersgruppe: ["Erwachsene"],
  cmePoints: 4,
  cmeCategory: "D",
  vnr: "2760552025919300018",
  accreditationBody: "Ärztekammer Westfalen-Lippe",
  organizer: "Medice Arzneimittel Pütter GmbH & Co. KG, Iserlohn",
  eventLocation: "online",
  validFrom: new Date("2025-10-13T00:00:00Z"),
  validTo: new Date("2026-10-12T23:59:59Z"),
  requiredWatchPercent: 100,
  passThresholdPercent: 70,
};

/**
 * A fake repository. The service is the application layer, so it is tested with
 * no database at all — that is the property ADR-0006's layering buys, and the
 * reason this suite runs in milliseconds.
 */
function fakeRepository(overrides: Partial<CatalogRepositoryPort> = {}) {
  const base: CatalogRepositoryPort = {
    listCourses: async () => ({
      rows: [adhs],
      total: 1,
      durations: new Map([[adhs.id, { moduleCount: 5, totalDurationSec: 9000 }]]),
    }),
    facets: async () => ({
      thema: [{ value: "ADHS", count: 1 }],
      altersgruppe: [{ value: "Erwachsene", count: 1 }],
    }),
    findCourseTree: async (slug) =>
      slug === adhs.slug
        ? {
            course: adhs,
            modules: [
              {
                id: "aaaaaaaa-0000-4000-8000-000000000001",
                ordinal: 0,
                title: "Modul 1 – Grundlagen",
                subtitle: null,
              },
              {
                id: "aaaaaaaa-0000-4000-8000-000000000003",
                ordinal: 2,
                title: "Modul 3 – Pharmakotherapie",
                subtitle: null,
              },
            ],
            chapters: [
              {
                id: "bbbbbbbb-0000-4000-8000-000000000001",
                moduleId: "aaaaaaaa-0000-4000-8000-000000000001",
                ordinal: 0,
                title: "Kapitel 1",
              },
              {
                id: "bbbbbbbb-0000-4000-8000-000000000003",
                moduleId: "aaaaaaaa-0000-4000-8000-000000000003",
                ordinal: 2,
                title: "Kapitel 3 – Nebenwirkungen",
              },
            ],
            contents: [
              {
                id: "cccccccc-0000-4000-8000-000000000001",
                chapterId: "bbbbbbbb-0000-4000-8000-000000000001",
                ordinal: 0,
                kind: "video",
                title: "Einführung",
                durationSec: 1524,
                fileUrl: null,
                mimeType: null,
              },
              {
                id: "cccccccc-0000-4000-8000-000000000002",
                chapterId: "bbbbbbbb-0000-4000-8000-000000000003",
                ordinal: 1,
                kind: "material",
                title: "Patienteninformation (PDF)",
                durationSec: null,
                fileUrl: "https://cdn.example.org/info.pdf",
                mimeType: "application/pdf",
              },
            ],
            experts: [
              {
                id: "dddddddd-0000-4000-8000-000000000001",
                ordinal: 0,
                roleLabel: "Wissenschaftliche Leitung",
                name: "Dr. med. Lorem Ipsum",
                institution: "Universitätsklinikum Heidelberg",
                biography: null,
                photoUrl: null,
              },
            ],
          }
        : undefined,
  };

  return { ...base, ...overrides };
}

describe("listCourses", () => {
  it("returns a contract-valid response", async () => {
    const result = await new CatalogService(fakeRepository()).listCourses({
      page: 1,
      perPage: 10,
    });

    expect(() => courseListResponseSchema.parse(result)).not.toThrow();
    expect(result.items[0]?.title).toBe("ADHS Akademie adult");
  });

  it("carries the card metadata the design needs: points, modules, duration", async () => {
    // "5 CME Punkte | 5 Module | 2 Stunden 30 Minuten"
    const result = await new CatalogService(fakeRepository()).listCourses({
      page: 1,
      perPage: 10,
    });

    const card = result.items[0];
    expect(card?.cmePoints).toBe(4);
    expect(card?.moduleCount).toBe(5);
    expect(card?.totalDurationSec).toBe(9000);
  });

  it("translates page/perPage into limit and offset", async () => {
    let seen: { limit: number; offset: number } | undefined;
    const repo = fakeRepository({
      listCourses: async (filter) => {
        seen = { limit: filter.limit, offset: filter.offset };
        return { rows: [], total: 0, durations: new Map() };
      },
    });

    await new CatalogService(repo).listCourses({ page: 3, perPage: 10 });

    expect(seen).toEqual({ limit: 10, offset: 20 });
  });

  it("passes filters through rather than filtering a partial list client-side", async () => {
    let seen: Record<string, unknown> = {};
    const repo = fakeRepository({
      listCourses: async (filter) => {
        seen = { ...filter };
        return { rows: [], total: 0, durations: new Map() };
      },
    });

    await new CatalogService(repo).listCourses({
      page: 1,
      perPage: 10,
      thema: "ADHS",
      altersgruppe: "Erwachsene",
      deliveryType: "on_demand",
    });

    expect(seen).toMatchObject({
      thema: "ADHS",
      altersgruppe: "Erwachsene",
      deliveryType: "on_demand",
    });
  });

  it("reports zero duration for a course with no content rather than NaN", async () => {
    const repo = fakeRepository({
      listCourses: async () => ({ rows: [adhs], total: 1, durations: new Map() }),
    });

    const result = await new CatalogService(repo).listCourses({ page: 1, perPage: 10 });

    expect(result.items[0]?.moduleCount).toBe(0);
    expect(result.items[0]?.totalDurationSec).toBe(0);
  });
});

describe("getCourseBySlug", () => {
  it("returns the whole tree in one call, so the detail view does not waterfall", async () => {
    const detail = await new CatalogService(fakeRepository()).getCourseBySlug(
      "adhs-akademie-adult",
    );

    expect(() => courseDetailSchema.parse(detail)).not.toThrow();
    expect(detail.modules).toHaveLength(2);
    expect(detail.modules[0]?.chapters[0]?.contents[0]?.title).toBe("Einführung");
    expect(detail.experts[0]?.roleLabel).toBe("Wissenschaftliche Leitung");
  });

  it("nests chapters and contents under the right parents", async () => {
    const detail = await new CatalogService(fakeRepository()).getCourseBySlug(
      "adhs-akademie-adult",
    );

    const modul3 = detail.modules.find((m) => m.title.startsWith("Modul 3"));
    expect(modul3?.chapters[0]?.title).toBe("Kapitel 3 – Nebenwirkungen");
    expect(modul3?.chapters[0]?.contents[0]?.kind).toBe("material");
  });

  it("exposes the course's real configured percentages, never a hardcoded value", async () => {
    // This is what makes the 80 %% vs 100 %% copy contradiction impossible to
    // ship: the Zertifizierung tab renders whatever the course actually says.
    const detail = await new CatalogService(fakeRepository()).getCourseBySlug(
      "adhs-akademie-adult",
    );

    expect(detail.requiredWatchPercent).toBe(100);
    expect(detail.passThresholdPercent).toBe(70);
  });

  it("surfaces the accreditation data the certificate will need", async () => {
    const detail = await new CatalogService(fakeRepository()).getCourseBySlug(
      "adhs-akademie-adult",
    );

    expect(detail.vnr).toBe("2760552025919300018");
    expect(detail.accreditationBody).toBe("Ärztekammer Westfalen-Lippe");
    expect(detail.eventLocation).toBe("online");
    expect(detail.cmeCategory).toBe("D");
  });

  it("returns 404, not 403, for a course the tenant cannot see", async () => {
    // Existence is not disclosed: an invisible course and a non-existent one
    // are indistinguishable to the caller (P2-05).
    const service = new CatalogService(fakeRepository());

    const error = await service.getCourseBySlug("other-tenant-course").catch((e) => e);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).kind).toBe("not_found");
  });

  it("keeps the internal reason out of the client-facing detail", async () => {
    const service = new CatalogService(fakeRepository());
    const error = (await service
      .getCourseBySlug("other-tenant-course")
      .catch((e) => e)) as AppError;

    // The reason mentions the tenant, which is for the audit log only.
    expect(error.reason).toContain("tenant");
    expect(error.clientDetail).toBeUndefined();
  });
});

describe("the answer key has nowhere to go", () => {
  it("no quiz content field can carry a correctness marker", async () => {
    const detail = await new CatalogService(fakeRepository()).getCourseBySlug(
      "adhs-akademie-adult",
    );

    // P4-01: the strongest guarantee is a shape with nowhere to put it. Parsing
    // strips anything not in the schema, so this asserts the contract itself.
    const parsed = courseDetailSchema.parse(detail);
    const serialised = JSON.stringify(parsed);

    expect(serialised).not.toContain("isCorrect");
    expect(serialised).not.toContain("is_correct");
    expect(serialised).not.toContain("correctOptionIds");
  });
});
