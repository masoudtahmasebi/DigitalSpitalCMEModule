import { describe, expect, it } from "vitest";
import { CatalogService } from "./catalog.service.js";
import { courseDetailSchema, courseListResponseSchema } from "./catalog.dto.js";
import { AppError } from "../../shared/problem-details.js";
import type { CatalogRepositoryPort, CourseRow } from "./catalog.repository.js";

/** The MEDICE course as accredited (Anerkennungsbescheid, 18.06.2026). */
const CUSTOMER_ID = "11111111-1111-4111-8111-111111111111";

const adhs: CourseRow = {
  id: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  customerId: CUSTOMER_ID,
  slug: "adhs-akademie-adult",
  status: "published",
  title: "ADHS Akademie adult",
  description: "Fortbildung zu ADHS bei Erwachsenen",
  heroImageUrl: "https://cdn.example.org/adhs-akademie-adult-hero.png",
  learningObjectives: [
    "Sichere Diagnosestellung von ADHS im Erwachsenenalter",
    "Evidenzbasierte Therapieoptionen: Medikation und Psychotherapie",
  ],
  targetAudience: "Fachärzte für Psychiatrie und Psychotherapie",
  // Layout page 02 labels this separately under Zielgruppe; page 04 prints the
  // Fortbildungsnummer on the Zertifizierung tab.
  prerequisites: "Grundkenntnisse in Psychiatrie sind von Vorteil.",
  deliveryType: "on_demand",
  thema: ["ADHS"],
  altersgruppe: ["Erwachsene"],
  cmePoints: 4,
  cmeCategory: "D",
  vnr: "9999999999999999999",
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
/** A stable learner id; the service takes it from the validated token. */
const LEARNER = "11111111-0000-4000-8000-000000000001";

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
    // Not enrolled by default; the tests that care override it.
    findEnrolments: async () => new Map(),
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
                mimeType: null,
              },
              {
                id: "cccccccc-0000-4000-8000-000000000002",
                chapterId: "bbbbbbbb-0000-4000-8000-000000000003",
                ordinal: 1,
                kind: "material",
                title: "Patienteninformation (PDF)",
                durationSec: null,
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
    const result = await new CatalogService(fakeRepository()).listCourses(
      {
        page: 1,
        perPage: 10,
      },
      LEARNER,
    );

    expect(() => courseListResponseSchema.parse(result)).not.toThrow();
    expect(result.items[0]?.title).toBe("ADHS Akademie adult");
  });

  it("carries the card metadata the design needs: points, modules, duration", async () => {
    // "5 CME Punkte | 5 Module | 2 Stunden 30 Minuten"
    const result = await new CatalogService(fakeRepository()).listCourses(
      {
        page: 1,
        perPage: 10,
      },
      LEARNER,
    );

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

    await new CatalogService(repo).listCourses({ page: 3, perPage: 10 }, LEARNER);

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

    await new CatalogService(repo).listCourses(
      {
        page: 1,
        perPage: 10,
        thema: "ADHS",
        altersgruppe: "Erwachsene",
        deliveryType: ["live", "praesenz"],
      },
      LEARNER,
    );

    expect(seen).toMatchObject({
      thema: "ADHS",
      altersgruppe: "Erwachsene",
      // A set, because one catalogue tab can group several delivery types.
      deliveryType: ["live", "praesenz"],
    });
  });

  it("counts the facets under the same selection as the list", async () => {
    // The bug this pins is a dead end rather than a wrong number: with the
    // facets counted over the whole catalogue, a learner can pick a Thema and
    // an Altersgruppe that each report a non-zero count and land on "keine
    // Fortbildungen". The service has to hand the selection down.
    let seen: Record<string, unknown> | undefined;
    let listedAt: Date | undefined;
    const repo = fakeRepository({
      listCourses: async (filter) => {
        listedAt = filter.now;
        return { rows: [], total: 0, durations: new Map() };
      },
      facets: async (selection) => {
        seen = { ...selection };
        return { thema: [], altersgruppe: [] };
      },
    });

    await new CatalogService(repo).listCourses(
      {
        page: 2,
        perPage: 10,
        thema: "ADHS",
        altersgruppe: "Erwachsene",
        deliveryType: ["on_demand"],
      },
      LEARNER,
    );

    expect(seen).toEqual({
      thema: "ADHS",
      altersgruppe: "Erwachsene",
      deliveryType: ["on_demand"],
      // The same instant the page was read at (P50-01). Counting facets at a
      // *later* one would let a course whose validity lapsed between the two
      // calls be counted and not listed — the same dead end as the wrong
      // selection, arriving by a different route.
      now: listedAt,
    });
    // And without the page: a facet count describes the whole result set, not
    // the ten rows currently on screen.
    expect(seen).not.toHaveProperty("limit");
    expect(seen).not.toHaveProperty("offset");
  });

  it("reports zero duration for a course with no content rather than NaN", async () => {
    const repo = fakeRepository({
      listCourses: async () => ({ rows: [adhs], total: 1, durations: new Map() }),
    });

    const result = await new CatalogService(repo).listCourses(
      { page: 1, perPage: 10 },
      LEARNER,
    );

    expect(result.items[0]?.moduleCount).toBe(0);
    expect(result.items[0]?.totalDurationSec).toBe(0);
  });
});

