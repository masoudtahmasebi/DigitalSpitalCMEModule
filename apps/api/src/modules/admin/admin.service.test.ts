import { describe, expect, it } from "vitest";
import { AdminService, ACCREDITED_MIN_PASS_PERCENT } from "./admin.service.js";
import { adminCourseDetailSchema, participantListSchema } from "./admin.dto.js";
import { AppError } from "../../shared/problem-details.js";
import { PlaintextSecretCipher } from "../../shared/secret-cipher.js";
import type {
  AdminCourseRow,
  AdminRepositoryPort,
  CertificateAssetPatch,
  CoursePatch,
  EnrolmentListRow,
  ProjectFontPatch,
  ProjectFontState,
} from "./admin.repository.js";
import type {
  CourseTree,
  LearningRepositoryPort,
  ProgressRow,
} from "../learning/learning.repository.js";

const COURSE_ID = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
const ENROLMENT_ID = "a1b2c3d4-0000-4000-8000-000000000001";
const USER_ID = "11111111-0000-4000-8000-000000000001";
const CUSTOMER_ID = "22222222-0000-4000-8000-000000000001";
const M1 = "aaaaaaaa-0000-4000-8000-000000000001";
const C1 = "bbbbbbbb-0000-4000-8000-000000000001";
const VIDEO = "cccccccc-0000-4000-8000-000000000001";

const NOW = new Date("2026-07-28T10:00:00Z");
const PROJECT_SLUG = "medice-adhs";
const actor = {
  customerId: CUSTOMER_ID,
  userId: USER_ID,
  identity: "staff",
} as const;

/** 1×1 opaque PNG. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
).toString("base64");

/** 1×1 baseline JPEG. */
const JPEG =
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oACAEBAAA/AP38ooooA//Z";

const course: AdminCourseRow = {
  id: COURSE_ID,
  slug: "adhs-akademie-adult",
  title: "ADHS Akademie adult",
  description: null,
  deliveryType: "on_demand",
  thema: [],
  altersgruppe: [],
  learningObjectives: [],
  targetAudience: null,
  prerequisites: null,
  heroImageUrl: null,
  fortbildungsnummer: null,
  validFrom: null,
  validTo: null,
  vnr: "9999999999999999999",
  cmePoints: 4,
  cmeCategory: "D",
  requiredWatchPercent: 100,
  passThresholdPercent: 70,
  maxQuizAttempts: null,
  revealCorrectAnswers: false,
  organizer: "Medice Arzneimittel Pütter GmbH & Co. KG, Iserlohn",
  eventLocation: "online",
  accreditationBody: "Ärztekammer Westfalen-Lippe",
  scientificLeadName: "Muster-Leitung",
  scientificLeadTitle: "Prof. Dr. med.",
  certificateIssuePlace: "Iserlohn",
  hasStampImage: true,
  hasSignatureImage: true,
  hasVnrPassword: false,
  eivPunkteBasis: true,
  eivPunkteLernerfolg: true,
};

const tree: CourseTree = {
  modules: [{ id: M1, ordinal: 0, title: "Modul 1" }],
  chapters: [{ id: C1, moduleId: M1, ordinal: 0 }],
  contents: [
    {
      id: VIDEO,
      chapterId: C1,
      ordinal: 0,
      kind: "video",
      durationSec: 600,
      title: "Grundlagen",
      body: null,
      mediaSources: [],
      posterUrl: null,
      captionsUrl: null,
      fileUrl: null,
      mimeType: null,
      fileSize: null,
    },
  ],
};

const enrolment: EnrolmentListRow = {
  enrolmentId: ENROLMENT_ID,
  userId: USER_ID,
  requiredWatchPercent: 100,
  passThresholdPercent: 70,
  completedAt: null,
  cmePoints: 4,
  attestedName: null,
  firstName: "Anna",
  lastName: "Müller",
  email: "anna@example.org",
};

