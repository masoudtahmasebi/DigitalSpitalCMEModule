/**
 * Admin console use cases (P9). Application layer — ADR-0006.
 *
 * ## The rule this file is mostly about
 *
 * `pass_threshold_percent` is a **condition of the Anerkennungsbescheid**, not
 * a difficulty setting. For the MEDICE course the ÄKWL requires at least 70 %:
 *
 * > "Voraussetzung für die Punktevergaben ist, dass der Anteil der richtig
 * >  beantworteten Fragen … mindestens 70 % beträgt."
 *
 * An admin lowering it is not tuning a course, they are voiding its
 * accreditation — and every point awarded afterwards is unearned. So the server
 * refuses unless the request carries an explicit acknowledgement. A warning
 * rendered only in the console would be a warning any other client can skip;
 * this one is a 409 (P9-03).
 *
 * Existing enrolments are unaffected either way: their thresholds were
 * snapshotted at enrolment (P3-01). That is worth saying out loud in the UI,
 * because an admin who lowers a threshold to "help" someone already enrolled
 * will otherwise be surprised.
 *
 * ## Secrets
 *
 * The VNR password arrives here as plaintext, is encrypted before it reaches
 * the repository, and is never returned, logged or echoed in an error. The
 * only readable trace anywhere is `hasVnrPassword: boolean` (CLAUDE.md §4
 * invariant 7).
 */

import {
  missingCertificateFields,
  sniffFontFormat,
  type CertificateField,
  type FontRejection,
} from "@ds/domain";
import { AppError } from "../../shared/problem-details.js";
import type { Db } from "../../db/tenant-db.js";
import type { SecretCipher } from "../../shared/secret-cipher.js";
import {
  LearningRepository,
  type LearningRepositoryPort,
} from "../learning/learning.repository.js";
import { summariseEnrolment } from "../learning/learning.service.js";
import {
  AdminRepository,
  type AdminCourseRow,
  type AdminRepositoryPort,
  type CertificateAssetPatch,
  type CoursePatch,
  type ProjectFontState,
} from "./admin.repository.js";
import type {
  AdminCourseDetail,
  AdminCourseSummary,
  AdminCourseUpdate,
  CertificateAssetUpload,
  EivState,
  FontState,
  FontUpload,
  ParticipantList,
  ParticipantRow,
} from "./admin.dto.js";

/**
 * The accredited minimum for this therapeutic area, from the Bescheid.
 *
 * A constant rather than a column because it is not per-course configuration —
 * it is what the Ärztekammer requires of any course claiming these points. If a
 * future course is accredited at a different minimum, that becomes a column and
 * this becomes its default; inventing the column now would suggest an admin may
 * choose it, which is exactly the wrong affordance.
 */
export const ACCREDITED_MIN_PASS_PERCENT = 70;

/** Who is acting. Taken from the validated token, never from a request body. */
export interface AdminContext {
  readonly customerId: string;
  readonly userId: string;
  /**
   * Which population `userId` names (ADR-0012). Carried so every audit row this
   * service writes says whether a physician or an operator did it.
   */
  readonly identity: "learner" | "staff";
}

export class AdminService {
  constructor(
    private readonly repository: AdminRepositoryPort,
    private readonly learning: LearningRepositoryPort,
    private readonly cipher: SecretCipher,
  ) {}

  static fromDb(db: Db, cipher: SecretCipher): AdminService {
    return new AdminService(new AdminRepository(db), new LearningRepository(db), cipher);
  }

  async listCourses(): Promise<AdminCourseSummary[]> {
    const rows = await this.repository.listCourses();
    const counts = await this.repository.countEnrolments(rows.map((row) => row.id));

    return rows.map((row) => {
      const tally = counts.get(row.id) ?? { total: 0, completed: 0 };
      const missing = this.certificateGaps(row);
      return {
        slug: row.slug,
        title: row.title,
        ...presentationOf(row),
        vnr: row.vnr,
        cmePoints: row.cmePoints,
        cmeCategory: row.cmeCategory,
        requiredWatchPercent: row.requiredWatchPercent,
        passThresholdPercent: row.passThresholdPercent,
        enrolmentCount: tally.total,
        completedCount: tally.completed,
        certificateReady: missing.length === 0,
        missingCertificateFields: missing,
      };
    });
  }

