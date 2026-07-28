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
 * - **A download link that works without signing in.** The PDF is attached, and
 *   the link goes to the course page rather than straight to the file. A URL
 *   that hands the certificate to whoever presents it is a bearer credential in
 *   a mailbox — and mailboxes are forwarded, backed up and synced to phones.
 *   The attachment is what most recipients will use; the link is what still
 *   works when a corporate filter strips attachments, and it costs a sign-in
 *   that Keycloak's SSO session usually makes invisible.
 *
 * Plain text, no HTML. An HTML mail is a rendering surface with a tracking-pixel
 * shaped hole in it, and this message is four sentences.
 */

export interface CertificateEmailInput {
  readonly participantName: string;
  readonly courseTitle: string;
  /**
   * Absolute, or empty when `PORTAL_BASE_URL` is unset.
   *
   * Empty drops the whole paragraph rather than emitting `/kurs/slug`, which in
   * an email is not a link at all — a mail client has no origin to resolve it
   * against, so it renders as text or 404s.
   */
  readonly courseUrl: string;
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
      ...(input.courseUrl === ""
        ? []
        : [
            "Sie können sie außerdem jederzeit in Ihrem Konto herunterladen:",
            input.courseUrl,
            "",
          ]),
      "Ihre CME-Punkte werden von uns an die Ärztekammer gemeldet. Bitte prüfen",
      "Sie Ihr Punktekonto einige Tage nach Ihrer Teilnahme.",
      "",
      "Mit freundlichen Grüßen",
    ].join("\n"),
  };
}