function build(
  options: {
    course?: Partial<AdminCourseRow>;
    enrolments?: EnrolmentListRow[];
    progress?: ProgressRow[];
    submission?: {
      status: string;
      attemptCount: number;
      reportDueAt: Date;
    };
    efnPresent?: boolean;
    evaluationSubmitted?: boolean;
  } = {},
) {
  const patches: CoursePatch[] = [];
  const assetPatches: CertificateAssetPatch[] = [];
  const fontPatches: ProjectFontPatch[] = [];
  const audits: Array<Record<string, unknown>> = [];
  const row = { ...course, ...options.course };

  // The project row, as the font endpoints see it. `undefined` stands for a
  // slug that is not visible in this tenant.
  let font: ProjectFontState = {
    fontFamilyName: null,
    fontUpdatedAt: null,
    fontBytes: null,
  };

  const repository: AdminRepositoryPort = {
    listCourses: async () => [row],
    findCourse: async (slug) => (slug === row.slug ? row : undefined),
    countEnrolments: async () => new Map([[row.id, { total: 1, completed: 0 }]]),
    updateCourse: async (_id, patch) => {
      patches.push(patch);
    },
    setCertificateAssets: async (_id, assets) => {
      assetPatches.push(assets);
    },
    findProjectFont: async (slug) => (slug === PROJECT_SLUG ? font : undefined),
    setProjectFont: async (slug, patch) => {
      if (slug !== PROJECT_SLUG) return undefined;
      fontPatches.push(patch);
      font = {
        fontFamilyName: patch.fontFamilyName,
        fontUpdatedAt: patch.fontUpdatedAt,
        fontBytes: patch.fontFile?.byteLength ?? null,
      };
      return font;
    },
    listEnrolments: async () => options.enrolments ?? [enrolment],
    findProgressByEnrolment: async () =>
      new Map([[ENROLMENT_ID, options.progress ?? []]]),
    findEvaluationSubmitted: async () =>
      options.evaluationSubmitted === true ? new Set([ENROLMENT_ID]) : new Set(),
    findEfnPresent: async () =>
      options.efnPresent === true ? new Set([USER_ID]) : new Set(),
    findSubmissions: async () =>
      options.submission === undefined
        ? new Map()
        : new Map([
            [
              ENROLMENT_ID,
              {
                enrolmentId: ENROLMENT_ID,
                ...options.submission,
              } as never,
            ],
          ]),
    findCertificates: async () => new Map(),
    audit: async (entry) => {
      audits.push(entry as unknown as Record<string, unknown>);
    },
  };

  const learning = {
    findCourseTree: async () => tree,
  } as unknown as LearningRepositoryPort;

  const service = new AdminService(
    repository,
    learning,
    new PlaintextSecretCipher("test"),
  );

  return { service, patches, assetPatches, fontPatches, audits };
}

describe("the accreditation threshold is a rule, not a preference", () => {
  it("refuses to lower the pass threshold without an explicit acknowledgement", async () => {
    // The Bescheid: "Voraussetzung für die Punktevergaben ist, dass der Anteil
    // der richtig beantworteten Fragen … mindestens 70 % beträgt." An admin
    // lowering it is voiding the accreditation, not tuning difficulty.
    const error = (await build()
      .service.updateCourse("adhs-akademie-adult", { passThresholdPercent: 50 }, actor)
      .catch((e) => e)) as AppError;

    expect(error.kind).toBe("conflict");
    expect(error.clientDetail).toContain("Anerkennungsbescheid");
  });

  it("does not write anything when it refuses", async () => {
    const { service, patches } = build();

    await service
      .updateCourse("adhs-akademie-adult", { passThresholdPercent: 50 }, actor)
      .catch(() => undefined);

    expect(patches).toEqual([]);
  });

  it("allows it once the risk is acknowledged, and records that in the audit", async () => {
    // The confirmation is server-side because a confirmation a client can skip
    // is not a confirmation.
    const { service, patches, audits } = build();

    await service.updateCourse(
      "adhs-akademie-adult",
      { passThresholdPercent: 50, acknowledgeAccreditationRisk: true },
      actor,
    );

    expect(patches[0]?.passThresholdPercent).toBe(50);
    expect(audits[0]?.["detail"]).toMatchObject({
      accreditationRiskAcknowledged: true,
      newPassThreshold: 50,
    });
  });

  it("needs no acknowledgement at or above the accredited minimum", async () => {
    const { service, patches } = build();

    await service.updateCourse(
      "adhs-akademie-adult",
      { passThresholdPercent: ACCREDITED_MIN_PASS_PERCENT },
      actor,
    );

    expect(patches[0]?.passThresholdPercent).toBe(ACCREDITED_MIN_PASS_PERCENT);
  });

  it("needs no acknowledgement when raising it", async () => {
    const { service, patches } = build();
    await service.updateCourse(
      "adhs-akademie-adult",
      { passThresholdPercent: 90 },
      actor,
    );
    expect(patches[0]?.passThresholdPercent).toBe(90);
  });
});

