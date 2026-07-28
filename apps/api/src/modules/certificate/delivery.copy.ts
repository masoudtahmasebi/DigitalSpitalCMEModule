/**
 * The German text of the certificate email (P8-03, CLAUDE.md §5).
 *
 * Its own file rather than inline in the service, for the usual reason and one
 * specific one: this is the only text the platform sends *outward*, to an
 * address it does not control, and what it contains is a compliance question
 * rather than a copywriting one.
 *
 * ## What is deliberately not in it
 *
 * - **The EFN.** An email is the least controlled place a physician's data can
 *   end up — forwarded, backed up, indexed by a mail provider. ADR-0004 makes
 *   the EFN write-only in the API; putting it in a message we send would undo
 *   that for no benefit, since the recipient already knows their own EFN.
 * - **The quiz score.** Nobody needs it and it is a statement about a named
 *   physician's competence.
 * - **The certificate as a link only.** The PDF is attached *and* linked: the
 *   attachment is what most recipients will use, and the link is what still
 *   works when a corporate filter strips attachments.
 *
 * Plain text, no HTML. An HTML mail is a rendering surface with a tracking-pixel
 * shaped hole in it, and this message is four sentences.
 */

export interface CertificateEmailInput {
  readonly participantName: string;
  readonly courseTitle: string;
  readonly downloadUrl: string;
}

export function certificateEmail(input: CertificateEmailInput): {
  subject: string;
  body: string;
} {
  return {
    subject: `Ihre Teilnahmebescheinigung: ${input.courseTitle}`,
    body: [
      `Guten Tag ${input.participantName},`,
      "",
      `vielen Dank für Ihre Teilnahme an der Fortbildung „${input.courseTitle}“.`,
      "Ihre Teilnahmebescheinigung finden Sie im Anhang dieser E-Mail.",
      "",
      "Sie können sie außerdem jederzeit hier herunterladen:",
      input.downloadUrl,
      "",
      "Ihre CME-Punkte werden von uns an die Ärztekammer gemeldet. Bitte prüfen",
      "Sie Ihr Punktekonto einige Tage nach Ihrer Teilnahme.",
      "",
      "Mit freundlichen Grüßen",
    ].join("\n"),
  };
}
