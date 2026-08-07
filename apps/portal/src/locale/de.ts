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

  auth: {
    signIn: "Anmelden",
    signOut: "Abmelden",
    signingIn: "Anmeldung läuft …",
    failed: "Die Anmeldung ist fehlgeschlagen. Bitte versuchen Sie es erneut.",
    intro:
      "Melden Sie sich an, um Ihre Fortbildungen zu sehen und Ihre CME-Punkte zu erhalten.",
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