  async getCourse(slug: string): Promise<AdminCourseDetail> {
    const row = await this.requireCourse(slug);
    const counts = await this.repository.countEnrolments([row.id]);
    const tally = counts.get(row.id) ?? { total: 0, completed: 0 };
    const missing = this.certificateGaps(row);

    return {
      slug: row.slug,
      title: row.title,
      ...presentationOf(row),
      vnr: row.vnr,
      cmePoints: row.cmePoints,
      cmeCategory: row.cmeCategory,
      requiredWatchPercent: row.requiredWatchPercent,
      passThresholdPercent: row.passThresholdPercent,
      enrolmentCount: tally.total,
      completedCount: tally.completed,
      certificateReady: missing.length === 0,
      missingCertificateFields: missing,
      organizer: row.organizer,
      eventLocation: row.eventLocation,
      accreditationBody: row.accreditationBody,
      scientificLeadName: row.scientificLeadName,
      scientificLeadTitle: row.scientificLeadTitle,
      certificateIssuePlace: row.certificateIssuePlace,
      hasStampImage: row.hasStampImage,
      hasSignatureImage: row.hasSignatureImage,
      hasVnrPassword: row.hasVnrPassword,
      maxQuizAttempts: row.maxQuizAttempts,
      revealCorrectAnswers: row.revealCorrectAnswers,
    };
  }

  async updateCourse(
    slug: string,
    update: AdminCourseUpdate,
    actor: AdminContext,
  ): Promise<AdminCourseDetail> {
    const row = await this.requireCourse(slug);

    const lowering =
      update.passThresholdPercent !== undefined &&
      update.passThresholdPercent < ACCREDITED_MIN_PASS_PERCENT;

    if (lowering && update.acknowledgeAccreditationRisk !== true) {
      throw new AppError(
        "conflict",
        `refused: pass threshold ${update.passThresholdPercent}% is below the accredited minimum ${ACCREDITED_MIN_PASS_PERCENT}% and the risk was not acknowledged`,
        `Ein Bestehensgrenzwert unter ${ACCREDITED_MIN_PASS_PERCENT} % widerspricht dem Anerkennungsbescheid der Ärztekammer. Punkte, die danach vergeben werden, sind nicht anrechenbar. Bitte bestätigen Sie diese Änderung ausdrücklich.`,
      );
    }

    const patch: CoursePatch = {};

    // Presentation — everything the learner-facing layout draws (P13-01).
    assign(patch, "title", update.title);
    assign(patch, "description", update.description);
    assign(patch, "deliveryType", update.deliveryType);
    assign(patch, "thema", update.thema);
    assign(patch, "altersgruppe", update.altersgruppe);
    assign(patch, "learningObjectives", update.learningObjectives);
    assign(patch, "targetAudience", update.targetAudience);
    assign(patch, "prerequisites", update.prerequisites);
    assign(patch, "heroImageUrl", update.heroImageUrl);
    assign(patch, "cmePoints", update.cmePoints);
    assign(patch, "cmeCategory", update.cmeCategory);
    assign(patch, "fortbildungsnummer", update.fortbildungsnummer);

    // Dates arrive as ISO strings and are stored as `timestamptz`. Parsed here
    // rather than in the repository, which has no business knowing the wire
    // format, and `null` is passed through as "clear it" rather than becoming
    // an Invalid Date.
    if (update.validFrom !== undefined) {
      patch.validFrom = update.validFrom === null ? null : new Date(update.validFrom);
    }
    if (update.validTo !== undefined) {
      patch.validTo = update.validTo === null ? null : new Date(update.validTo);
    }

    // Accreditation and gating.
    assign(patch, "requiredWatchPercent", update.requiredWatchPercent);
    assign(patch, "passThresholdPercent", update.passThresholdPercent);
    assign(patch, "organizer", update.organizer);
    assign(patch, "eventLocation", update.eventLocation);
    assign(patch, "accreditationBody", update.accreditationBody);
    assign(patch, "scientificLeadName", update.scientificLeadName);
    assign(patch, "scientificLeadTitle", update.scientificLeadTitle);
    assign(patch, "certificateIssuePlace", update.certificateIssuePlace);
    // An empty string is a cleared form field, not a VNR. Storing `''` would
    // pass the `vnr === null` check in `queueSubmission` and then be sent to
    // the EIV as the number to credit against.
    assign(patch, "vnr", update.vnr === "" ? null : update.vnr);

    if (update.vnrPassword !== undefined) {
      // Encrypted before it crosses into the repository — no layer below this
      // one ever sees the plaintext.
      patch.vnrPasswordEnc = this.cipher.encrypt(update.vnrPassword);
    }

    await this.repository.updateCourse(row.id, patch);

    await this.repository.audit({
      customerId: actor.customerId,
      actorId: actor.userId,
      actorIdentity: actor.identity,
      action: "admin.course.update",
      subject: row.id,
      detail: {
        // Field names, never values: one of them is a credential.
        fields: Object.keys(patch),
        ...(lowering
          ? {
              accreditationRiskAcknowledged: true,
              newPassThreshold: update.passThresholdPercent,
            }
          : {}),
      },
    });

    return this.getCourse(slug);
  }

