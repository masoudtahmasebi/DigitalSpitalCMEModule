/**
 * Certificate data contract (P8 — data half only).
 *
 * This is deliberately *not* a PDF renderer. It is the pure assembly of the
 * fields a Teilnahmebescheinigung must legally carry, from data we already own
 * at completion time. Rendering, barcodes and email delivery are a separate,
 * deferred concern (see docs/show-stoppers.md S12): the Ärztekammer has not yet
 * confirmed whether an emailed PDF can satisfy the "Originalstempel" clause, and
 * building a renderer before that answer arrives would be the wrong order.
 *
 * What is NOT deferred is capturing the data. Every field here is snapshotted at
 * completion, so that a later change to the course record can never alter an
 * already-earned certificate — the same immutability principle as the enrolment
 * snapshot (ADR compliance: values on a CME document must reflect the
 * accreditation in force when the learner completed).
 *
 * Source of the mandatory field set: the Anerkennungsbescheid (ÄKWL,
 * 18.06.2026), which states a Teilnahmebescheinigung must contain at minimum
 * "Veranstaltungsnummer (VNR), -titel, -datum, -uhrzeit, -ort, Veranstalter,
 * Punkte und Kategorie sowie den Namen des Teilnehmenden".
 */

export interface CertificateInput {
  readonly vnr: string;
  readonly courseTitle: string;
  /** Doubles as -datum and -uhrzeit: the certificate renders both. */
  readonly completedAt: Date;
  readonly eventLocation: string;
  readonly organizer: string;
  /** Integer, per CLAUDE.md §5. */
  readonly cmePoints: number;
  readonly cmeCategory: string;
  readonly accreditationBody: string;
  readonly participantName: string;
  /**
   * From the Muster ("Anschrift:"), still pending the S13 decision on whether a
   * blank address is acceptable for an online on-demand format. Optional so
   * completion is never blocked on it.
   */
  readonly participantAddress?: string;
}

export interface CertificateData extends CertificateInput {
  /**
   * The wording the Bescheid asks be reproduced verbatim, with the course's own
   * points and category substituted in. Precomputed here so no renderer ever
   * hardcodes "4 Punkten (Kategorie D)".
   */
  readonly creditSentence: string;
}

/**
 * The mandatory creditability sentence, templated.
 *
 *   "Die Veranstaltung ist im Rahmen der Zertifizierung der ärztlichen
 *    Fortbildung der <body> mit <n> Punkt(en) (Kategorie <cat>) anrechenbar."
 *
 * German number agreement matters on a legal document: one point is
 * "1 Punkt", more than one is "N Punkten". Getting this wrong is not a
 * typo, it is a defect on an accreditation record.
 */
export function creditSentence(
  cmePoints: number,
  cmeCategory: string,
  accreditationBody: string,
): string {
  const punkte = cmePoints === 1 ? "1 Punkt" : `${cmePoints} Punkten`;
  return (
    `Die Veranstaltung ist im Rahmen der Zertifizierung der ärztlichen ` +
    `Fortbildung der ${accreditationBody} mit ${punkte} (Kategorie ${cmeCategory}) ` +
    `anrechenbar.`
  );
}

/**
 * Assemble the certificate data. Pure: no clock, no I/O — `completedAt` is the
 * caller's completion timestamp, not `now`.
 *
 * Which fields are missing (for the renderer to reject on, or the caller to
 * flag) is reported by `missingCertificateFields` rather than thrown here, so
 * that a completion can still record the data it has.
 */
export function buildCertificateData(input: CertificateInput): CertificateData {
  return {
    ...input,
    creditSentence: creditSentence(
      input.cmePoints,
      input.cmeCategory,
      input.accreditationBody,
    ),
  };
}

export type CertificateField =
  | "vnr"
  | "courseTitle"
  | "completedAt"
  | "eventLocation"
  | "organizer"
  | "cmePoints"
  | "cmeCategory"
  | "accreditationBody"
  | "participantName";

/**
 * The mandatory fields (per the Bescheid) that are absent or empty.
 *
 * `participantAddress` is intentionally excluded: it is required by the Muster
 * but its necessity for an online format is still an open question (S13), so a
 * missing address does not make the data incomplete for our purposes yet.
 */
export function missingCertificateFields(
  input: CertificateInput,
): readonly CertificateField[] {
  const missing: CertificateField[] = [];

  if (isBlank(input.vnr)) missing.push("vnr");
  if (isBlank(input.courseTitle)) missing.push("courseTitle");
  if (!(input.completedAt instanceof Date) || Number.isNaN(input.completedAt.getTime()))
    missing.push("completedAt");
  if (isBlank(input.eventLocation)) missing.push("eventLocation");
  if (isBlank(input.organizer)) missing.push("organizer");
  if (!Number.isInteger(input.cmePoints) || input.cmePoints <= 0)
    missing.push("cmePoints");
  if (isBlank(input.cmeCategory)) missing.push("cmeCategory");
  if (isBlank(input.accreditationBody)) missing.push("accreditationBody");
  if (isBlank(input.participantName)) missing.push("participantName");

  return missing;
}

function isBlank(value: string | undefined): boolean {
  return value === undefined || value.trim() === "";
}
