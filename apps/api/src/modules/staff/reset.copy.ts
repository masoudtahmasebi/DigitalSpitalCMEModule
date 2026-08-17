/**
 * What a password-reset email says (P40-02).
 *
 * Its own file, beside `certificate/delivery.copy.ts`, for the same reason that
 * one has: German user-facing text does not belong inline in a service
 * (CLAUDE.md §5), and copy that reaches a person's inbox is reviewed by
 * different eyes than the code that sends it.
 *
 * ## What is deliberately not in it
 *
 * **No name.** The message goes to an address that may not be the person we
 * think it is — that is the whole reason it exists — and greeting a stranger by
 * the account holder's name confirms who holds the account. It is also personal
 * data in a message that did not need any (ADR-0004).
 *
 * **No account details.** Not the role, not the customer, not when the account
 * was created. Somebody reading a misdirected reset mail learns that an account
 * exists at this address and nothing else.
 *
 * **Plain text.** An HTML mail with a styled button is nicer and is a phishing
 * template somebody can lift verbatim. The link is visible as itself, which is
 * what a person needs in order to check it before clicking.
 */

import { INVITE_VALID_DAYS, RESET_VALID_MINUTES } from "@ds/domain";
import type { OutboundLetter } from "../../shared/mailer.js";

export function passwordResetEmail(link: string): OutboundLetter {
  return {
    to: "", // filled in by the caller, which is the only place that knows it
    subject: "Passwort zurücksetzen — DS Education",
    body: [
      "Guten Tag,",
      "",
      "für Ihr Konto in der DS-Education-Verwaltung wurde ein neues Passwort",
      "angefordert. Über den folgenden Link können Sie eines vergeben:",
      "",
      link,
      "",
      `Der Link ist ${String(RESET_VALID_MINUTES)} Minuten gültig und kann nur ein`,
      "einziges Mal verwendet werden. Sobald Sie ein neues Passwort vergeben",
      "haben, werden alle bestehenden Anmeldungen dieses Kontos beendet.",
      "",
      "Wenn Sie das nicht angefordert haben, müssen Sie nichts tun — ohne diesen",
      "Link ändert sich an Ihrem Konto nichts. Der zweite Faktor bleibt in jedem",
      "Fall erforderlich.",
      "",
      "Diese Nachricht wurde automatisch erzeugt. Bitte antworten Sie nicht",
      "darauf.",
    ].join("\n"),
  };
}

/**
 * The same, for a physician on the portal.
 *
 * A separate function rather than a parameter, because the two differ in more
 * than a noun: this one goes to somebody who may hold accounts with several
 * customers, so it names the Fortbildungsportal rather than "die Verwaltung",
 * and it says nothing about a second factor because the learner plane has none.
 */
export function participantResetEmail(link: string): OutboundLetter {
  return {
    to: "",
    subject: "Passwort zurücksetzen — Fortbildungsportal",
    body: [
      "Guten Tag,",
      "",
      "für Ihren Zugang zum Fortbildungsportal wurde ein neues Passwort",
      "angefordert. Über den folgenden Link können Sie eines vergeben:",
      "",
      link,
      "",
      `Der Link ist ${String(RESET_VALID_MINUTES)} Minuten gültig und kann nur ein`,
      "einziges Mal verwendet werden.",
      "",
      "Wenn Sie das nicht angefordert haben, müssen Sie nichts tun — ohne diesen",
      "Link ändert sich an Ihrem Zugang nichts. Ihre bereits erworbenen",
      "Fortbildungspunkte sind davon in keinem Fall betroffen.",
      "",
      "Diese Nachricht wurde automatisch erzeugt. Bitte antworten Sie nicht",
      "darauf.",
    ].join("\n"),
  };
}

/**
 * An invitation to the console (P40-05).
 *
 * Separate from the reset copy because the reader is in a different situation:
 * they have no account yet, they did not ask for this mail, and the useful
 * thing to tell them is who it is from and what it is for. A reset mail says
 * "you asked for this"; an invitation cannot.
 *
 * Still no name and no account details, for the reset copy's reasons — and
 * still no mention of which role was granted. What somebody may do is decided
 * on every request by their grant, not by a sentence in an email, and printing
 * it here would only be a claim that could go stale.
 */
export function invitationEmail(link: string): OutboundLetter {
  return {
    to: "",
    subject: "Ihr Zugang zur DS-Education-Verwaltung",
    body: [
      "Guten Tag,",
      "",
      "für Sie wurde ein Zugang zur DS-Education-Verwaltung angelegt. Über den",
      "folgenden Link vergeben Sie Ihr Passwort und schließen die Einrichtung ab:",
      "",
      link,
      "",
      `Der Link ist ${String(INVITE_VALID_DAYS)} Tage gültig und kann nur ein einziges`,
      "Mal verwendet werden. Falls er abgelaufen ist, wenden Sie sich bitte an die",
      "Person, die Ihnen den Zugang eingerichtet hat.",
      "",
      "Wenn Sie damit nichts anfangen können, ignorieren Sie diese Nachricht",
      "bitte — ohne den Link entsteht kein nutzbarer Zugang.",
      "",
      "Diese Nachricht wurde automatisch erzeugt. Bitte antworten Sie nicht",
      "darauf.",
    ].join("\n"),
  };
}

/**
 * The message the SMTP test sends (P77-01).
 *
 * Deliberately contains no link, no token and nothing actionable. Its whole
 * job is to prove that the configured sender can reach a real inbox, so the
 * only things worth putting in it are the ones somebody would want to check
 * *in the received message*: that it arrived, where it came from, and that it
 * is not a leaked credential.
 *
 * It names the sender address on purpose. The commonest way this test misleads
 * is passing while the mail lands in spam or arrives with an unexpected From —
 * and both are things you can only see in the delivered message.
 */
export function smtpTestEmail(sentAtIso: string): OutboundLetter {
  return {
    to: "",
    subject: "Test-E-Mail — DS Education",
    body: [
      "Guten Tag,",
      "",
      "diese Nachricht wurde in der DS-Education-Verwaltung ausgelöst, um den",
      "E-Mail-Versand zu prüfen. Wenn Sie sie lesen, funktioniert der",
      "hinterlegte SMTP-Zugang.",
      "",
      `Gesendet: ${sentAtIso}`,
      "",
      "Bitte prüfen Sie auch, ob die Nachricht im Posteingang und nicht im",
      "Spam-Ordner gelandet ist und ob die Absenderadresse stimmt — beides",
      "lässt sich nur an der zugestellten Nachricht erkennen.",
      "",
      "Diese Nachricht enthält bewusst keinen Link und keine Zugangsdaten.",
      "",
      "Diese Nachricht wurde automatisch erzeugt. Bitte antworten Sie nicht",
      "darauf.",
    ].join("\n"),
  };
}
