/**
 * Certificate data access (P8). Infrastructure layer — ADR-0006.
 *
 * The certificate row is the immutable record of what was issued; the course
 * row supplies the signing assets at render time. Those are read separately on
 * purpose: replacing an expired stamp must fix every future download without
 * rewriting certificates already issued, and re-issuing must not silently
 * change the participation data a physician has already filed.
 */

import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "../../db/tenant-db.js";
import {
  certificates,
  courses,
  efnProfiles,
  enrolments,
  users,
} from "../../db/schema.js";

export interface CertificateSourceRow {
  enrolmentId: string;
  completedAt: Date | null;
  vnr: string | null;
  courseTitle: string;
  eventLocation: string | null;
  organizer: string | null;
  cmePoints: number | null;
  cmeCategory: string | null;
  accreditationBody: string | null;
  scientificLeadName: string | null;
  scientificLeadTitle: string | null;
  certificateIssuePlace: string | null;
  stampImage: Buffer | null;
  stampImageMime: string | null;
  signatureImage: Buffer | null;
  signatureImageMime: string | null;
  attestedName: string | null;
  /** The Muster's "Anschrift:" line, when the learner gave one (P60-03). */
  attestedAddress: string | null;
  firstName: string | null;
  lastName: string | null;
  /** Printed on the document (P60-02). Null for a point-free course. */
  efn: string | null;
  /** The course the certificate belongs to — for the archive key (P60-01). */
  courseId: string;
}

export interface CertificateRow {
  id: string;
  downloadToken: string;
  participantName: string;
  status: "pending" | "issued" | "delivered" | "bounced";
  issuedAt: Date | null;
  /** Null until the bytes are in object storage (P60-01), and after erasure. */
  pdfObjectKey: string | null;
}

export interface CertificateRepositoryPort {
  findSource(
    courseSlug: string,
    userId: string,
  ): Promise<CertificateSourceRow | undefined>;
  /** The same row for a caller that knows the enrolment and not the learner. */
  findSourceByEnrolment(enrolmentId: string): Promise<CertificateSourceRow | undefined>;
  findCertificate(enrolmentId: string): Promise<CertificateRow | undefined>;
  /** The enrolment a certificate row belongs to — the delivery sweep's way in. */
  findEnrolmentIdByCertificate(certificateId: string): Promise<string | undefined>;
  issue(input: {
    customerId: string;
    enrolmentId: string;
    participantName: string;
    downloadToken: string;
    issuedAt: Date;
  }): Promise<CertificateRow>;
  /** Record where the issued bytes were archived, and what they hash to. */
  recordArchive(input: {
    certificateId: string;
    objectKey: string;
    sha256: string;
    at: Date;
  }): Promise<void>;
}

/**
 * Every field a certificate is rendered from, in one place.
 *
 * Shared by the two finders below (P59-01) so a document rendered for the
 * download and one rendered for the e-mail cannot differ in what they carry.
 */
const certificateSourceColumns = {
  enrolmentId: enrolments.id,
  /** For the archive key, which is per customer and per course (P60-01). */
  courseId: courses.id,
  completedAt: enrolments.completedAt,
  // From the enrolment, not the course: these were snapshotted when the
  // learner enrolled, and the certificate must state what was in force
  // then rather than whatever the course says today.
  vnr: enrolments.vnr,
  cmePoints: enrolments.cmePoints,
  cmeCategory: enrolments.cmeCategory,
  attestedName: enrolments.attestedName,
  attestedAddress: enrolments.attestedAddress,
  courseTitle: courses.title,
  eventLocation: courses.eventLocation,
  organizer: courses.organizer,
  accreditationBody: courses.accreditationBody,
  // Signing assets read live: replacing a stamp should fix every future
  // download, and a stamp is not part of what the learner earned.
  scientificLeadName: courses.scientificLeadName,
  scientificLeadTitle: courses.scientificLeadTitle,
  certificateIssuePlace: courses.certificateIssuePlace,
  stampImage: courses.stampImage,
  stampImageMime: courses.stampImageMime,
  signatureImage: courses.signatureImage,
  signatureImageMime: courses.signatureImageMime,
  firstName: users.firstName,
  lastName: users.lastName,
  /*
   * The EFN, printed on the document since P60-02.
   *
   * Read live from `efn_profiles` rather than snapshotted onto the enrolment,
   * and that is the right way round for this one field: an EFN is permanent
   * and unique per physician (ADR-0004), so a *correction* to it means the
   * earlier value was wrong — including on a certificate already issued.
   * Snapshotting would keep the typo on the paper while the Punktemeldung went
   * to the corrected number.
   *
   * LEFT join: a point-free course never asks for one, and erasure deletes the
   * row. Either way the renderer omits the line rather than drawing an empty
   * field (CLAUDE.md §9.4).
   */
  efn: efnProfiles.efn,
} as const;

