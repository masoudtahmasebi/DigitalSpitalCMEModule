/**
 * Certificate data access (P8). Infrastructure layer — ADR-0006.
 *
 * The certificate row is the immutable record of what was issued; the course
 * row supplies the signing assets at render time. Those are read separately on
 * purpose: replacing an expired stamp must fix every future download without
 * rewriting certificates already issued, and re-issuing must not silently
 * change the participation data a physician has already filed.
 */

import { and, eq } from "drizzle-orm";
import type { Db } from "../../db/tenant-db.js";
import { certificates, courses, enrolments, users } from "../../db/schema.js";

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
  firstName: string | null;
  lastName: string | null;
}

export interface CertificateRow {
  id: string;
  downloadToken: string;
  participantName: string;
  status: "pending" | "issued" | "delivered" | "bounced";
  issuedAt: Date | null;
}

export interface CertificateRepositoryPort {
  findSource(courseSlug: string, userId: string): Promise<CertificateSourceRow | undefined>;
  findCertificate(enrolmentId: string): Promise<CertificateRow | undefined>;
  issue(input: {
    customerId: string;
    enrolmentId: string;
    participantName: string;
    downloadToken: string;
    issuedAt: Date;
  }): Promise<CertificateRow>;
}

export class CertificateRepository implements CertificateRepositoryPort {
  constructor(private readonly db: Db) {}

  async findSource(
    courseSlug: string,
    userId: string,
  ): Promise<CertificateSourceRow | undefined> {
    const [row] = await this.db
      .select({
        enrolmentId: enrolments.id,
        completedAt: enrolments.completedAt,
        // From the enrolment, not the course: these were snapshotted when the
        // learner enrolled, and the certificate must state what was in force
        // then rather than whatever the course says today.
        vnr: enrolments.vnr,
        cmePoints: enrolments.cmePoints,
        cmeCategory: enrolments.cmeCategory,
        attestedName: enrolments.attestedName,
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
      })
      .from(enrolments)
      .innerJoin(courses, eq(courses.id, enrolments.courseId))
      .innerJoin(users, eq(users.id, enrolments.userId))
      .where(and(eq(courses.slug, courseSlug), eq(enrolments.userId, userId)))
      .limit(1);

    return row as CertificateSourceRow | undefined;
  }

  async findCertificate(enrolmentId: string): Promise<CertificateRow | undefined> {
    const [row] = await this.db
      .select({
        id: certificates.id,
        downloadToken: certificates.downloadToken,
        participantName: certificates.participantName,
        status: certificates.status,
        issuedAt: certificates.issuedAt,
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
      });

    if (row !== undefined) return row as CertificateRow;

    const existing = await this.findCertificate(input.enrolmentId);
    if (existing === undefined) {
      throw new Error("issue: insert conflicted but no certificate is visible");
    }
    return existing;
  }
}