  /**
   * Store the stamp and signature of the Wissenschaftliche Leitung.
   *
   * The bytes are validated against their declared type by sniffing the magic
   * bytes, not by trusting the `mime` field. A client claiming `image/png` for
   * something else would otherwise reach `pdf-lib` at certificate-render time,
   * which is a worse place to discover it — and the whole point of restricting
   * to PNG and JPEG is that neither is executable.
   */
  async setCertificateAssets(
    slug: string,
    upload: CertificateAssetUpload,
    actor: AdminContext,
  ): Promise<AdminCourseDetail> {
    const row = await this.requireCourse(slug);
    const patch: CertificateAssetPatch = {};

    if (upload.stampImageBase64 !== undefined) {
      const bytes = decodeImage(
        upload.stampImageBase64,
        upload.stampImageMime,
        "Stempel",
      );
      patch.stampImage = bytes.buffer;
      patch.stampImageMime = bytes.mime;
    }
    if (upload.signatureImageBase64 !== undefined) {
      const bytes = decodeImage(
        upload.signatureImageBase64,
        upload.signatureImageMime,
        "Unterschrift",
      );
      patch.signatureImage = bytes.buffer;
      patch.signatureImageMime = bytes.mime;
    }

    if (Object.keys(patch).length === 0) {
      throw new AppError(
        "validation",
        "certificate asset upload contained neither image",
        "Bitte laden Sie mindestens ein Bild hoch.",
      );
    }

    await this.repository.setCertificateAssets(row.id, patch);

    await this.repository.audit({
      customerId: actor.customerId,
      actorId: actor.userId,
      actorIdentity: actor.identity,
      action: "admin.course.certificate_assets",
      subject: row.id,
      detail: {
        // Sizes, not bytes — an audit row is not a place to store an image.
        stampBytes: patch.stampImage?.byteLength ?? null,
        signatureBytes: patch.signatureImage?.byteLength ?? null,
      },
    });

    return this.getCourse(slug);
  }

  /** What the console shows on the branding screen. Never the bytes. */
  async getFont(projectSlug: string): Promise<FontState> {
    const row = await this.repository.findProjectFont(projectSlug);
    if (row === undefined) {
      throw AppError.notFound(`project slug=${projectSlug} not visible in this tenant`);
    }
    return fontState(row);
  }

  /**
   * Store the customer's own webfont (P10-08).
   *
   * Three things make this safe to expose to a customer admin, and all three
   * are here rather than in the controller because they are rules, not
   * plumbing:
   *
   * 1. **The bytes decide the type, not the uploader.** `sniffFontFormat` reads
   *    the container signature and checks the file is exactly as long as its
   *    own header claims. The declared `fontMime` is only ever cross-checked
   *    against that result — it can narrow nothing and permit nothing.
   * 2. **SVG cannot be reached.** The sniffer has no branch that returns it.
   *    That matters because this file is served from our own origin to a page
   *    holding a bearer token; an SVG font is markup with a `<script>` in it.
   * 3. **The family name is a CSS token.** It is emitted inside an
   *    `@font-face` block, so it is constrained by `@ds/domain`'s grammar, by
   *    the zod schema, and by a CHECK constraint. Three places for one value
   *    that reaches a stylesheet is not redundancy worth removing.
   */
  async setFont(
    projectSlug: string,
    upload: FontUpload,
    actor: AdminContext,
  ): Promise<FontState> {
    const bytes = Buffer.from(upload.fontBase64, "base64");

    if (bytes.byteLength > MAX_FONT_BYTES) {
      throw new AppError(
        "validation",
        `font upload is ${bytes.byteLength} bytes, over the ${MAX_FONT_BYTES} limit`,
        "Die Schriftdatei ist zu groß (maximal 2 MB).",
      );
    }

    const sniffed = sniffFontFormat(bytes);
    if (!sniffed.ok) {
      throw new AppError("validation", fontLogMessage(sniffed.reason), FONT_HINT_DE);
    }
    if (upload.fontMime !== undefined && upload.fontMime !== sniffed.mime) {
      throw new AppError(
        "validation",
        `font upload declared ${upload.fontMime} but is ${sniffed.mime}`,
        "Der Dateityp der Schriftdatei stimmt nicht mit dem Inhalt überein.",
      );
    }

    const now = new Date();
    const row = await this.repository.setProjectFont(projectSlug, {
      fontFile: bytes,
      fontMime: sniffed.mime,
      fontFamilyName: upload.fontFamilyName,
      // Doubles as the cache-busting version: the widget appends it to the
      // font URL, so replacing a font invalidates a year-long cache without a
      // purge (see branding.controller.ts).
      fontUpdatedAt: now,
    });

    if (row === undefined) {
      throw AppError.notFound(`project slug=${projectSlug} not visible in this tenant`);
    }

    await this.repository.audit({
      customerId: actor.customerId,
      actorId: actor.userId,
      actorIdentity: actor.identity,
      action: "admin.project.font.set",
      subject: projectSlug,
      // Size and format, never the file. An audit row is not a blob store.
      detail: { bytes: bytes.byteLength, mime: sniffed.mime },
    });

    return fontState(row);
  }