describe("secrets", () => {
  it("encrypts the VNR password before it reaches the repository", async () => {
    const { service, patches } = build();

    await service.updateCourse("adhs-akademie-adult", { vnrPassword: "s3cret" }, actor);

    // The plaintext cipher is identity in test, so this asserts the *shape*:
    // the repository receives a Buffer on the `_enc` column, never a string on
    // a plaintext one.
    expect(patches[0]?.vnrPasswordEnc).toBeInstanceOf(Buffer);
    expect("vnrPassword" in (patches[0] ?? {})).toBe(false);
  });

  it("never puts the password value in the audit trail", async () => {
    const { service, audits } = build();

    await service.updateCourse("adhs-akademie-adult", { vnrPassword: "s3cret" }, actor);

    expect(JSON.stringify(audits)).not.toContain("s3cret");
    // Field names are fine and are what makes the audit useful.
    expect(JSON.stringify(audits)).toContain("vnrPasswordEnc");
  });

  it("never returns the password, only whether one is stored", async () => {
    const detail = await build({ course: { hasVnrPassword: true } }).service.getCourse(
      "adhs-akademie-adult",
    );

    const parsed = adminCourseDetailSchema.parse(detail);
    expect(parsed.hasVnrPassword).toBe(true);
    expect(JSON.stringify(parsed)).not.toContain('vnrPassword":"');
  });

  it("leaves the password alone when the patch does not mention it", async () => {
    // An admin editing the issue place must not have to resend a credential to
    // avoid clearing it.
    const { service, patches } = build();

    await service.updateCourse(
      "adhs-akademie-adult",
      { certificateIssuePlace: "Münster" },
      actor,
    );

    expect(patches[0]).toEqual({ certificateIssuePlace: "Münster" });
  });
});

describe("certificate assets", () => {
  it("accepts a PNG and records its sniffed type", async () => {
    const { service, assetPatches } = build();

    await service.setCertificateAssets(
      "adhs-akademie-adult",
      { stampImageBase64: PNG, stampImageMime: "image/png" },
      actor,
    );

    expect(assetPatches[0]?.stampImageMime).toBe("image/png");
    expect(assetPatches[0]?.stampImage).toBeInstanceOf(Buffer);
  });

  it("accepts a JPEG signature", async () => {
    const { service, assetPatches } = build();

    await service.setCertificateAssets(
      "adhs-akademie-adult",
      { signatureImageBase64: JPEG, signatureImageMime: "image/jpeg" },
      actor,
    );

    expect(assetPatches[0]?.signatureImageMime).toBe("image/jpeg");
  });

  it("rejects a file that is not an image, whatever it claims to be", async () => {
    // SVG is excluded by the column constraint because it is executable
    // markup — but the check that matters is the magic bytes, since the
    // declared type is a claim by the uploader.
    const svg = Buffer.from('<svg onload="alert(1)"></svg>').toString("base64");

    const error = (await build()
      .service.setCertificateAssets(
        "adhs-akademie-adult",
        { stampImageBase64: svg, stampImageMime: "image/png" },
        actor,
      )
      .catch((e) => e)) as AppError;

    expect(error.kind).toBe("validation");
  });

  it("rejects a PNG declared as a JPEG", async () => {
    const error = (await build()
      .service.setCertificateAssets(
        "adhs-akademie-adult",
        { stampImageBase64: PNG, stampImageMime: "image/jpeg" },
        actor,
      )
      .catch((e) => e)) as AppError;

    expect(error.kind).toBe("validation");
  });

  it("rejects an oversized image before it reaches the column constraint", async () => {
    const huge = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      Buffer.alloc(600_000),
    ]).toString("base64");

    const error = (await build()
      .service.setCertificateAssets(
        "adhs-akademie-adult",
        { stampImageBase64: huge },
        actor,
      )
      .catch((e) => e)) as AppError;

    expect(error.kind).toBe("validation");
    expect(error.clientDetail).toContain("512 KB");
  });

  it("refuses an upload containing neither image", async () => {
    const error = (await build()
      .service.setCertificateAssets("adhs-akademie-adult", {}, actor)
      .catch((e) => e)) as AppError;

    expect(error.kind).toBe("validation");
  });

  it("audits sizes, not bytes", async () => {
    const { service, audits } = build();

    await service.setCertificateAssets(
      "adhs-akademie-adult",
      { stampImageBase64: PNG },
      actor,
    );

    expect(audits[0]?.["detail"]).toMatchObject({ stampBytes: expect.any(Number) });
    expect(JSON.stringify(audits)).not.toContain(PNG.slice(0, 20));
  });
});

