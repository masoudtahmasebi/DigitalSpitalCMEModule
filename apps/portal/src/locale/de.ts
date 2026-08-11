/**
 * Every German string the portal shell renders (CLAUDE.md §5).
 *
 * Only the shell. Everything inside the course — the player, the quiz, the
 * Evaluationsbogen, the certificate panel — is rendered by `<ds-lms>` and takes
 * its copy from the widget's own locale file. Two files, because they are two
 * artifacts with two release cycles; a portal string and a widget string that
 * happened to be identical would still be two strings.
 *
 * It got much shorter when the portal stopped keeping a catalogue of its own
 * (see `WidgetMount.tsx`). What is left is sign-in, one back link and two
 * failures that happen before the widget is mounted — which is the right size
 * for a host adapter's vocabulary.
 */

export const de = {
  appTitle: "Fortbildungen",

  /**
   * "Passwort vergessen" (P40-03).
   *
   * The confirmation says *wenn* and not *wir haben*, deliberately. The API
   * answers the same for an unknown address as for a known one — asking whether
   * a given physician has an account with a named pharmaceutical company is
   * close enough to health-adjacent information about a named person — and a
   * sentence that confirmed the address exists would give that back in the last
   * inch.
   */
  forgot: {
    link: "Passwort vergessen?",
    title: "Passwort zurücksetzen",
    intro:
      "Geben Sie die E-Mail-Adresse Ihres Zugangs ein. Wenn es einen Zugang dazu gibt, senden wir Ihnen einen Link, mit dem Sie ein neues Passwort vergeben können.",
    submit: "Link anfordern",
    sending: "Wird gesendet …",
    sent: "Wenn es einen Zugang zu dieser Adresse gibt, ist ein Link unterwegs. Er ist 60 Minuten gültig und lässt sich einmal verwenden. Bitte prüfen Sie auch den Spam-Ordner.",
    throttled:
      "Es wurden zu viele Anfragen gestellt. Bitte versuchen Sie es in einer Minute erneut.",
    back: "Zurück zur Anmeldung",

    resetTitle: "Neues Passwort vergeben",
    resetIntro:
      "Bitte wählen Sie ein Passwort mit mindestens 12 Zeichen. Es darf Ihren Namen und Ihre E-Mail-Adresse nicht enthalten.",
    newPassword: "Neues Passwort",
    repeat: "Passwort wiederholen",
    resetSubmit: "Passwort speichern",
    mismatch: "Die beiden Eingaben stimmen nicht überein.",
    resetDone:
      "Das Passwort wurde gespeichert. Sie können sich jetzt mit dem neuen Passwort anmelden.",
    linkDead:
      "Dieser Link ist nicht mehr gültig. Links lassen sich einmal verwenden und laufen ab — fordern Sie über „Passwort vergessen?“ einen neuen an.",
  },

  /**
   * The build footer (P46-01). The commit itself is never translated — it has
   * to match `docker images` and the deploy log character for character.
   */
  build: {
    portal: "Portal",
    api: "API",
    skew: "Unterschiedliche Stände — bitte erneut deployen.",
  },

  auth: {
    signIn: "Anmelden",
    signOut: "Abmelden",
    signingIn: "Anmeldung läuft …",
    failed: "Die Anmeldung ist fehlgeschlagen. Bitte versuchen Sie es erneut.",
    intro:
      "Melden Sie sich an, um Ihre Fortbildungen zu sehen und Ihre CME-Punkte zu erhalten.",

    /**
     * The password form (P25-02).
     *
     * `refused` is deliberately one message for every failure — wrong address,
     * wrong password, locked account. The API answers all of them identically
     * on purpose, and a client that guessed at a friendlier distinction would
     * reintroduce the account-enumeration oracle the API just removed.
     */
    email: "E-Mail-Adresse",
    password: "Passwort",
    refused: "E-Mail-Adresse oder Passwort ist nicht korrekt.",
    tooManyAttempts:
      "Zu viele Anmeldeversuche. Bitte warten Sie einen Moment und versuchen Sie es erneut.",
    unreachable:
      "Die Anmeldung ist derzeit nicht erreichbar. Bitte versuchen Sie es später erneut.",
    noAccount:
      "Sie haben noch keine Zugangsdaten? Wenden Sie sich bitte an Ihre Ansprechperson bei",
  },

  /**
   * Choosing your own password (P21-04).
   *
   * `wrongCurrent` covers a wrong current password, a disabled account and a
   * federated one alike, because the API answers all three identically — the
   * caller is already authenticated, so there is nothing to enumerate, and
   * nothing the client could usefully do differently either.
   */
  password: {
    title: "Bitte wählen Sie ein eigenes Passwort",
    intro:
      "Ihr Zugang wurde für Sie eingerichtet. Bitte vergeben Sie jetzt ein Passwort, das nur Sie kennen — danach steht Ihnen die Fortbildung offen.",
    current: "Aktuelles Passwort",
    next: "Neues Passwort",
    confirm: "Neues Passwort wiederholen",
    rule: (min: number) =>
      `Mindestens ${String(min)} Zeichen. Ihr Name und Ihre E-Mail-Adresse dürfen nicht enthalten sein.`,
    save: "Passwort speichern",
    saving: "Wird gespeichert …",
    wrongCurrent: "Das aktuelle Passwort ist nicht korrekt.",
    tooWeak:
      "Dieses Passwort erfüllt die Anforderungen nicht. Bitte wählen Sie ein längeres, das weder Ihren Namen noch Ihre E-Mail-Adresse enthält.",
    mismatch: "Die beiden Passwörter stimmen nicht überein.",
  },

  nav: {
    back: "Zurück zur Übersicht",
  },

  /**
   * The root page (P21-03).
   *
   * It names no customer and starts no login, which is the whole point: the
   * root used to be one customer's front door and pushed every visitor at that
   * customer's identity provider before telling them where they were.
   */
  welcome: {
    title: "Fortbildungen von DigitalSpital",
    lead: "Zertifizierte medizinische Fortbildung — online, jederzeit, mit CME-Punkten.",
    body: "Ihre Fortbildungen erreichen Sie über die Adresse, die Sie von Ihrem Anbieter erhalten haben. Diese endet auf den Namen Ihres Anbieters, zum Beispiel /medice.",
    contact:
      "Sie wissen nicht, welche Adresse für Sie gilt? Ihr Anbieter hilft Ihnen weiter.",
  },

  tenant: {
    unknown: "Diesen Bereich gibt es nicht",
    unknownBody:
      "Die aufgerufene Adresse gehört zu keinem Anbieter. Bitte prüfen Sie den Link.",
    toWelcome: "Zur Startseite",
    signInAt: (customer: string) => `Anmeldung bei ${customer}`,
    signInExternal: (customer: string) =>
      `Ihre Anmeldung erfolgt direkt bei ${customer}. Danach kehren Sie hierher zurück.`,
    loading: "Wird geladen …",
  },

  error: {
    title: "Es ist ein Fehler aufgetreten",
    misconfigured:
      "Das Portal ist nicht korrekt konfiguriert. Bitte wenden Sie sich an den Betreiber.",
  },
} as const;