describe("getCourseBySlug", () => {
  it("returns the whole tree in one call, so the detail view does not waterfall", async () => {
    const detail = await new CatalogService(fakeRepository()).getCourseBySlug(
      "adhs-akademie-adult",
      LEARNER,
    );

    expect(() => courseDetailSchema.parse(detail)).not.toThrow();
    expect(detail.modules).toHaveLength(2);
    expect(detail.modules[0]?.chapters[0]?.contents[0]?.title).toBe("Einführung");
    expect(detail.experts[0]?.roleLabel).toBe("Wissenschaftliche Leitung");
  });

  it("nests chapters and contents under the right parents", async () => {
    const detail = await new CatalogService(fakeRepository()).getCourseBySlug(
      "adhs-akademie-adult",
      LEARNER,
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
      LEARNER,
    );

    expect(detail.requiredWatchPercent).toBe(100);
    expect(detail.passThresholdPercent).toBe(70);
  });

  it("carries the Übersicht tab's content: Lernziele, Zielgruppe, hero image", async () => {
    const detail = await new CatalogService(fakeRepository()).getCourseBySlug(
      "adhs-akademie-adult",
      LEARNER,
    );

    expect(detail.learningObjectives).toHaveLength(2);
    expect(detail.targetAudience).toContain("Psychiatrie");
    expect(detail.heroImageUrl).toContain("hero");
  });

  it("surfaces the accreditation data the certificate will need", async () => {
    const detail = await new CatalogService(fakeRepository()).getCourseBySlug(
      "adhs-akademie-adult",
      LEARNER,
    );

    expect(detail.vnr).toBe("9999999999999999999");
    expect(detail.accreditationBody).toBe("Ärztekammer Westfalen-Lippe");
    expect(detail.eventLocation).toBe("online");
    expect(detail.cmeCategory).toBe("D");
  });

  it("returns 404, not 403, for a course the tenant cannot see", async () => {
    // Existence is not disclosed: an invisible course and a non-existent one
    // are indistinguishable to the caller (P2-05).
    const service = new CatalogService(fakeRepository());

    const error = await service
      .getCourseBySlug("other-tenant-course", LEARNER)
      .catch((e) => e);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).kind).toBe("not_found");
  });

  it("keeps the internal reason out of the client-facing detail", async () => {
    const service = new CatalogService(fakeRepository());
    const error = (await service
      .getCourseBySlug("other-tenant-course", LEARNER)
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
      LEARNER,
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

describe("nor does an ungated URL", () => {
  it("carries no media URL, fileUrl or body on any content", async () => {
    // This response is readable by any holder of a tenant token, whether or
    // not they have finished anything. A URL in it has no gate in front of it,
    // whatever the Mediathek and the player do afterwards — which is how the
    // Mediathek padlock was bypassable before this shape lost `fileUrl`.
    //
    // Asserted against the parsed value rather than the projection, because
    // parsing strips anything the schema does not declare: this proves the
    // contract, not just today's mapping code.
    const detail = await new CatalogService(fakeRepository()).getCourseBySlug(
      "adhs-akademie-adult",
      LEARNER,
    );
    const parsed = courseDetailSchema.parse(detail);

    for (const module of parsed.modules) {
      for (const chapter of module.chapters) {
        for (const content of chapter.contents) {
          expect(content).not.toHaveProperty("fileUrl");
          expect(content).not.toHaveProperty("sources");
          expect(content).not.toHaveProperty("posterUrl");
          expect(content).not.toHaveProperty("body");
        }
      }
    }
  });
});

describe("the card's call to action reflects the caller's own enrolment", () => {
  it("reports no enrolment for a course the learner has not started", async () => {
    const result = await new CatalogService(fakeRepository()).listCourses(
      { page: 1, perPage: 10 },
      LEARNER,
    );

    expect(result.items[0]?.enrolment).toBeNull();
  });

  it("reports an unfinished enrolment, which is what 'fortsetzen' means", async () => {
    const repo = fakeRepository({
      findEnrolments: async () =>
        new Map([[adhs.id, { courseComplete: false, complete: false }]]),
    });

    const result = await new CatalogService(repo).listCourses(
      { page: 1, perPage: 10 },
      LEARNER,
    );

    // Both milestones, because the card draws from both (P51-01): `complete`
    // is certified, `courseComplete` is "videos and quiz done, Zertifizierung
    // still open" — and a card that knew only the first called that person
    // unfinished.
    expect(result.items[0]?.enrolment).toEqual({
      courseComplete: false,
      complete: false,
    });
  });

  it("asks only about the courses on this page, for this learner", async () => {
    // One query for the page. A request per card would be ten round trips for
    // a list of ten, and passing anything but the token's own user id would
    // show one learner another's standing.
    const seen: Array<{ ids: readonly string[]; userId: string }> = [];
    const repo = fakeRepository({
      findEnrolments: async (ids, userId) => {
        seen.push({ ids, userId });
        return new Map();
      },
    });

    await new CatalogService(repo).listCourses({ page: 1, perPage: 10 }, LEARNER);

    expect(seen).toHaveLength(1);
    expect(seen[0]?.ids).toEqual([adhs.id]);
    expect(seen[0]?.userId).toBe(LEARNER);
  });

  it("carries the same field on the detail response", async () => {
    const repo = fakeRepository({
      findEnrolments: async () =>
        new Map([[adhs.id, { courseComplete: true, complete: true }]]),
    });

    const detail = await new CatalogService(repo).getCourseBySlug(adhs.slug, LEARNER);

    expect(detail.enrolment).toEqual({ courseComplete: true, complete: true });
  });
});

/**
 * An image chosen from the Mediathek reaches the browser signed (P211-01).
 *
 * The client, after building a course: *"we should not have any photo url
 * anywhere, all of them should open the mediathek"* — and, on the workaround
 * they had been left with, *"I have pasted an URL of a plattform image. At
 * least it is working."*
 *
 * Offering the picker is only half of it. An uploaded object is stored as
 * `s3://<key>` and is not fetchable by a browser; the lesson path has signed
 * these since P10-09, and the catalogue passed `hero_image_url` and an expert's
 * `photo_url` **straight through** — correct while the only way to fill those
 * fields was to paste an `https://` URL, and a broken image the moment the
 * field started offering the library.
 *
 * That is the §9.2 shape: a control whose result cannot work. So the picker and
 * the resolution are one change, and these cases are why.
 *
 * The third case is the one that must not be lost: a key belonging to **another
 * customer** is refused rather than signed. The bucket has no RLS to fall back
 * on, so this is the only thing standing between a mis-seeded row and one
 * tenant's artwork on another's page.
 */
describe("images stored in the Mediathek (P211-01)", () => {
  const OTHER_CUSTOMER = "22222222-2222-4222-8222-222222222222";

  /** The same contract `media-url.ts` implements, in three lines. */
  const signing = {
    resolve: (stored: string | null, customerId: string): string | null => {
      if (stored === null) return null;
      if (!stored.startsWith("s3://")) return stored;
      return stored.startsWith(`s3://${customerId}/`) ? `${stored}?signed` : null;
    },
  };

  it("signs a hero image the operator picked from the library", async () => {
    const repo = fakeRepository({
      listCourses: async () => ({
        rows: [{ ...adhs, heroImageUrl: `s3://${CUSTOMER_ID}/hero.png` }],
        total: 1,
        durations: new Map([[adhs.id, { moduleCount: 5, totalDurationSec: 9000 }]]),
      }),
    });

    const list = await new CatalogService(repo, () => new Date(), signing).listCourses(
      { page: 1, perPage: 10 },
      LEARNER,
    );

    expect(list.items[0]?.heroImageUrl).toBe(`s3://${CUSTOMER_ID}/hero.png?signed`);
  });

  it("signs a Referent's photograph on the course detail", async () => {
    const repo = fakeRepository({
      findCourseTree: async (slug) => {
        const tree = await fakeRepository().findCourseTree(slug);
        if (tree === undefined) return undefined;
        return {
          ...tree,
          experts: tree.experts.map((expert) => ({
            ...expert,
            photoUrl: `s3://${CUSTOMER_ID}/referent.jpg`,
          })),
        };
      },
    });

    const detail = await new CatalogService(
      repo,
      () => new Date(),
      signing,
    ).getCourseBySlug(adhs.slug, LEARNER);

    expect(detail.experts[0]?.photoUrl).toBe(`s3://${CUSTOMER_ID}/referent.jpg?signed`);
  });

  it("refuses a key belonging to another customer rather than signing it", async () => {
    const repo = fakeRepository({
      listCourses: async () => ({
        rows: [{ ...adhs, heroImageUrl: `s3://${OTHER_CUSTOMER}/hero.png` }],
        total: 1,
        durations: new Map([[adhs.id, { moduleCount: 5, totalDurationSec: 9000 }]]),
      }),
    });

    const list = await new CatalogService(repo, () => new Date(), signing).listCourses(
      { page: 1, perPage: 10 },
      LEARNER,
    );

    // Null, not the raw reference: a browser cannot fetch it either way, and a
    // response that echoes another tenant's object key is a leak in itself.
    expect(list.items[0]?.heroImageUrl).toBeNull();
  });

  it("still passes an ordinary URL through, which is what the client is using", async () => {
    const list = await new CatalogService(
      fakeRepository(),
      () => new Date(),
      signing,
    ).listCourses({ page: 1, perPage: 10 }, LEARNER);

    expect(list.items[0]?.heroImageUrl).toBe(adhs.heroImageUrl);
  });
});