describe("certificate readiness matches what the certificate endpoint enforces", () => {
  it("reports a fully configured course as ready", async () => {
    const [summary] = await build().service.listCourses();
    expect(summary?.certificateReady).toBe(true);
    expect(summary?.missingCertificateFields).toEqual([]);
  });

  it("names the missing stamp rather than only saying not ready", async () => {
    const [summary] = await build({
      course: { hasStampImage: false },
    }).service.listCourses();

    expect(summary?.certificateReady).toBe(false);
    expect(summary?.missingCertificateFields).toContain("stampImage");
  });

  it("names a missing data field too", async () => {
    const [summary] = await build({
      course: { scientificLeadName: null, vnr: null },
    }).service.listCourses();

    expect(summary?.missingCertificateFields).toEqual(
      expect.arrayContaining(["vnr", "scientificLeadName"]),
    );
  });

  it("does not report the learner's own fields as course gaps", async () => {
    // `participantName` and `completedAt` belong to a participation, not to
    // the course, so a course with neither is still correctly configured.
    const [summary] = await build().service.listCourses();
    expect(summary?.missingCertificateFields).not.toContain("participantName");
    expect(summary?.missingCertificateFields).not.toContain("completedAt");
  });
});

describe("the participant list", () => {
  const watchedFully: ProgressRow[] = [
    {
      contentId: VIDEO,
      status: "completed",
      watchedPercent: 100,
      watchedSegments: [{ startSec: 0, endSec: 600 }],
      lastPositionSec: 600,
      scorePercent: null,
      updatedAt: NOW,
    },
  ];

  it("returns a contract-valid list", async () => {
    const list = await build().service.listParticipants("adhs-akademie-adult", NOW);
    expect(() => participantListSchema.parse(list)).not.toThrow();
  });

  it("reports the same watched percentage the learner's own screen shows", async () => {
    // CLAUDE.md §4 invariant 6 — the integration suite proves this end to end
    // against a real learner request; here it is the unit-level guard.
    const list = await build({ progress: watchedFully }).service.listParticipants(
      "adhs-akademie-adult",
      NOW,
    );

    expect(list.rows[0]?.watchedPercent).toBe(100);
    expect(list.rows[0]?.progressPercent).toBe(100);
  });

  it("counts a partially watched video as partial, not as done", async () => {
    const list = await build({
      progress: [
        {
          ...watchedFully[0]!,
          watchedPercent: 40,
          watchedSegments: [{ startSec: 0, endSec: 240 }],
          status: "in_progress",
        },
      ],
    }).service.listParticipants("adhs-akademie-adult", NOW);

    expect(list.rows[0]?.watchedPercent).toBe(40);
    expect(list.rows[0]?.complete).toBe(false);
  });

  it("never returns an EFN, only whether one is on file", async () => {
    const list = await build({ efnPresent: true }).service.listParticipants(
      "adhs-akademie-adult",
      NOW,
    );

    expect(list.rows[0]?.efnPresent).toBe(true);
    expect(JSON.stringify(list)).not.toContain('efn":"');
  });

  it("prefers the attested name, which is what the certificate prints", async () => {
    const list = await build({
      enrolments: [{ ...enrolment, attestedName: "Dr. med. Anna Müller" }],
    }).service.listParticipants("adhs-akademie-adult", NOW);

    expect(list.rows[0]?.participantName).toBe("Dr. med. Anna Müller");
  });

  it("falls back to the profile name when none was attested", async () => {
    const list = await build().service.listParticipants("adhs-akademie-adult", NOW);
    expect(list.rows[0]?.participantName).toBe("Anna Müller");
  });
});

