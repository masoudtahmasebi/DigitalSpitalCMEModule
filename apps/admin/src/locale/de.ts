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

    // Staff sign-in (P12-06). The console has its own accounts, independent of
    // any customer's Keycloak — see ADR-0012.
    email: "E-Mail-Adresse",
    password: "Passwort",
    invalid: "E-Mail-Adresse oder Passwort ist nicht korrekt.",
    codeLabel: "Sechsstelliger Code",
    codePrompt: "Bitte geben Sie den Code aus Ihrer Authenticator-App ein.",
    codeSubmit: "Bestätigen",
    codeInvalid: "Der Code ist nicht korrekt oder nicht mehr gültig.",
    enrolTitle: "Zwei-Faktor-Authentifizierung einrichten",
    enrolPrompt:
      "Scannen Sie diesen Code mit Ihrer Authenticator-App und geben Sie anschließend den angezeigten sechsstelligen Code ein.",
    enrolManual:
      "Falls Sie nicht scannen können, geben Sie diesen Schlüssel manuell ein:",
    enrolFailed:
      "Die Einrichtung konnte nicht gestartet werden. Bitte melden Sie sich erneut an.",
  },

  customers: {
    title: "Kunden",
    intro: "Alle Kunden der Plattform. Nur Super-Administratoren sehen diese Übersicht.",
    name: "Name",
    slug: "Kürzel",
    departments: "Abteilungen",
    projects: "Projekte",
    courses: "Fortbildungen",
    created: "Angelegt",
    create: "Kunde anlegen",
    creating: "Wird angelegt …",
    rename: "Umbenennen",
    remove: "Löschen",
    removeConfirm: "Diesen Kunden endgültig löschen?",
    empty: "Es sind noch keine Kunden angelegt.",
    slugHint:
      "Kleinbuchstaben, Ziffern und Bindestriche. Kann später nicht geändert werden.",
    contains: "Enthält noch",
    loadFailed: "Die Kundenliste konnte nicht geladen werden.",
    saveFailed: "Der Kunde konnte nicht gespeichert werden.",
  },

  nav: {
    courses: "Fortbildungen",
    participants: "Teilnehmende",
    branding: "Erscheinungsbild",
    organisation: "Organisation",
    back: "Zurück",
  },

  common: {
    add: "Hinzufügen",
    save: "Speichern",
    saving: "Wird gespeichert …",
    saved: "Gespeichert.",
    cancel: "Abbrechen",
    edit: "Bearbeiten",
    delete: "Löschen",
    confirmDelete: "Wirklich löschen",
    moveUp: "Nach oben verschieben",
    moveDown: "Nach unten verschieben",
    name: "Name",
    slug: "Kürzel",
    title: "Titel",
    optional: "optional",
    slugHint:
      "Kleinbuchstaben, Ziffern und Bindestriche. Das Kürzel erscheint in Adressen und lässt sich später nicht ändern.",
    unsaved: "Es gibt ungespeicherte Änderungen.",
  },

  organisation: {
    title: "Organisation",
    intro:
      "Abteilungen und Projekte gliedern die Fortbildungen dieses Mandanten. Ein Projekt ist eine Oberfläche — die WordPress-Seite eines Kunden oder das eigene Portal — und entscheidet, gegen welchen Keycloak-Realm Anmeldungen geprüft werden.",

    departments: "Abteilungen",
    departmentsEmpty: "Es sind noch keine Abteilungen angelegt.",
    newDepartment: "Neue Abteilung",
    columnProjects: "Projekte",

    projects: "Projekte",
    projectsEmpty: "Es sind noch keine Projekte angelegt.",
    newProject: "Neues Projekt",
    columnDepartment: "Abteilung",
    columnCourses: "Fortbildungen",
    columnRealm: "Keycloak-Realm",

    keycloak: "Anmeldung (Keycloak)",
    keycloakWarning:
      "Diese Werte entscheiden, gegen welchen Realm jedes Zugangstoken dieses Projekts geprüft wird. Ein falscher Wert sperrt alle Teilnehmenden dieses Projekts aus.",
    issuer: "Issuer",
    issuerHint: "Zum Beispiel https://auth.example.de/realms/medice",
    audience: "Audience",
    realm: "Realm",

    smtp: "E-Mail-Versand (SMTP)",
    smtpIntro:
      "Wird für den Versand der Teilnahmebescheinigungen verwendet. Ohne Angaben versendet die Plattform keine E-Mails für dieses Projekt.",
    smtpHost: "Server",
    smtpPort: "Port",
    smtpUsername: "Benutzername",
    smtpPassword: "Passwort",
    smtpPasswordHint:
      "Wird verschlüsselt gespeichert und niemals wieder angezeigt. Leer lassen, um das gespeicherte Passwort beizubehalten.",
    smtpPasswordStored: "Ein Passwort ist hinterlegt.",
    smtpPasswordMissing: "Es ist kein Passwort hinterlegt.",
    smtpFromAddress: "Absenderadresse",
    smtpFromName: "Absendername",
  },

  newCourse: {
    action: "Neue Fortbildung",
    title: "Neue Fortbildung anlegen",
    intro:
      "Nur das Nötigste. VNR, Punkte, Veranstaltender und wissenschaftliche Leitung werden danach in den Einstellungen ergänzt — dort prüft die Plattform auch, was für die Teilnahmebescheinigung noch fehlt.",
    project: "Projekt",
    description: "Beschreibung",
    deliveryType: "Format",
    delivery: {
      on_demand: "on-demand",
      live: "Live-Webinar",
      praesenz: "Präsenz",
    },
    create: "Fortbildung anlegen",
    noProjects:
      "Bevor eine Fortbildung angelegt werden kann, muss es mindestens ein Projekt geben.",
  },

  structure: {
    title: "Inhalte",
    intro:
      "Reihenfolge bestimmt die Freischaltung: ein Kapitel wird erst erreichbar, wenn das vorhergehende abgeschlossen ist. Änderungen an der Reihenfolge wirken sich deshalb auf laufende Teilnahmen aus.",
    empty: "Diese Fortbildung hat noch keine Module.",

    module: "Modul",
    newModule: "Modul hinzufügen",
    moduleSubtitle: "Untertitel",

    chapter: "Kapitel",
    newChapter: "Kapitel hinzufügen",
    chapterBody: "Einleitungstext",
    noChapters: "Noch keine Kapitel.",
    moveToModule: "In anderes Modul verschieben",

    content: "Inhalt",
    newContent: "Inhalt hinzufügen",
    noContents: "Noch keine Inhalte.",
    kind: "Art",
    kinds: {
      video: "Video",
      text: "Text",
      quiz: "Lernerfolgskontrolle",
      details: "Detailinformation",
      material: "Mediathek-Datei",
    },
    sources: "Videoquellen",
    sourcesHint:
      "Mehrere Fassungen derselben Aufzeichnung. Der Browser nimmt die erste, die er abspielen kann — adaptive Streams (HLS) stehen deshalb vorn.",
    sourceUrl: "URL",
    sourceType: "Format",
    sourceLabel: "Bezeichnung",
    sourceLabelHint: "Erscheint in der Qualitätsauswahl, z. B. „720p“.",
    addSource: "Videoquelle hinzufügen",
    removeSource: (url: string): string => `Videoquelle „${url}“ entfernen`,
    sourcesMissing:
      "Ein Video braucht mindestens eine Quelle — ohne sie kann die Fortbildung nicht angesehen werden.",
    posterUrl: "Vorschaubild",
    posterHint:
      "Standbild vor dem Start. Ohne Vorschaubild zeigt der Player bis zum ersten Bild eine schwarze Fläche.",
    durationSec: "Länge in Sekunden",
    durationHint:
      "Pflichtangabe für Videos. Der erforderliche Videoanteil ist ein Prozentsatz dieser Länge — ohne Länge gibt es nichts zu erreichen und der Inhalt wäre überspringbar.",
    captionsUrl: "Untertitel-Datei (WebVTT)",
    captionsHint:
      "URL einer .vtt-Datei mit deutschen Untertiteln. Untertitel sind Stufe A der Barrierefreiheitsrichtlinien (WCAG 1.2.2, EN 301 549): Ohne sie können hörbeeinträchtigte Ärztinnen und Ärzte die Fortbildung nicht absolvieren — und der Fortschritt wird sie als nicht angesehen erfassen.",
    captionsMissing:
      "Für dieses Video sind keine Untertitel hinterlegt. Bei Videos mit Sprache ist das ein Barrierefreiheitsmangel. Reine Folienaufzeichnungen ohne Ton benötigen keine.",
    body: "Text",
    fileUrl: "Datei-URL",
    mimeType: "Dateityp",

    /** "3 Teilnahmen erfasst" — why a delete is refused. */
    learnerRecords: (count: number): string =>
      count === 1 ? "1 Teilnahme erfasst" : `${count} Teilnahmen erfasst`,
    lockedByRecords:
      "Kann nicht gelöscht werden: es sind bereits Teilnahmen erfasst. Diese Daten sind der Nachweis für bereits vergebene Punkte.",
    questionCount: (count: number): string =>
      count === 1 ? "1 Frage" : `${count} Fragen`,
    noQuestions: "Keine Fragen — diese Lernerfolgskontrolle kann niemand bestehen.",
    editQuiz: "Fragen bearbeiten",

    reordering: "Reihenfolge wird gespeichert …",
    reorderFailed:
      "Die Reihenfolge konnte nicht gespeichert werden. Es wurde nichts geändert.",
  },

  experts: {
    title: "Referenten",
    intro:
      "Erscheinen im Reiter „Referenten“ der Lernoberfläche. Die Liste wird vollständig ersetzt.",
    empty: "Es sind keine Referenten hinterlegt.",
    add: "Referent hinzufügen",
    roleLabel: "Rolle",
    roleLabelHint: "Zum Beispiel „Wissenschaftliche Leitung“ oder „Referent“.",
    name: "Name",
    institution: "Institution",
    biography: "Kurzvita",
    photoUrl: "Foto-URL",
  },

  quiz: {
    title: "Lernerfolgskontrolle",
    intro:
      "Die Reihenfolge der Fragen ist die Reihenfolge in der Prüfung. Bewertet wird auf exakte Übereinstimmung: bei „eine richtige Antwort“ muss genau die richtige Option gewählt sein, bei „mehrere richtige Antworten“ genau die Menge der richtigen.",
    empty: "Noch keine Fragen.",
    addQuestion: "Frage hinzufügen",
    prompt: "Frage",
    kind: "Antworttyp",
    kinds: {
      single: "eine richtige Antwort",
      multi: "mehrere richtige Antworten",
    },
    option: "Antwortoption",
    addOption: "Antwortoption hinzufügen",
    isCorrect: "richtig",
    answered: (count: number): string =>
      count === 1 ? "1 Antwort erfasst" : `${count} Antworten erfasst`,
    lockedByAnswers:
      "Kann nicht gelöscht werden: diese Frage wurde bereits beantwortet. Ein abgegebener Versuch muss weiter das bedeuten, was er bei der Bewertung bedeutet hat.",

    noCorrect: "Mindestens eine Antwortoption muss als richtig markiert sein.",
    tooManyCorrect:
      "Bei „eine richtige Antwort“ darf genau eine Option als richtig markiert sein.",
    tooFewOptions: "Mindestens zwei Antwortoptionen.",
    emptyPrompt: "Die Frage darf nicht leer sein.",
    emptyOption: "Antwortoptionen dürfen nicht leer sein.",
    fixBeforeSaving: "Bitte korrigieren Sie die markierten Fragen, bevor Sie speichern.",
  },

  evaluation: {
    title: "Evaluationsbogen",
    intro:
      "Der Anerkennungsbescheid verlangt eine Evaluation. Ohne Fragen kann die Fortbildung nicht abgeschlossen werden.",
    empty: "Noch keine Fragen.",
    addQuestion: "Frage hinzufügen",
    prompt: "Frage",
    kind: "Art",
    kinds: {
      scale: "Skala 1–5",
      text: "Freitext",
      single: "Auswahl",
    },
    required: "Pflichtfrage",
    options: "Auswahlmöglichkeiten",
    addOption: "Auswahlmöglichkeit hinzufügen",
    optionsHint:
      "Nur für „Auswahl“. Eine Auswahlfrage ohne Möglichkeiten kann niemand beantworten.",
    answered: (count: number): string =>
      count === 1 ? "1 Antwort erfasst" : `${count} Antworten erfasst`,
    lockedByAnswers: "Kann nicht gelöscht werden: diese Frage wurde bereits beantwortet.",
    freeTextPrivacy:
      "Freitextantworten können personenbezogene Angaben enthalten. Sie werden ausschließlich aggregiert ausgewertet und erscheinen in keinem Protokoll.",
  },

  branding: {
    title: "Schriftart",
    intro:
      "Die hochgeladene Schriftart wird in der Lernoberfläche verwendet. Ohne eigene Schriftart wird die Standardschrift angezeigt.",
    privacy:
      "Die Datei wird auf unseren eigenen Servern gespeichert und von dort ausgeliefert. Es werden keine Schriften von Drittanbietern geladen, sodass keine IP-Adressen Ihrer Nutzerinnen und Nutzer an Dritte übermittelt werden.",

    familyName: "Name der Schriftfamilie",
    familyNameHint:
      "Frei wählbar, zum Beispiel „Medice Sans“. Erlaubt sind Buchstaben, Ziffern, Leerzeichen, Bindestrich und Unterstrich.",
    familyNameInvalid:
      "Nur Buchstaben, Ziffern, Leerzeichen, Bindestrich und Unterstrich, höchstens 64 Zeichen.",

    file: "Schriftdatei",
    fileHint:
      "WOFF2 oder WOFF, höchstens 2 MB. Andere Formate werden abgelehnt. Bitte laden Sie nur Schriften hoch, für die Sie die Lizenz zur Web-Einbindung besitzen.",
    tooLarge: "Die Schriftdatei ist zu groß (maximal 2 MB).",

    stored: "Hinterlegt",
    none: "Keine eigene Schriftart",
    saved: "Die Schriftart wurde gespeichert.",

    remove: "Schriftart entfernen",
    removeHint:
      "Danach wird wieder die Standardschrift verwendet. Bereits ausgelieferte Bescheinigungen bleiben unverändert.",
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
