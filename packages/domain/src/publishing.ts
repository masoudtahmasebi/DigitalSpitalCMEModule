/**
 * What a course must have before it may be published (P62-02).
 *
 * ## The failure this exists to prevent
 *
 * A course could be `published`, award CME points, and carry no VNR, no VNR
 * password, no accreditation body, no organiser, no stamp and no signature. A
 * physician enrols, watches, passes, evaluates, supplies their EFN — and only
 * then does anything discover that no certificate can be rendered and no
 * Punktemeldung can be sent. Every one of those fields is read at the *end*,
 * which is why nothing noticed at the beginning.
 *
 * ## Why the trigger is "awards CME points" and not "is published"
 *
 * A course without points has no certificate and no Meldung, so there is
 * nothing for it to be incomplete *for*. `ds-ohne-punkte` in the DS seed is
 * exactly that case and is a real client requirement — demanding a VNR of it
 * would refuse a course that is correct.
 *
 * ## Why this is pure, and where the guarantee actually lives
 *
 * This names the missing fields so the person clicking **Veröffentlichen** gets
 * a list rather than a constraint name. It is **not** the guarantee: the
 * database holds that, in `courses_published_cme_is_complete` (migration 0042),
 * because a seed, a migration or an operator with `psql` never passes through
 * this function. Same division as ADR-0002 — application code explains, the
 * schema guarantees.
 *
 * **Called by** `AdminService.updateCourse`, which is where a course changes
 * status. If that call site is ever removed, the database still refuses; the
 * message just gets worse.
 */

/**
 * The fields the Teilnahmebescheinigung and the Punktemeldung read.
 *
 * Derived from `missingCertificateFields` and the EIV submission payload rather
 * than written afresh, so a new mandatory certificate field cannot be added
 * without this list being looked at. The two that are *not* here are worth
 * naming:
 *
 * - `fortbildungsnummer` — nothing reads it (docs/show-stoppers.md S24). It
 *   renders one line on the Zertifizierung tab and is absent from the
 *   certificate and the Meldung alike. Requiring it would be inventing a rule.
 * - the media sources — they live on `contents`, not on the course, so this
 *   function cannot see them. That is P62-03's check.
 */
export type PublishBlocker =
  | "vnr"
  | "vnrPassword"
  | "cmeCategory"
  | "accreditationBody"
  | "organizer"
  | "eventLocation"
  | "scientificLeadName"
  | "certificateIssuePlace"
  | "stampImage"
  | "signatureImage";

export interface PublishCandidate {
  readonly status: "draft" | "published";
  /** `null` or `0` means the course awards nothing and the rule does not apply. */
  readonly cmePoints: number | null;
  readonly vnr: string | null;
  readonly hasVnrPassword: boolean;
  readonly cmeCategory: string | null;
  readonly accreditationBody: string | null;
  readonly organizer: string | null;
  readonly eventLocation: string | null;
  readonly scientificLeadName: string | null;
  readonly certificateIssuePlace: string | null;
  readonly hasStampImage: boolean;
  readonly hasSignatureImage: boolean;
}

/** True when this course will produce a certificate and a Punktemeldung. */
export function awardsCmePoints(course: { readonly cmePoints: number | null }): boolean {
  return course.cmePoints !== null && course.cmePoints > 0;
}

/**
 * Everything missing that would stop this course producing what it promises.
 *
 * Empty for a draft and empty for a point-free course — both by design, and
 * both asserted. A caller wanting "may this be published" asks
 * `publishBlockers({ ...course, status: "published" }).length === 0`, which
 * makes the question about the *target* state rather than the current one.
 */
export function publishBlockers(course: PublishCandidate): readonly PublishBlocker[] {
  if (course.status !== "published") return [];
  if (!awardsCmePoints(course)) return [];

  const missing: PublishBlocker[] = [];

  if (isBlank(course.vnr)) missing.push("vnr");
  // A boolean, not the ciphertext: the domain is pure and must never be handed
  // a credential, encrypted or otherwise (CLAUDE.md §4 invariant 7).
  if (!course.hasVnrPassword) missing.push("vnrPassword");
  if (isBlank(course.cmeCategory)) missing.push("cmeCategory");
  if (isBlank(course.accreditationBody)) missing.push("accreditationBody");
  if (isBlank(course.organizer)) missing.push("organizer");
  if (isBlank(course.eventLocation)) missing.push("eventLocation");
  if (isBlank(course.scientificLeadName)) missing.push("scientificLeadName");
  if (isBlank(course.certificateIssuePlace)) missing.push("certificateIssuePlace");
  if (!course.hasStampImage) missing.push("stampImage");
  if (!course.hasSignatureImage) missing.push("signatureImage");

  return missing;
}

/**
 * The German label for each blocker, for the refusal an author reads.
 *
 * Here rather than in the widget's locale file because the admin console is the
 * only consumer and the API composes the message — the console never sees the
 * field names, only the sentence. Kept as one map so a new blocker cannot be
 * added without a label.
 */
const LABELS: Readonly<Record<PublishBlocker, string>> = {
  vnr: "VNR",
  vnrPassword: "VNR-Passwort",
  cmeCategory: "CME-Kategorie",
  accreditationBody: "Ärztekammer",
  organizer: "Veranstalter",
  eventLocation: "Veranstaltungsort",
  scientificLeadName: "Wissenschaftliche Leitung",
  certificateIssuePlace: "Ausstellungsort der Bescheinigung",
  stampImage: "Stempel",
  signatureImage: "Unterschrift",
};

/** `"VNR, VNR-Passwort und Stempel"` — the list, in a German sentence. */
export function describePublishBlockers(blockers: readonly PublishBlocker[]): string {
  const names = blockers.map((blocker) => LABELS[blocker]);
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} und ${names[names.length - 1] ?? ""}`;
}

function isBlank(value: string | null): boolean {
  return value === null || value.trim() === "";
}
