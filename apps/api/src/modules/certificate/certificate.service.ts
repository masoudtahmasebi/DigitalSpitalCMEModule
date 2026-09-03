/**
 * Certificate issue and download (P8). Application layer — ADR-0006.
 *
 * ## The participation date, for an on-demand course
 *
 * The Bescheid requires the certificate to carry the Veranstaltungs-datum and
 * -uhrzeit, and the Muster reads "am ________ als on-demand-Webinar
 * teilgenommen hat". For a course a physician takes at a time of their own
 * choosing, the only date that sentence can mean is **the moment they
 * completed it** — there is no scheduled sitting to name, and every
 * participant's is different.
 *
 * The same instant is what starts the EIV's 8-day reporting clock
 * (`completion.service.ts`), so the two agree by construction: the date on the
 * physician's certificate is the date the Ärztekammer is told about.
 *
 * ## What is snapshotted and what is live
 *
 * The participation data — VNR, points, category — comes from the enrolment,
 * where it was snapshotted at enrolment time, so a later edit to the course
 * cannot alter a certificate already earned. The signing assets come from the
 * course, live, so replacing an expired stamp fixes every future download.
 * That split is deliberate and is the reason the repository reads them
 * separately.
 */

import { randomBytes } from "node:crypto";
import type { TenantRunner } from "../../db/tenant-runner.js";
import {
  buildCertificateData,
  missingCertificateFields,
  type CertificateData,
} from "@ds/domain";
import { AppError } from "../../shared/problem-details.js";
import type { Db } from "../../db/tenant-db.js";
import type { LearnerContext } from "../learning/learning.service.js";
import {
  CertificateRepository,
  RunnerCertificateRepository,
  type CertificateRepositoryPort,
  type CertificateSourceRow,
} from "./certificate.repository.js";
import {
  CertificateAssetsMissingError,
  renderCertificatePdf,
  type CertificateAssets,
} from "./certificate.renderer.js";
import type { CertificateArchivePort } from "./certificate.archive.js";

export interface RenderedCertificate {
  readonly filename: string;
  readonly bytes: Uint8Array;
}

export class CertificateService {
  constructor(
    private readonly repository: CertificateRepositoryPort,
    private readonly render = renderCertificatePdf,
    /**
     * Where the issued bytes are kept (P60-01). Optional because object storage
     * is optional: a deployment without it still issues, downloads and e-mails
     * certificates, and simply has no archive to verify against later.
     */
    private readonly archive?: CertificateArchivePort,
  ) {}

  static fromDb(db: Db, archive?: CertificateArchivePort): CertificateService {
    return new CertificateService(
      new CertificateRepository(db),
      renderCertificatePdf,
      archive,
    );
  }

  /**
   * The same service on a route that holds no ambient transaction (P146-02).
   *
   * For `download`, whose archive step PUTs the PDF to the object store. See
   * `RunnerCertificateRepository` for why splitting is safe on that path and
   * deliberately not applied to completion.
   */
  static fromRunner(
    run: TenantRunner,
    archive?: CertificateArchivePort,
  ): CertificateService {
    return new CertificateService(
      new RunnerCertificateRepository(run),
      renderCertificatePdf,
      archive,
    );
  }

  /**
   * Which enrolment a certificate row belongs to (P59-02).
   *
   * The delivery sweep claims a certificate id; everything that renders one is
   * keyed on the enrolment. Resolved inside the tenant scope, so a claim that
   * named another customer's row finds nothing.
   */
  async enrolmentIdFor(certificateId: string): Promise<string | undefined> {
    return this.repository.findEnrolmentIdByCertificate(certificateId);
  }

