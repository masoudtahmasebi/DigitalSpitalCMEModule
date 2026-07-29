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

  error: {
    title: "Es ist ein Fehler aufgetreten",
    misconfigured:
      "Das Portal ist nicht korrekt konfiguriert. Bitte wenden Sie sich an den Betreiber.",
  },
} as const;