  /** Remove it. Learners fall back to the configured stack, which is always valid. */
  async clearFont(projectSlug: string, actor: AdminContext): Promise<FontState> {
    const row = await this.repository.setProjectFont(projectSlug, {
      fontFile: null,
      fontMime: null,
      fontFamilyName: null,
      fontUpdatedAt: null,
    });

    if (row === undefined) {
      throw AppError.notFound(`project slug=${projectSlug} not visible in this tenant`);
    }

    await this.repository.audit({
      customerId: actor.customerId,
      actorId: actor.userId,
      actorIdentity: actor.identity,
      action: "admin.project.font.clear",
      subject: projectSlug,
      detail: {},
    });

    return fontState(row);
  }

  /**
   * The participant list (P9-06).
   *
   * Every figure comes from `summariseEnrolment` — the same function the
   * learner's own screen renders from, over the same course tree and the same
   * progress rows. That is CLAUDE.md §4 invariant 6, and it is not a style
   * preference: a list that told MEDICE a physician reached 96 % while the
   * physician's own screen said 100 % would be two different answers to
   * "did this person earn a CME point", one of which has already gone to the
   * Ärztekammer.
   */
  async listParticipants(slug: string, now: Date): Promise<ParticipantList> {
    const course = await this.requireCourse(slug);

    const [tree, enrolments] = await Promise.all([
      this.learning.findCourseTree(course.id),
      this.repository.listEnrolments(course.id),
    ]);

    const enrolmentIds = enrolments.map((row) => row.enrolmentId);
    const userIds = enrolments.map((row) => row.userId);

    const [progress, evaluated, efns, submissions, certificates] = await Promise.all([
      this.repository.findProgressByEnrolment(enrolmentIds),
      this.repository.findEvaluationSubmitted(enrolmentIds),
      this.repository.findEfnPresent(userIds),
      this.repository.findSubmissions(enrolmentIds),
      this.repository.findCertificates(enrolmentIds),
    ]);

    const rows: ParticipantRow[] = enrolments.map((enrolment) => {
      const efnPresent = efns.has(enrolment.userId);
      const evaluationSubmitted = evaluated.has(enrolment.enrolmentId);

      const figures = summariseEnrolment({
        tree,
        stored: progress.get(enrolment.enrolmentId) ?? [],
        requiredWatchPercent: enrolment.requiredWatchPercent,
        passThresholdPercent: enrolment.passThresholdPercent,
        efnPresent,
        evaluationSubmitted,
        cmePoints: enrolment.cmePoints,
      });

      const submission = submissions.get(enrolment.enrolmentId);
      const certificate = certificates.get(enrolment.enrolmentId);

      return {
        enrolmentId: enrolment.enrolmentId,
        participantName: participantName(enrolment),
        email: enrolment.email,
        efnPresent,
        watchedPercent: figures.achievedWatchPercent,
        quizPassed: figures.quizPassed,
        evaluationSubmitted,
        progressPercent: figures.progress.percent,
        complete: figures.complete,
        completedAt: enrolment.completedAt?.toISOString() ?? null,
        eivState: eivState(submission, now),
        eivAttempts: submission?.attemptCount ?? 0,
        eivReportDueAt: submission?.reportDueAt.toISOString() ?? null,
        certificateState: certificate?.status ?? "none",
      };
    });

    return { courseSlug: slug, rows };
  }

