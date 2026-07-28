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
  type CertificateRepositoryPort,
  type CertificateSourceRow,
} from "./certificate.repository.js";
import {
  CertificateAssetsMissingError,
  renderCertificatePdf,
  type CertificateAssets,
} from "./certificate.renderer.js";

export interface RenderedCertificate {
  readonly filename: string;
  readonly bytes: Uint8Array;
}

export class CertificateService {
  constructor(
    private readonly repository: CertificateRepositoryPort,
    private readonly render = renderCertificatePdf,
  ) {}

  static fromDb(db: Db): CertificateService {
    return new CertificateService(new CertificateRepository(db));
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
    await this.repository.issue({
      customerId: learner.customerId,
      enrolmentId: source.enrolmentId,
      participantName: data.participantName,
      // 32 bytes of CSPRNG: this token is the capability to fetch a named
      // physician's participation record, so it must not be guessable.
      downloadToken: randomBytes(32).toString("hex"),
      issuedAt: now,
    });

    return { filename: filenameFor(data), bytes };
  }

  /** The certificate's data without rendering it — for the admin console (P9). */
  async preview(slug: string, learner: LearnerContext): Promise<CertificateData> {
    const source = await this.repository.findSource(slug, learner.userId);
    if (source === undefined || source.completedAt === null) {
      throw AppError.notFound(`no completed enrolment on course=${slug}`);
    }
    return this.assemble(source, source.completedAt);
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
      scientificLeadName: leadWithTitle(source),
    });
  }
}

function fullName(source: CertificateSourceRow): string {
  return [source.firstName, source.lastName].filter(Boolean).join(" ").trim();
}

function blankToUndefined(value: string | null): string | undefined {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? undefined : trimmed;
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
