/**
 * Certificate data contract (P8 — data half only).
 *
 * This is deliberately *not* a PDF renderer. It is the pure assembly of the
 * fields a Teilnahmebescheinigung must legally carry, from data we already own
 * at completion time. Rendering, barcodes and delivery live in the API's
 * certificate module, which has fonts, images and I/O; this file has none of
 * those and stays exhaustively testable.
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
 * Punkte und Kategorie sowie den Namen des Teilnehmenden", and additionally
 * that the certificate carry the stamp of, and be signed by, the
 * Wissenschaftliche Leitung. Those two are images and therefore the renderer's
 * problem; the lead's *name* is data and lives here.
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
   * Present on the Muster ("Anschrift:") but absent from the Bescheid's list of
   * minimum required fields, so it is optional. The learner supplies it with
   * the rest of the Punktemeldung form and may leave it empty (P60-03); the
   * renderer draws the line either way, because the Muster has it and a form
   * missing a line it should have looks altered.
   */
  readonly participantAddress?: string;
  /**
   * The Einheitliche Fortbildungsnummer, printed on the document (P60-02).
   *
   * Optional rather than mandatory, and deliberately: a course awarding no CME
   * points reports nothing to EIV-FOBI and never asks for an EFN, so there is
   * nothing to print. Where the course *does* award points the completion gate
   * has already required one, so it is present exactly when it means something
   * — which is why the renderer omits the line rather than drawing an empty
   * one (CLAUDE.md §9.4: an empty field reads as an unfinished feature).
   *
   * This overrides the reading in ADR-0004 that kept the EFN off the printed
   * document; MEDICE asked for it on the certificate. The EFN still never
   * reaches a log, an audit `detail`, or any other person's response.
   */
  readonly efn?: string;
  /**
   * The Wissenschaftliche Leitung whose stamp and signature validate the
   * document. Mandatory — a certificate without it is not valid per the
   * Bescheid — and reported by `missingCertificateFields`.
   */
  readonly scientificLeadName: string;
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
  | "participantName"
  | "scientificLeadName";

/**
 * The mandatory fields (per the Bescheid) that are absent or empty.
 *
 * `participantAddress` and `efn` are intentionally excluded: neither is in the
 * Bescheid's minimum list, and both are legitimately absent — an address the
 * learner did not supply, an EFN a point-free course never asked for. Their
 * absence does not make a certificate incomplete, and treating it as though it
 * did would refuse a document somebody has earned.
 *
 * The stamp and signature *images* are likewise not checked here — this
 * function is pure and never sees bytes. The renderer refuses separately if
 * either asset is missing, which is the only place that can know.
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
  if (isBlank(input.scientificLeadName)) missing.push("scientificLeadName");

  return missing;
}

function isBlank(value: string | undefined): boolean {
  return value === undefined || value.trim() === "";
}