  /**
   * Issue and render for an enrolment, without a signed-in learner (P59-01).
   *
   * Used by two callers that know an enrolment and nothing else: the
   * completion, which issues the certificate the moment it is earned, and the
   * delivery sweep, which needs the bytes to attach to the e-mail.
   *
   * **Returns `undefined` instead of throwing.** Every refusal `download`
   * raises is a message for a person looking at a screen — a missing name they
   * can fix, an authoring gap they should report. Neither caller here has a
   * screen: the completion must stand whether or not a PDF can be produced
   * (the physician earned the point either way), and the delivery sweep must
   * be able to send the covering e-mail rather than crash the batch. Both log
   * what happened; nothing about the learner's entitlement changes.
   */
  async issueForEnrolment(
    enrolmentId: string,
    customerId: string,
    now: Date,
  ): Promise<RenderedCertificate | undefined> {
    const source = await this.repository.findSourceByEnrolment(enrolmentId);
    if (source === undefined || source.completedAt === null) return undefined;

    const data = this.assemble(source, source.completedAt);
    if (missingCertificateFields(data).length > 0) return undefined;

    const assets: CertificateAssets = {
      stampImage: source.stampImage,
      stampImageMime: source.stampImageMime,
      signatureImage: source.signatureImage,
      signatureImageMime: source.signatureImageMime,
      issuePlace: source.certificateIssuePlace,
    };

    let bytes: Uint8Array;
    try {
      bytes = await this.render(data, assets);
    } catch (error) {
      if (error instanceof CertificateAssetsMissingError) return undefined;
      throw error;
    }

    // Same write as `download`, and idempotent for the same reason: whichever
    // of the two happens first mints the token, and the other finds it.
    const row = await this.repository.issue({
      customerId,
      enrolmentId,
      participantName: data.participantName,
      downloadToken: randomBytes(32).toString("hex"),
      issuedAt: now,
    });

    await this.archiveOnce(row, source.courseId, customerId, bytes, now);

    return { filename: filenameFor(data), bytes };
  }

  /**
   * Issue (idempotently) and render the certificate.
   *
   * Refuses unless the course is genuinely complete: the certificate is the
   * artefact that says a physician earned points, so it must not exist before
   * they have.
   */
  async download(
    slug: string,
    learner: LearnerContext,
    now: Date,
  ): Promise<RenderedCertificate> {
    const source = await this.repository.findSource(slug, learner.userId);
    if (source === undefined) {
      throw AppError.notFound(`no enrolment on course=${slug} for this learner`);
    }
    if (source.completedAt === null) {
      throw new AppError(
        "conflict",
        `enrolment=${source.enrolmentId} is not complete`,
        "Die Teilnahmebescheinigung steht erst nach Abschluss der Fortbildung zur Verfügung.",
      );
    }

    const data = this.assemble(source, source.completedAt);

    const missing = missingCertificateFields(data);
    if (missing.length > 0) {
      // Two different problems wear the same 409, so they get different
      // messages: a missing participant name is something the learner can fix
      // themselves, everything else is an authoring gap on the course and
      // telling them to try harder would be useless.
      const onlyName = missing.length === 1 && missing[0] === "participantName";
      throw new AppError(
        "conflict",
        `certificate data incomplete for course=${slug}: ${missing.join(", ")}`,
        onlyName
          ? "Für die Teilnahmebescheinigung fehlt Ihr Name. Bitte hinterlegen Sie ihn und schließen Sie die Fortbildung erneut ab."
          : "Diese Fortbildung ist noch nicht vollständig für die Zertifikatsausstellung konfiguriert. Bitte wenden Sie sich an den Veranstalter.",
      );
    }

    const assets: CertificateAssets = {
      stampImage: source.stampImage,
      stampImageMime: source.stampImageMime,
      signatureImage: source.signatureImage,
      signatureImageMime: source.signatureImageMime,
      issuePlace: source.certificateIssuePlace,
    };

    let bytes: Uint8Array;
    try {
      bytes = await this.render(data, assets);
    } catch (error) {
      if (error instanceof CertificateAssetsMissingError) {
        throw new AppError(
          "conflict",
          `certificate assets missing for course=${slug}: ${error.missing.join(", ")}`,
          "Für diese Fortbildung fehlen Stempel oder Unterschrift der wissenschaftlichen Leitung.",
        );
      }
      throw error;
    }

    // Recorded after a successful render, so a failed render never leaves a
    // certificate marked issued that nobody can download.
    const row = await this.repository.issue({
      customerId: learner.customerId,
      enrolmentId: source.enrolmentId,
      participantName: data.participantName,
      // 32 bytes of CSPRNG: this token is the capability to fetch a named
      // physician's participation record, so it must not be guessable.
      downloadToken: randomBytes(32).toString("hex"),
      issuedAt: now,
    });

    await this.archiveOnce(row, source.courseId, learner.customerId, bytes, now);

    return { filename: filenameFor(data), bytes };
  }