describe("EIV state is what an admin has to act on", () => {
  const due = new Date("2026-08-05T21:59:59Z");

  it("calls a healthy queued submission queued", async () => {
    const list = await build({
      submission: { status: "queued", attemptCount: 1, reportDueAt: due },
    }).service.listParticipants("adhs-akademie-adult", NOW);

    expect(list.rows[0]?.eivState).toBe("queued");
  });

  it("flags one that burned through the fast retries", async () => {
    // P7-06 retries three times at 10-minute intervals. Still queued after
    // that will not fix itself, and folding it into a generic count is how a
    // statutory deadline passes quietly.
    const list = await build({
      submission: { status: "queued", attemptCount: 3, reportDueAt: due },
    }).service.listParticipants("adhs-akademie-adult", NOW);

    expect(list.rows[0]?.eivState).toBe("needs_attention");
  });

  it("flags one whose reporting deadline has passed while still queued", async () => {
    const list = await build({
      submission: {
        status: "queued",
        attemptCount: 0,
        reportDueAt: new Date("2026-07-01T00:00:00Z"),
      },
    }).service.listParticipants("adhs-akademie-adult", NOW);

    expect(list.rows[0]?.eivState).toBe("needs_attention");
  });

  it("flags a retryable failure", async () => {
    const list = await build({
      submission: { status: "failed_retryable", attemptCount: 2, reportDueAt: due },
    }).service.listParticipants("adhs-akademie-adult", NOW);

    expect(list.rows[0]?.eivState).toBe("needs_attention");
  });

  it("distinguishes an abandoned submission from one needing attention", async () => {
    // A closed correction window cannot be rescued electronically — the paper
    // fallback is the only route, and that is a different action.
    for (const status of ["failed_permanent", "window_closed"]) {
      const list = await build({
        submission: { status, attemptCount: 4, reportDueAt: due },
      }).service.listParticipants("adhs-akademie-adult", NOW);

      expect(list.rows[0]?.eivState).toBe("abandoned");
    }
  });

  it("reports no submission as none, not as a failure", async () => {
    const list = await build().service.listParticipants("adhs-akademie-adult", NOW);
    expect(list.rows[0]?.eivState).toBe("none");
    expect(list.rows[0]?.eivReportDueAt).toBeNull();
  });
});

describe("a course outside the tenant", () => {
  it("is a 404, not a 403 — existence is never disclosed", async () => {
    const error = (await build()
      .service.getCourse("some-other-course")
      .catch((e) => e)) as AppError;

    expect(error.kind).toBe("not_found");
  });
});

/**
 * A structurally valid font container: the right signature and a length field
 * that agrees with the file. Nothing else about it is a real font, and nothing
 * here needs it to be — the platform never parses glyphs, it only decides
 * whether it is willing to store and serve these bytes.
 */
function fontFile(signature: string, totalBytes = 64, declaredLength = totalBytes) {
  const bytes = Buffer.alloc(totalBytes);
  bytes.write(signature, 0, "ascii");
  bytes.writeUInt32BE(declaredLength, 8);
  return bytes.toString("base64");
}

