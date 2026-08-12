/**
 * The PDF the delivery e-mail is about (P59-02).
 *
 * ## Why this adapter exists
 *
 * `CertificateDeliveryService` is application logic and must not know how a
 * PDF is made or which database connection makes it. It asks a port; this is
 * the implementation, and its whole job is to open the claimed row's tenant
 * scope and hand the work to `CertificateService`, which is the one place that
 * assembles certificate data and renders it.
 *
 * The alternative — teaching the delivery repository to return bytes — would
 * have put rendering inside a repository, and a second assembly of the
 * certificate's fields beside the one `download` uses. Two assemblies is how a
 * physician ends up with an e-mailed document that differs from the one on
 * their screen.
 *
 * ## Why it never throws
 *
 * A certificate that cannot be rendered — a course whose stamp was never
 * uploaded, a name that cannot be composed — must not stop the covering
 * message. `issueForEnrolment` answers `undefined` for exactly those cases and
 * the e-mail goes out pointing at the download page instead, with the sentence
 * about the attachment dropped. An unexpected failure is logged and treated the
 * same way: one broken row must not take the batch down.
 */

import type { Pool } from "pg";
import { runInTenant } from "../../db/tenant-db.js";
import { CertificateService } from "./certificate.service.js";
import type { CertificateAttachmentPort } from "./delivery.service.js";
import type { ClaimedDelivery } from "./delivery.repository.js";
import type { CertificateArchivePort } from "./certificate.archive.js";

export interface AttachmentLogger {
  warn(message: string): void;
}

export class CertificateAttachments implements CertificateAttachmentPort {
  constructor(
    private readonly pool: Pool,
    private readonly logger: AttachmentLogger,
    /**
     * Passed on so a retry that renders for an unarchived certificate also
     * archives it (P60-01) — the completion is the usual archiver, but a row
     * issued before P60, or one whose bucket was down that day, gets its
     * chance here rather than staying unarchived forever.
     */
    private readonly archive?: CertificateArchivePort,
  ) {}

  async renderFor(
    claim: ClaimedDelivery,
  ): Promise<{ filename: string; bytes: Uint8Array } | undefined> {
    try {
      return await runInTenant(
        this.pool,
        // "system", not a borrowed super_admin: the audit trail must be able to
        // tell the delivery worker apart from a person (see TenantContext).
        { customerId: claim.customerId, role: "system" },
        async (db) => {
          const certificates = CertificateService.fromDb(db, this.archive);
          // The enrolment is looked up from the certificate row inside the same
          // scope, so nothing crosses a tenant boundary to get here.
          const enrolmentId = await certificates.enrolmentIdFor(claim.certificateId);
          if (enrolmentId === undefined) return undefined;

          return certificates.issueForEnrolment(
            enrolmentId,
            claim.customerId,
            new Date(),
          );
        },
      );
    } catch (error) {
      // The id and the error class, never the physician or the document.
      this.logger.warn(
        `certificate ${claim.certificateId}: render for delivery failed (${
          error instanceof Error ? error.name : "unknown"
        }); sending without the attachment`,
      );
      return undefined;
    }
  }
}