  /**
   * Record that a participant list left the system as a file (P9-07).
   *
   * Row count only. Writing the names into the audit row would put the same
   * personal data in a second place, which is the opposite of what auditing an
   * export is for.
   */
  async auditExport(slug: string, rowCount: number, actor: AdminContext): Promise<void> {
    const course = await this.requireCourse(slug);
    await this.repository.audit({
      customerId: actor.customerId,
      actorId: actor.userId,
      actorIdentity: actor.identity,
      action: "admin.participants.export",
      subject: course.id,
      detail: { format: "csv", rowCount },
    });
  }

  private async requireCourse(slug: string): Promise<AdminCourseRow> {
    const row = await this.repository.findCourse(slug);
    if (row === undefined) {
      // Not visible in this tenant is indistinguishable from not existing.
      throw AppError.notFound(`course slug=${slug} not visible in this tenant`);
    }
    return row;
  }

  /**
   * Which mandatory certificate fields this course is still missing.
   *
   * Runs the course's own values through the same `missingCertificateFields`
   * the certificate endpoint enforces, so the console cannot report "ready" for
   * a course that would refuse to issue. Participant-specific fields are filled
   * with placeholders — the question here is whether the *course* is
   * configured, not whether one learner has a name.
   */
  private certificateGaps(row: AdminCourseRow): string[] {
    const missing: CertificateField[] = missingCertificateFields({
      vnr: row.vnr ?? "",
      courseTitle: row.title,
      completedAt: new Date(0),
      eventLocation: row.eventLocation ?? "",
      organizer: row.organizer ?? "",
      cmePoints: row.cmePoints ?? 0,
      cmeCategory: row.cmeCategory ?? "",
      accreditationBody: row.accreditationBody ?? "",
      participantName: "—",
      scientificLeadName: row.scientificLeadName ?? "",
    }).filter((field) => field !== "participantName" && field !== "completedAt");

    // The images are bytes, so the pure function cannot see them.
    const gaps: string[] = [...missing];
    if (!row.hasStampImage) gaps.push("stampImage");
    if (!row.hasSignatureImage) gaps.push("signatureImage");
    return gaps;
  }
}

/**
 * Map the submission's stored status onto what an admin needs to act on.
 *
 * `needs_attention` is the point of this function. P7-06 retries three times at
 * ten-minute intervals; a submission still unresolved after that will not fix
 * itself, and the paper fallback in the Bescheid (an Original-Anwesenheitsliste
 * within 8 days) is only open while the deadline has not passed. Folding that
 * into a generic "failed" count is how a statutory deadline gets missed
 * quietly.
 */
function eivState(
  submission: { status: string; attemptCount: number; reportDueAt: Date } | undefined,
  now: Date,
): EivState {
  if (submission === undefined) return "none";

  switch (submission.status) {
    case "submitted":
      return "submitted";
    case "failed_permanent":
    case "window_closed":
      return "abandoned";
    case "failed_retryable":
    case "held":
      return "needs_attention";
    case "queued":
      // Queued is healthy — unless it has been queued past its deadline, or has
      // burned through the fast retries without landing.
      if (submission.reportDueAt.getTime() <= now.getTime()) return "needs_attention";
      if (submission.attemptCount >= 3) return "needs_attention";
      return "queued";
    default:
      return "failed";
  }
}

function participantName(row: {
  attestedName: string | null;
  firstName: string | null;
  lastName: string | null;
}): string {
  const attested = row.attestedName?.trim() ?? "";
  if (attested !== "") return attested;
  const full = [row.firstName, row.lastName].filter(Boolean).join(" ").trim();
  return full === "" ? "—" : full;
}

/**
 * Assign only when the caller actually sent the key.
 *
 * `exactOptionalPropertyTypes` makes `patch.x = undefined` a type error, and
 * semantically it would be wrong anyway: this is a PATCH, and an absent field
 * means "leave it alone", not "set it to null".
 */
function assign<K extends keyof CoursePatch>(
  patch: CoursePatch,
  key: K,
  value: CoursePatch[K] | undefined,
): void {
  if (value !== undefined) patch[key] = value;
}

