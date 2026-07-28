/**
 * Every German string the admin console renders (CLAUDE.md §5).
 *
 * The console is explicitly functional rather than beautiful (P9 header), but
 * the copy still has to be precise: this is the screen where somebody changes
 * a number that decides whether a physician's CME points are valid, and the
 * form has to say what the number does rather than just name it.
 */

export const de = {
  appTitle: "DS Education — Verwaltung",

  auth: {
    signIn: "Anmelden",
    signOut: "Abmelden",
    signingIn: "Anmeldung läuft …",
    failed: "Die Anmeldung ist fehlgeschlagen. Bitte versuchen Sie es erneut.",
    required: "Bitte melden Sie sich an, um die Verwaltung zu öffnen.",
    expired: "Ihre Sitzung ist abgelaufen. Bitte melden Sie sich erneut an.",
    forbidden:
      "Ihr Konto hat keine Berechtigung für die Verwaltung. Bitte wenden Sie sich an Ihre Administration.",
  },

  nav: {
    courses: "Fortbildungen",
    participants: "Teilnehmende",
    back: "Zurück",
  },

  loading: "Wird geladen …",

  error: {
    title: "Es ist ein Fehler aufgetreten",
    retry: "Erneut versuchen",
    generic: "Bitte versuchen Sie es später erneut.",
    misconfigured:
      "Die Verwaltung ist nicht korrekt konfiguriert. Bitte prüfen Sie die Umgebungsvariablen.",
  },

  courses: {
    title: "Fortbildungen",
    empty: "Für diesen Mandanten sind keine Fortbildungen hinterlegt.",
    columnTitle: "Titel",
    columnVnr: "VNR",
    columnPoints: "Punkte",
    columnParticipants: "Teilnehmende",
    columnCertificate: "Bescheinigung",
    certificateReady: "bereit",
    certificateNotReady: "unvollständig",
    /** "3 von 12 abgeschlossen" */
    completedOf: (completed: number, total: number): string =>
      `${completed} von ${total} abgeschlossen`,
  },

  course: {
    settings: "Einstellungen",
    compliance: "Nachweisregeln",
    certificate: "Teilnahmebescheinigung",
    save: "Speichern",
    saving: "Wird gespeichert …",
    saved: "Änderungen gespeichert.",

    requiredWatchPercent: "Erforderlicher Videoanteil",
    requiredWatchHint:
      "Anteil der Videoinhalte, der angesehen sein muss. Gemessen wird die tatsächlich gesehene Zeit, nicht die weiteste Abspielposition — Vorspulen zählt nicht.",

    passThresholdPercent: "Bestehensgrenze der Lernerfolgskontrolle",
    passThresholdHint: "Anteil richtig beantworteter Fragen, der zum Bestehen nötig ist.",
    passThresholdAccredited: (min: number): string =>
      `Der Anerkennungsbescheid der Ärztekammer verlangt mindestens ${min} %. Ein niedrigerer Wert macht die vergebenen Punkte nicht anrechenbar.`,
    accreditationWarning: (min: number): string =>
      `Achtung: Ein Wert unter ${min} % widerspricht dem Anerkennungsbescheid. Punkte, die danach vergeben werden, sind nicht anrechenbar.`,
    accreditationConfirm:
      "Ich habe verstanden, dass dieser Wert dem Anerkennungsbescheid widerspricht.",

    notRetroactive:
      "Änderungen gelten nur für neue Teilnahmen. Bereits begonnene Teilnahmen behalten die Werte, die bei ihrem Start gültig waren.",

    organizer: "Veranstaltender",
    eventLocation: "Veranstaltungsort",
    accreditationBody: "Ärztekammer",
    scientificLeadTitle: "Titel der wissenschaftlichen Leitung",
    scientificLeadName: "Name der wissenschaftlichen Leitung",
    certificateIssuePlace: "Ausstellungsort",

    vnrPassword: "VNR-Passwort",
    vnrPasswordHint:
      "Wird verschlüsselt gespeichert und niemals wieder angezeigt. Leer lassen, um das gespeicherte Passwort beizubehalten.",
    vnrPasswordStored: "Ein Passwort ist hinterlegt.",
    vnrPasswordMissing: "Es ist kein Passwort hinterlegt.",

    stamp: "Stempel der wissenschaftlichen Leitung",
    signature: "Unterschrift der wissenschaftlichen Leitung",
    imageStored: "Hinterlegt",
    imageMissing: "Fehlt",
    imageHint:
      "PNG oder JPEG, höchstens 512 KB. Der Bescheid verlangt Stempel und Unterschrift der wissenschaftlichen Leitung auf jeder Bescheinigung.",
    uploadImages: "Bilder hochladen",
    uploading: "Wird hochgeladen …",

    missingForCertificate: "Für die Ausstellung der Teilnahmebescheinigung fehlen noch:",
    readyForCertificate: "Diese Fortbildung kann Teilnahmebescheinigungen ausstellen.",
  },

  participants: {
    title: "Teilnehmende",
    empty: "Für diese Fortbildung sind keine Teilnahmen erfasst.",
    export: "Als CSV exportieren",
    filterAll: "Alle",
    filterComplete: "Abgeschlossen",
    filterOpen: "Offen",
    filterAttention: "Meldung prüfen",

    columnName: "Person",
    columnEmail: "E-Mail",
    columnProgress: "Fortschritt",
    columnWatched: "Video",
    columnQuiz: "Lernerfolgskontrolle",
    columnEvaluation: "Evaluation",
    columnEfn: "EFN",
    columnComplete: "Abschluss",
    columnEiv: "Punktemeldung",
    columnCertificate: "Bescheinigung",

    yes: "ja",
    no: "nein",
    passed: "bestanden",
    notPassed: "offen",

    attentionBanner: (count: number): string =>
      count === 1
        ? "1 Punktemeldung benötigt Ihre Aufmerksamkeit."
        : `${count} Punktemeldungen benötigen Ihre Aufmerksamkeit.`,
    attentionHint:
      "Diese Meldungen konnten nach den automatischen Wiederholungen nicht übermittelt werden. Die Ärztekammer nimmt in begründeten Ausnahmefällen eine Meldung per Original-Anwesenheitsliste entgegen — die Frist beträgt 8 Tage ab Teilnahme.",

    eiv: {
      none: "keine",
      queued: "in Warteschlange",
      submitted: "gemeldet",
      failed: "fehlgeschlagen",
      needs_attention: "prüfen",
      abandoned: "abgebrochen",
    },

    certificate: {
      none: "keine",
      pending: "ausstehend",
      issued: "ausgestellt",
      delivered: "zugestellt",
      bounced: "unzustellbar",
    },
  },
} as const;