  /**
   * Put the issued bytes in object storage, at most once (P60-01).
   *
   * ## Why "once", and why it is the *first* render that is kept
   *
   * The archive answers "what did we issue", and there is one answer. A second
   * render — a retry of the delivery, a physician re-downloading next year —
   * may legitimately differ: a stamp has been replaced, the layout has moved
   * on. Overwriting would quietly replace the evidence with a reconstruction,
   * so the row's `pdf_object_key` is the guard here and `WHERE … IS NULL` is
   * the guard in SQL.
   *
   * ## Why a failure is silent to the caller
   *
   * Both callers are compliance paths that must not fail on an infrastructure
   * problem: a completion the physician has earned, and a delivery sweep that
   * must not drop a batch. `CertificateArchive` answers `undefined` and logs;
   * the row simply stays unarchived, which is a state the schema can express
   * and an operator can query for. Pretending otherwise — writing the key
   * before the bucket confirmed — is the one thing that would make the archive
   * worthless.
   */
  private async archiveOnce(
    row: { id: string; pdfObjectKey: string | null },
    courseId: string,
    customerId: string,
    bytes: Uint8Array,
    now: Date,
  ): Promise<void> {
    if (this.archive === undefined) return;
    if (row.pdfObjectKey !== null) return;

    const stored = await this.archive.store({
      customerId,
      courseId,
      certificateId: row.id,
      bytes,
    });
    if (stored === undefined) return;

    await this.repository.recordArchive({
      certificateId: row.id,
      objectKey: stored.objectKey,
      sha256: stored.sha256,
      at: now,
    });
  }

  /** The certificate's data without rendering it — for the admin console (P9). */
  async preview(slug: string, learner: LearnerContext): Promise<CertificateData> {
    const source = await this.repository.findSource(slug, learner.userId);
    if (source === undefined || source.completedAt === null) {
      throw AppError.notFound(`no completed enrolment on course=${slug}`);
    }
    return this.assemble(source, source.completedAt);
  }

  /**
   * A sample Teilnahmebescheinigung for the course, with nobody's data on it
   * (P180-02).
   *
   * ## What this is for
   *
   *   > also with sample certificate generation, if we use test server, i
   *   > should easily test this
   *
   * Configuring a certificate means uploading a stamp and a signature, typing a
   * VNR, a Veranstalter and a wissenschaftliche Leitung, and then having no way
   * to see the result until a physician finishes the course. The first person
   * to see whether the stamp is the right way up was a doctor holding their own
   * CME record.
   *
   * ## Why it cannot be mistaken for a real one
   *
   * Everything about the **event** is real — that is the whole point, since the
   * question is whether *this course's* document comes out right. Everything
   * about the **person** is synthetic and says so on the page: the name is the
   * words "MUSTER — keine gültige Bescheinigung", and the address line repeats
   * it. There is no join in `findCourseForSample` through which a real
   * participant's name, address or EFN could reach this document.
   *
   * No EFN is printed at all. A plausible-looking one would be the single field
   * most likely to make a sample pass for real, and there is no participant to
   * have one.
   *
   * ## Why it issues nothing
   *
   * It writes no `certificates` row, mints no download token and archives
   * nothing. A sample is a rendering, not a document the platform stands
   * behind, and an archived sample would sit in the evidence store beside real
   * certificates.
   */
  async renderSample(courseSlug: string, now: Date): Promise<RenderedCertificate> {
    const source = await this.repository.findCourseForSample(courseSlug);
    if (source === undefined) {
      throw AppError.notFound(`course=${courseSlug} not visible in this tenant`);
    }

    const data = buildCertificateData({
      vnr: source.vnr ?? "",
      courseTitle: source.courseTitle,
      completedAt: now,
      eventLocation: source.eventLocation ?? "",
      organizer: source.organizer ?? "",
      cmePoints: source.cmePoints ?? 0,
      cmeCategory: source.cmeCategory ?? "",
      accreditationBody: source.accreditationBody ?? "",
      participantName: SAMPLE_PARTICIPANT_NAME,
      participantAddress: SAMPLE_PARTICIPANT_ADDRESS,
      scientificLeadName: leadWithTitle(source),
    });

    /*
     * The same completeness check the real document gets, and the same
     * message.
     *
     * A sample that rendered happily over a missing VNR would answer the wrong
     * question: an operator is here precisely to find out whether the course is
     * ready to issue. Refusing with the list of what is missing is the answer
     * they came for.
     */
    const missing = missingCertificateFields(data);
    if (missing.length > 0) {
      throw new AppError(
        "conflict",
        `sample refused for course=${courseSlug}: ${missing.join(", ")}`,
        "Für diese Fortbildung fehlen noch Angaben, ohne die keine Teilnahmebescheinigung erzeugt werden kann. Auf diesem Reiter steht, welche.",
      );
    }

    const assets: CertificateAssets = {
      stampImage: source.stampImage,
      stampImageMime: source.stampImageMime,
      signatureImage: source.signatureImage,
      signatureImageMime: source.signatureImageMime,
      issuePlace: source.certificateIssuePlace,
    };

    let bytes: Uint8Array;
    try {
      bytes = await this.render(data, assets);
    } catch (error) {
      if (error instanceof CertificateAssetsMissingError) {
        throw new AppError(
          "conflict",
          `sample refused for course=${courseSlug}: ${error.missing.join(", ")}`,
          "Für diese Fortbildung fehlen Stempel oder Unterschrift der wissenschaftlichen Leitung.",
        );
      }
      throw error;
    }

    return { filename: `Muster_Teilnahmebescheinigung_${courseSlug}.pdf`, bytes };
  }

