/**
 * Every German string the widget renders (CLAUDE.md §5).
 *
 * Nothing user-facing is written inline in a component. Two reasons beyond
 * tidiness: the layout copy is authoritative and has to be checked against it
 * term by term — _Zertifizierung_, _Mediathek_, _Referenten_,
 * _Lernerfolgskontrolle_, _Teilnahmebescheinigung_ are capitalised exactly as
 * the client uses them — and a second locale later is then a file, not a sweep
 * through JSX.
 *
 * Functions rather than templates where a number or name is substituted, so
 * German agreement ("1 Punkt" vs "4 Punkten", "1 Modul" vs "2 Module") is
 * decided here instead of at each call site.
 */

export const de = {
  tabs: {
    certification: "Zertifizierung",
    library: "Mediathek",
    speakers: "Referenten",
  },

  loading: "Wird geladen …",

  error: {
    title: "Es ist ein Fehler aufgetreten",
    retry: "Erneut versuchen",
    unauthenticated:
      "Ihre Sitzung ist abgelaufen. Bitte laden Sie die Seite neu und melden Sie sich erneut an.",
    generic: "Bitte versuchen Sie es später erneut.",
    noCourse: "Diese Fortbildung wurde nicht gefunden.",
    misconfigured:
      "Diese Fortbildung ist nicht korrekt eingebunden. Bitte wenden Sie sich an den Betreiber der Seite.",
  },

  overview: {
    resume: "Fortbildung fortsetzen",
    start: "Fortbildung starten",
    /** "Sie haben 2 von 5 Modulen abgeschlossen." */
    moduleProgress: (completed: number, total: number): string =>
      `Sie haben ${completed} von ${total} ${total === 1 ? "Modul" : "Modulen"} abgeschlossen.`,
    watchProgress: (achieved: number, required: number): string =>
      `${achieved} % der Videoinhalte angesehen (erforderlich: ${required} %).`,
    complete: "Fortbildung abgeschlossen",
  },

  gate: {
    locked: "Gesperrt",
    lockedHint: "Bitte schließen Sie den vorherigen Abschnitt ab.",
    available: "Verfügbar",
    completed: "Abgeschlossen",
  },

  content: {
    video: "Video",
    text: "Text",
    quiz: "Lernerfolgskontrolle",
    details: "Details",
    material: "Material",
    back: "Zurück zur Übersicht",
    next: "Weiter",
    watched: (percent: number): string => `${percent} % angesehen`,
    videoUnsupported:
      "Ihr Browser kann dieses Video nicht abspielen. Bitte verwenden Sie einen aktuellen Browser.",
  },

  quiz: {
    title: "Lernerfolgskontrolle",
    intro: (threshold: number): string =>
      `Zum Bestehen müssen mindestens ${threshold} % der Fragen richtig beantwortet werden.`,
    attemptsUsed: (used: number): string =>
      used === 1 ? "1 Versuch bisher" : `${used} Versuche bisher`,
    attemptsUnlimited: "Die Anzahl der Versuche ist nicht begrenzt.",
    singleHint: "Bitte wählen Sie eine Antwort.",
    multiHint: "Bitte wählen Sie alle zutreffenden Antworten.",
    submit: "Antworten absenden",
    submitting: "Wird ausgewertet …",
    unanswered: "Bitte beantworten Sie alle Fragen, bevor Sie absenden.",
    passed: (score: number): string => `Bestanden mit ${score} %.`,
    failed: (score: number, threshold: number): string =>
      `Nicht bestanden: ${score} % (erforderlich sind ${threshold} %).`,
    retry: "Erneut versuchen",
    /** A CME course never reveals the answer key — see docs/requirements §4. */
    noReveal:
      "Die richtigen Antworten werden aus Gründen der Zertifizierung nicht angezeigt.",
  },

  evaluation: {
    title: "Evaluation",
    intro:
      "Ihre Rückmeldung hilft uns, die Fortbildung zu verbessern. Pflichtfragen sind mit * gekennzeichnet.",
    submitted: "Vielen Dank, Ihre Evaluation wurde übermittelt.",
    submit: "Evaluation absenden",
    submitting: "Wird übermittelt …",
    required: "Pflichtfrage",
    missing: "Bitte beantworten Sie alle Pflichtfragen.",
    scaleLow: "trifft nicht zu",
    scaleHigh: "trifft voll zu",
    textPlaceholder: "Ihre Anmerkung (optional)",
  },

  completion: {
    title: "Abschluss und Punktemeldung",
    intro:
      "Zum Abschluss benötigen wir Ihre EFN und den Namen, der auf der Teilnahmebescheinigung erscheinen soll.",
    nameLabel: "Name auf der Teilnahmebescheinigung",
    nameHint:
      "Dieser Name erscheint auf Ihrer Teilnahmebescheinigung. Sie können ihn hier korrigieren.",
    namePlaceholder: "z. B. Dr. med. Anna Musterfrau",
    efnLabel: "EFN (Einheitliche Fortbildungsnummer)",
    efnHint: "15 Ziffern. Ihre EFN wird ausschließlich an die Ärztekammer übermittelt.",
    efnInvalid: "Die EFN muss aus genau 15 Ziffern bestehen.",
    efnSaved: "Ihre EFN ist hinterlegt.",
    saveEfn: "EFN speichern",
    submit: "Fortbildung abschließen",
    submitting: "Wird abgeschlossen …",
    done: "Ihre Fortbildung ist abgeschlossen. Die Punkte werden an die Ärztekammer gemeldet.",
    outstanding: "Es fehlt noch:",
    conditions: {
      watch: "die vollständige Videowiedergabe",
      quiz: "die Lernerfolgskontrolle",
      evaluation: "die Evaluation",
      efn: "Ihre EFN",
    },
  },

  certificate: {
    title: "Teilnahmebescheinigung",
    download: "Teilnahmebescheinigung herunterladen",
    downloading: "Wird erstellt …",
    notYet:
      "Die Teilnahmebescheinigung steht nach Abschluss der Fortbildung zur Verfügung.",
    vnr: "Veranstaltungsnummer (VNR)",
    date: "Datum",
    time: "Uhrzeit",
    location: "Ort",
    organizer: "Veranstalter",
    points: "Punkte",
    participant: "Teilnehmende Person",
  },

  library: {
    title: "Mediathek",
    empty: "Für diese Fortbildung stehen keine Materialien zur Verfügung.",
    lockedGroup: "Wird nach Abschluss dieses Moduls freigeschaltet.",
    download: "Herunterladen",
    /** Byte sizes are shown in German notation: "1,4 MB". */
    size: (bytes: number): string => {
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
      return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
    },
  },
} as const;

export type Locale = typeof de;