export class CertificateRepository implements CertificateRepositoryPort {
  constructor(private readonly db: Db) {}

  async findSource(
    courseSlug: string,
    userId: string,
  ): Promise<CertificateSourceRow | undefined> {
    const [row] = await this.db
      .select(certificateSourceColumns)
      .from(enrolments)
      .innerJoin(courses, eq(courses.id, enrolments.courseId))
      .innerJoin(users, eq(users.id, enrolments.userId))
      .leftJoin(efnProfiles, eq(efnProfiles.userId, enrolments.userId))
      .where(and(eq(courses.slug, courseSlug), eq(enrolments.userId, userId)))
      .limit(1);

    return row as CertificateSourceRow | undefined;
  }

  /**
   * The same source row, found by enrolment (P59-01).
   *
   * The completion path and the delivery sweep both know an enrolment id and
   * neither has a course slug or a signed-in learner. It selects the identical
   * column list rather than a subset: two certificate readers that saw
   * different fields would eventually render two different documents for one
   * participation.
   */
  async findSourceByEnrolment(
    enrolmentId: string,
  ): Promise<CertificateSourceRow | undefined> {
    const [row] = await this.db
      .select(certificateSourceColumns)
      .from(enrolments)
      .innerJoin(courses, eq(courses.id, enrolments.courseId))
      .innerJoin(users, eq(users.id, enrolments.userId))
      .leftJoin(efnProfiles, eq(efnProfiles.userId, enrolments.userId))
      .where(eq(enrolments.id, enrolmentId))
      .limit(1);

    return row as CertificateSourceRow | undefined;
  }

  async findEnrolmentIdByCertificate(certificateId: string): Promise<string | undefined> {
    const [row] = await this.db
      .select({ enrolmentId: certificates.enrolmentId })
      .from(certificates)
      .where(eq(certificates.id, certificateId))
      .limit(1);

    return row?.enrolmentId;
  }

  async findCertificate(enrolmentId: string): Promise<CertificateRow | undefined> {
    const [row] = await this.db
      .select({
        id: certificates.id,
        downloadToken: certificates.downloadToken,
        participantName: certificates.participantName,
        status: certificates.status,
        issuedAt: certificates.issuedAt,
        pdfObjectKey: certificates.pdfObjectKey,
      })
      .from(certificates)
      .where(eq(certificates.enrolmentId, enrolmentId))
      .limit(1);

    return row as CertificateRow | undefined;
  }

  /**
   * Record the issue, once. A second call returns the existing row rather than
   * minting a new token: the token identifies *this* certificate, and rotating
   * it would break a link a physician may already have filed.
   */
  async issue(input: {
    customerId: string;
    enrolmentId: string;
    participantName: string;
    downloadToken: string;
    issuedAt: Date;
  }): Promise<CertificateRow> {
    const [row] = await this.db
      .insert(certificates)
      .values({
        customerId: input.customerId,
        enrolmentId: input.enrolmentId,
        participantName: input.participantName,
        downloadToken: input.downloadToken,
        status: "issued",
        issuedAt: input.issuedAt,
      })
      .onConflictDoNothing({ target: certificates.enrolmentId })
      .returning({
        id: certificates.id,
        downloadToken: certificates.downloadToken,
        participantName: certificates.participantName,
        status: certificates.status,
        issuedAt: certificates.issuedAt,
        pdfObjectKey: certificates.pdfObjectKey,
      });

    if (row !== undefined) return row as CertificateRow;

    const existing = await this.findCertificate(input.enrolmentId);
    if (existing === undefined) {
      throw new Error("issue: insert conflicted but no certificate is visible");
    }
    return existing;
  }

  /**
   * Record the archive (P60-01).
   *
   * `WHERE pdf_object_key IS NULL` so the first archive wins and a later
   * re-render cannot overwrite the key or the digest of the document that was
   * actually issued — which is the only version the archive exists to hold.
   * It also makes this safe to call unconditionally: after erasure has cleared
   * the key the guard would let a re-archive back in, which is why the caller
   * checks the row rather than relying on this alone.
   */
  async recordArchive(input: {
    certificateId: string;
    objectKey: string;
    sha256: string;
    at: Date;
  }): Promise<void> {
    await this.db
      .update(certificates)
      .set({
        pdfObjectKey: input.objectKey,
        pdfSha256: input.sha256,
        pdfArchivedAt: input.at,
        updatedAt: new Date(),
      })
      .where(
        and(eq(certificates.id, input.certificateId), isNull(certificates.pdfObjectKey)),
      );
  }
}