  private assemble(source: CertificateSourceRow, completedAt: Date): CertificateData {
    return buildCertificateData({
      vnr: source.vnr ?? "",
      courseTitle: source.courseTitle,
      // For an on-demand course this is the Veranstaltungsdatum — see the
      // module header.
      completedAt,
      eventLocation: source.eventLocation ?? "",
      organizer: source.organizer ?? "",
      cmePoints: source.cmePoints ?? 0,
      cmeCategory: source.cmeCategory ?? "",
      accreditationBody: source.accreditationBody ?? "",
      // The name the learner attested to at completion, if they gave one — it
      // may legitimately differ from the Keycloak profile
      // (docs/requirements/medice-adhs.md §6.5). Blank counts as absent: a
      // whitespace-only attestation must not blank out a name we do have.
      participantName: blankToUndefined(source.attestedName) ?? fullName(source),
      // Both optional, both drawn only when there is something to draw
      // (P60-02, P60-03). `blankToUndefined` rather than `?? undefined`: a
      // whitespace-only address would print an "Anschrift:" line that looks
      // filled in and is not.
      ...maybe("participantAddress", blankToUndefined(source.attestedAddress)),
      ...maybe("efn", blankToUndefined(source.efn)),
      scientificLeadName: leadWithTitle(source),
    });
  }
}

/**
 * The name on a sample, which is a sentence rather than a name (P180-02).
 *
 * On the document itself, not only in the filename: a PDF gets renamed,
 * forwarded and printed, and the page has to carry its own warning by the time
 * somebody is holding it.
 */
const SAMPLE_PARTICIPANT_NAME = "MUSTER — keine gültige Bescheinigung";
const SAMPLE_PARTICIPANT_ADDRESS = "Beispieladresse — Musterdokument zur Ansicht";

function fullName(source: CertificateSourceRow): string {
  return [source.firstName, source.lastName].filter(Boolean).join(" ").trim();
}

function blankToUndefined(value: string | null): string | undefined {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? undefined : trimmed;
}

/**
 * `{ key: value }` when there is a value, `{}` when there is not.
 *
 * `exactOptionalPropertyTypes` is on, so `{ efn: undefined }` is not the same
 * as an absent `efn` and the compiler is right to say so — an optional field
 * present-but-undefined is a field somebody set to nothing on purpose.
 */
function maybe<K extends string>(
  key: K,
  value: string | undefined,
): Record<K, string> | Record<string, never> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, string>);
}

function leadWithTitle(source: CertificateSourceRow): string {
  const name = source.scientificLeadName?.trim() ?? "";
  const title = source.scientificLeadTitle?.trim() ?? "";
  if (name === "") return "";
  return title === "" ? name : `${title} ${name}`;
}

/**
 * A filename a physician can file without renaming: the course and the date,
 * with anything a filesystem dislikes removed.
 */
function filenameFor(data: CertificateData): string {
  const slugish = data.courseTitle
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);

  const date = data.completedAt.toISOString().slice(0, 10);
  return `Teilnahmebescheinigung-${slugish}-${date}.pdf`;
}