/** The column's own bound (migration 0008). Enforced here for a clear error. */
const MAX_FONT_BYTES = 2 * 1024 * 1024;

/**
 * One German message for every rejection.
 *
 * The reasons differ usefully in the log — "this is not a font" and "this font
 * has something appended to it" are different incidents — but they are the same
 * instruction to the admin, and a message that distinguished them would tell an
 * uploader exactly which check they had tripped.
 */
const FONT_HINT_DE =
  "Die Datei ist keine gültige WOFF- oder WOFF2-Schriftdatei. " +
  "Bitte laden Sie eine .woff2- oder .woff-Datei hoch.";

function fontLogMessage(reason: FontRejection): string {
  switch (reason) {
    case "empty":
      return "font upload is too short to contain a font header";
    case "unknown_signature":
      return "font upload is neither wOFF nor wOF2 by its signature";
    case "length_mismatch":
      // Worth its own line: this is a font with data appended to it, which is
      // an attempt, not a mistake.
      return "font upload length disagrees with its own header — appended data";
  }
}

function fontState(row: ProjectFontState): FontState {
  return {
    fontFamilyName: row.fontFamilyName,
    fontVersion: row.fontUpdatedAt?.toISOString() ?? null,
    fontBytes: row.fontBytes,
  };
}

const MAGIC = {
  png: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  jpeg: Buffer.from([0xff, 0xd8, 0xff]),
};

/** The column's own bound (migration 0006). Enforced here for a clear error. */
const MAX_IMAGE_BYTES = 512 * 1024;

function decodeImage(
  base64: string,
  declaredMime: string | undefined,
  label: string,
): { buffer: Buffer; mime: string } {
  const buffer = Buffer.from(base64, "base64");

  if (buffer.byteLength === 0) {
    throw new AppError(
      "validation",
      `${label} upload decoded to zero bytes`,
      `Die Datei für ${label} konnte nicht gelesen werden.`,
    );
  }
  if (buffer.byteLength > MAX_IMAGE_BYTES) {
    throw new AppError(
      "validation",
      `${label} upload is ${buffer.byteLength} bytes, over the ${MAX_IMAGE_BYTES} limit`,
      `Die Datei für ${label} ist zu groß (maximal 512 KB).`,
    );
  }

  // Sniffed, not trusted. The declared mime is a claim by the uploader.
  const sniffed = buffer.subarray(0, 4).equals(MAGIC.png)
    ? "image/png"
    : buffer.subarray(0, 3).equals(MAGIC.jpeg)
      ? "image/jpeg"
      : undefined;

  if (sniffed === undefined) {
    throw new AppError(
      "validation",
      `${label} upload is neither PNG nor JPEG by its magic bytes`,
      `Für ${label} sind nur PNG- und JPEG-Dateien zulässig.`,
    );
  }
  if (declaredMime !== undefined && declaredMime !== sniffed) {
    throw new AppError(
      "validation",
      `${label} upload declared ${declaredMime} but is ${sniffed}`,
      `Der Dateityp für ${label} stimmt nicht mit dem Inhalt überein.`,
    );
  }

  return { buffer, mime: sniffed };
}

/**
 * The presentation half of a course row, shared by the list and the detail
 * projections (P13-01).
 *
 * One function rather than two copies: the list and the detail differ only in
 * the accreditation fields, and a field added to one and forgotten in the other
 * shows up as a form input that silently resets on save.
 */
function presentationOf(row: {
  description: string | null;
  deliveryType: "on_demand" | "live" | "praesenz";
  thema: string[];
  altersgruppe: string[];
  learningObjectives: string[];
  targetAudience: string | null;
  prerequisites: string | null;
  heroImageUrl: string | null;
  fortbildungsnummer: string | null;
  validFrom: Date | null;
  validTo: Date | null;
}) {
  return {
    description: row.description,
    deliveryType: row.deliveryType,
    thema: row.thema,
    altersgruppe: row.altersgruppe,
    learningObjectives: row.learningObjectives,
    targetAudience: row.targetAudience,
    prerequisites: row.prerequisites,
    heroImageUrl: row.heroImageUrl,
    fortbildungsnummer: row.fortbildungsnummer,
    // ISO 8601 on the wire; `timestamptz` in the column. The console renders a
    // date input from it, which needs a string it can slice.
    validFrom: row.validFrom?.toISOString() ?? null,
    validTo: row.validTo?.toISOString() ?? null,
  };
}
