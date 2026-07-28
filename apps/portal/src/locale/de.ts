/**
 * Every German string the portal shell renders (CLAUDE.md §5).
 *
 * Only the shell. Everything inside the course — the player, the quiz, the
 * Evaluationsbogen, the certificate panel — is rendered by `<ds-lms>` and takes
 * its copy from the widget's own locale file. Two files, because they are two
 * artifacts with two release cycles; a portal string and a widget string that
 * happened to be identical would still be two strings.
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
    catalogue: "Fortbildungen",
    back: "Zurück zur Übersicht",
  },

  catalogue: {
    title: "Fortbildungen",
    empty: "Zurzeit sind keine Fortbildungen verfügbar.",
    noMatches: "Keine Fortbildung entspricht dieser Auswahl.",
    resetFilters: "Filter zurücksetzen",

    filterThema: "Thema",
    filterAltersgruppe: "Altersgruppe",
    filterDelivery: "Format",
    filterAll: "Alle",

    delivery: {
      on_demand: "on-demand",
      live: "Live-Webinar",
      praesenz: "Präsenz",
    },

    start: "Zur Fortbildung",
    resume: "Fortbildung fortsetzen",
    completed: "Abgeschlossen",

    /** "4 CME Punkte" */
    points: (points: number, category: string | null): string =>
      category === null
        ? `${points} CME Punkte`
        : `${points} CME Punkte (Kategorie ${category})`,
    modules: (count: number): string => (count === 1 ? "1 Modul" : `${count} Module`),

    page: (page: number, total: number): string => `Seite ${page} von ${total}`,
    previous: "Vorherige Seite",
    next: "Nächste Seite",
  },

  loading: "Wird geladen …",

  error: {
    title: "Es ist ein Fehler aufgetreten",
    retry: "Erneut versuchen",
    generic: "Bitte versuchen Sie es später erneut.",
    misconfigured:
      "Das Portal ist nicht korrekt konfiguriert. Bitte wenden Sie sich an den Betreiber.",
    notFound: "Diese Fortbildung ist nicht verfügbar.",
  },
} as const;