describe("the white-label font is decided by its bytes", () => {
  it("stores a woff2 and reports it back without the file", async () => {
    const { service, fontPatches } = build();

    const state = await service.setFont(
      PROJECT_SLUG,
      { fontBase64: fontFile("wOF2", 96), fontFamilyName: "Medice Sans" },
      actor,
    );

    expect(state.fontFamilyName).toBe("Medice Sans");
    expect(state.fontBytes).toBe(96);
    // A version is what makes a year-long cache safe to set on the file.
    expect(state.fontVersion).not.toBeNull();
    // And nothing in the response is the font.
    expect(JSON.stringify(state)).not.toContain(fontFile("wOF2", 96).slice(0, 16));

    expect(fontPatches[0]?.fontMime).toBe("font/woff2");
  });

  it("refuses an SVG font whatever it claims to be", async () => {
    // The upload that must never succeed: executable markup, served from our
    // own origin, to a page that holds a physician's bearer token.
    const { service, fontPatches } = build();
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'.padEnd(
        64,
        " ",
      ),
    ).toString("base64");

    const error = (await service
      .setFont(
        PROJECT_SLUG,
        { fontBase64: svg, fontMime: "font/woff2", fontFamilyName: "Evil Sans" },
        actor,
      )
      .catch((e) => e)) as AppError;

    expect(error.kind).toBe("validation");
    // Nothing was written.
    expect(fontPatches).toEqual([]);
  });

  it("refuses a font with data appended to it", async () => {
    const { service, fontPatches } = build();
    const polyglot = Buffer.concat([
      Buffer.from(fontFile("wOF2", 64), "base64"),
      Buffer.from("<html>"),
    ]).toString("base64");

    await service
      .setFont(PROJECT_SLUG, { fontBase64: polyglot, fontFamilyName: "X" }, actor)
      .catch(() => undefined);

    expect(fontPatches).toEqual([]);
  });

  it("refuses a declared type that disagrees with the file", async () => {
    const { service } = build();

    const error = (await service
      .setFont(
        PROJECT_SLUG,
        {
          fontBase64: fontFile("wOFF"),
          fontMime: "font/woff2",
          fontFamilyName: "Medice Sans",
        },
        actor,
      )
      .catch((e) => e)) as AppError;

    expect(error.kind).toBe("validation");
  });

  it("says the same thing to the admin however the file is wrong", async () => {
    // The log distinguishes "not a font" from "font with a payload appended";
    // the admin does not, because the difference tells an uploader exactly
    // which check they tripped.
    const { service } = build();

    const messages = await Promise.all(
      [fontFile("OTTO"), fontFile("wOF2", 64, 4096)].map((file) =>
        service
          .setFont(PROJECT_SLUG, { fontBase64: file, fontFamilyName: "X" }, actor)
          .catch((e: AppError) => e.clientDetail),
      ),
    );

    expect(messages[0]).toBe(messages[1]);
  });

  it("audits the upload by size and format, never by content", async () => {
    const { service, audits } = build();

    await service.setFont(
      PROJECT_SLUG,
      { fontBase64: fontFile("wOF2", 96), fontFamilyName: "Medice Sans" },
      actor,
    );

    expect(audits[0]).toMatchObject({
      action: "admin.project.font.set",
      detail: { bytes: 96, mime: "font/woff2" },
    });
  });

  it("clears all four columns together", async () => {
    // The table has a CHECK saying all or nothing: a family name with no file
    // would name a family nothing declares.
    const { service, fontPatches } = build();

    await service.setFont(
      PROJECT_SLUG,
      { fontBase64: fontFile("wOF2"), fontFamilyName: "Medice Sans" },
      actor,
    );
    const state = await service.clearFont(PROJECT_SLUG, actor);

    expect(state).toEqual({ fontFamilyName: null, fontVersion: null, fontBytes: null });
    expect(fontPatches[1]).toEqual({
      fontFile: null,
      fontMime: null,
      fontFamilyName: null,
      fontUpdatedAt: null,
    });
  });

  it("treats an invisible project as not found rather than creating one", async () => {
    const { service, fontPatches } = build();

    const error = (await service
      .setFont(
        "some-other-tenants-project",
        { fontBase64: fontFile("wOF2"), fontFamilyName: "Medice Sans" },
        actor,
      )
      .catch((e) => e)) as AppError;

    expect(error.kind).toBe("not_found");
    expect(fontPatches).toEqual([]);
  });
});
