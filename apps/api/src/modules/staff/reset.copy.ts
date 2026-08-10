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

import { RESET_VALID_MINUTES } from "@ds/domain";
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
