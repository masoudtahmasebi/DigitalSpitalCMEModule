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
import type { TenantRunner } from "../../db/tenant-runner.js";
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
  /**
   * A course's own certificate fields, with no enrolment (P180-02).
   *
   * For the sample an operator renders while configuring a stamp, a signature
   * or a VNR. Everything about the *event* is real — that is the point, the
   * whole question being "will the document I issue look right" — and
   * everything about the *person* is supplied synthetically by the caller.
   */
  findCourseForSample(courseSlug: string): Promise<CertificateSourceRow | undefined>;
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
  /*
   * The accreditation is the **course's**, read live: VNR (P164-01), and the
   * points and category with it (P171-01).
   *
   * All three used to be `enrolments.*`, snapshotted at enrolment so a later
   * change could not rewrite what somebody earned. P164-01 moved the VNR and
   * argued the other two were different in kind — *"`cmePoints`, `cmeCategory`
   * and the attested identity are things the learner earned or stated"*. That
   * sentence was wrong about two of the three, and the client's screenshot is
   * the proof: one Zertifizierung tab, three lines apart,
   *
   *   > Diese Fortbildung ist … mit **10** CME-Punkten akkreditiert.
   *   > … im Rahmen der Zertifizierung … mit **4** Punkten (Kategorie D)
   *     anrechenbar.
   *
   * because the accreditation text renders `courses.cme_points` and the
   * Teilnahmebescheinigung rendered the enrolment's copy. §4 invariant 6 on a
   * legal document, and the identical shape the VNR had.
   *
   * A physician does not *earn* a number of points; the **event** is worth a
   * number of points, the Ärztekammer decided it, the VNR identifies it, and
   * the Bescheid states it. Points and category are attributes of that event in
   * exactly the way the VNR is — so when an operator corrects what the course
   * is worth, every certificate for it must say so, or the platform issues
   * documents that disagree with the register they name.
   *
   * The client, twice and in the same words both times: *"it should just print
   * what has been given"*, and *"how can you set these hard coded when there
   * are values in course!"*
   *
   * What stays snapshotted is what the *learner* did or stated: `attestedName`,
   * `attestedAddress`, the completion date. Those are theirs, not the event's.
   * The snapshot columns are still written and nothing here destroys them —
   * they remain the record of what was in force at enrolment.
   */
  vnr: courses.vnr,
  cmePoints: courses.cmePoints,
  cmeCategory: courses.cmeCategory,
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

  /**
   * The course's own certificate fields, with no enrolment and no person
   * (P180-02).
   *
   * Selected from `courses` alone. Every enrolment-shaped column comes back
   * null and the service supplies obviously synthetic values for them — which
   * is the safety property: there is no join here through which a **real**
   * physician's name, address or EFN could reach a sample document.
   */
  async findCourseForSample(
    courseSlug: string,
  ): Promise<CertificateSourceRow | undefined> {
    const [row] = await this.db
      .select({
        courseId: courses.id,
        vnr: courses.vnr,
        cmePoints: courses.cmePoints,
        cmeCategory: courses.cmeCategory,
        courseTitle: courses.title,
        eventLocation: courses.eventLocation,
        organizer: courses.organizer,
        accreditationBody: courses.accreditationBody,
        scientificLeadName: courses.scientificLeadName,
        scientificLeadTitle: courses.scientificLeadTitle,
        certificateIssuePlace: courses.certificateIssuePlace,
        stampImage: courses.stampImage,
        stampImageMime: courses.stampImageMime,
        signatureImage: courses.signatureImage,
        signatureImageMime: courses.signatureImageMime,
      })
      .from(courses)
      .where(eq(courses.slug, courseSlug))
      .limit(1);

    if (row === undefined) return undefined;

    return {
      ...row,
      enrolmentId: "",
      completedAt: null,
      attestedName: null,
      attestedAddress: null,
      firstName: null,
      lastName: null,
      efn: null,
    } as unknown as CertificateSourceRow;
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

/**
 * The same repository, one short transaction per call (P146-02).
 *
 * `CertificateService.download` reads the source, renders, issues the row,
 * **PUTs the PDF to the object store**, and records where it went. Under the
 * ambient transaction the bucket round trip happens with a pooled connection
 * held; ten physicians downloading while the bucket is slow is ten connections
 * gone, and the rest of the platform with them.
 *
 * ## Why splitting is safe here, verified rather than assumed
 *
 * `CertificateArchive.store` catches every failure and returns `undefined` —
 * it does not throw (`certificate.archive.ts:121,133`). So an archive failure
 * has **never** rolled back the issued certificate: the transaction committed
 * with `pdf_object_key` still null, and `archiveOnce`'s own
 * `if (row.pdfObjectKey !== null) return` retries it on the next download.
 * "Issued but not yet archived" is an existing, handled state, not a new one
 * this introduces.
 *
 * That is the test `tenant-runner.ts` sets for opting out, and it is the reason
 * `POST courses/:slug/completion` does **not** get this treatment: there the
 * atomicity is load-bearing, because the same transaction marks the enrolment
 * complete, issues the certificate and queues the Punktemeldung, and a partial
 * commit is a compliance incident rather than a retry.
 */
export class RunnerCertificateRepository implements CertificateRepositoryPort {
  constructor(private readonly run: TenantRunner) {}

  findSource(
    courseSlug: string,
    userId: string,
  ): Promise<CertificateSourceRow | undefined> {
    return this.run((db) => new CertificateRepository(db).findSource(courseSlug, userId));
  }

  findCourseForSample(courseSlug: string): Promise<CertificateSourceRow | undefined> {
    return this.run((db) =>
      new CertificateRepository(db).findCourseForSample(courseSlug),
    );
  }

  findSourceByEnrolment(enrolmentId: string): Promise<CertificateSourceRow | undefined> {
    return this.run((db) =>
      new CertificateRepository(db).findSourceByEnrolment(enrolmentId),
    );
  }

  findCertificate(enrolmentId: string): Promise<CertificateRow | undefined> {
    return this.run((db) => new CertificateRepository(db).findCertificate(enrolmentId));
  }

  findEnrolmentIdByCertificate(certificateId: string): Promise<string | undefined> {
    return this.run((db) =>
      new CertificateRepository(db).findEnrolmentIdByCertificate(certificateId),
    );
  }

  issue(input: {
    customerId: string;
    enrolmentId: string;
    participantName: string;
    downloadToken: string;
    issuedAt: Date;
  }): Promise<CertificateRow> {
    return this.run((db) => new CertificateRepository(db).issue(input));
  }

  recordArchive(input: {
    certificateId: string;
    objectKey: string;
    sha256: string;
    at: Date;
  }): Promise<void> {
    return this.run((db) => new CertificateRepository(db).recordArchive(input));
  }
}
