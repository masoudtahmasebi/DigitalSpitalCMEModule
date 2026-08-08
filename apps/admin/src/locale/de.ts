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

  learners: {
    title: "Teilnehmende",
    intro:
      "Fortschritt aller Teilnehmenden. Die EFN wird aus Datenschutzgründen nur verkürzt angezeigt.",
    empty: "Zu dieser Fortbildung liegen noch keine Teilnahmen vor.",
    name: "Name",
    efn: "EFN",
    course: "Fortbildung",
    watched: "Angesehen",
    quiz: "Bestes Ergebnis",
    submission: "Punktemeldung",
    certificate: "Bescheinigung",
    correctName: "Namen korrigieren",
    nameLocked: "Name gemeldet",
    nameLockedHint:
      "Die Punktemeldung wurde bereits übermittelt. Eine Korrektur muss innerhalb der Korrekturfrist schriftlich bei der Ärztekammer erfolgen.",
    erase: "Löschen",
    eraseConfirm: "Endgültig löschen",
    reason: "Grund der Löschung",
    reasonHint:
      "Für das Verarbeitungsverzeichnis, z. B. „Löschantrag vom 12.03.“. Keine Angaben zur Person.",
    stage: {
      none: "offen",
      pending: "in Warteschlange",
      submitted: "übermittelt",
      abandoned: "abgebrochen",
    },
    loadFailed: "Die Teilnahmen konnten nicht geladen werden.",
    saveFailed: "Die Änderung konnte nicht gespeichert werden.",
  },

  certificates: {
    title: "Bescheinigungen",
    intro:
      "Neu erstellen rendert das Dokument neu und meldet nichts an die Ärztekammer. Erneut senden verschickt dasselbe Dokument. Widerrufen zieht das Dokument zurück, die Teilnahme bleibt bestehen.",
    empty: "Es wurden noch keine Bescheinigungen erstellt.",
    participant: "Teilnehmende Person",
    status: "Status",
    issued: "Ausgestellt",
    delivered: "Versendet",
    regenerate: "Neu erstellen",
    resend: "Erneut senden",
    revoke: "Widerrufen",
    revokeConfirm: "Wirklich widerrufen",
    alreadyRevoked: "Widerrufen",
    notIssued: "Noch nicht ausgestellt",
    state: {
      pending: "in Erstellung",
      issued: "ausgestellt",
      delivered: "versendet",
      bounced: "Zustellung fehlgeschlagen",
      revoked: "widerrufen",
    },
    loadFailed: "Die Bescheinigungen konnten nicht geladen werden.",
    actionFailed: "Die Aktion konnte nicht ausgeführt werden.",
  },

  staff: {
    title: "Konten",
    intro: "Konten der Verwaltung. Sie sehen nur Konten, die Sie auch verwalten dürfen.",
    name: "Name",
    email: "E-Mail-Adresse",
    role: "Rolle",
    roleHint: "Bestimmt, was dieses Konto anlegen und ändern darf.",
    roleCourseEditor: "Nur Fortbildungen",
    roleDepartmentAdmin: "Abteilung",
    roleCustomerAdmin: "Kunde",
    roleSuperAdmin: "Super-Administration",
    role_: {
      course_editor: "Nur Fortbildungen",
      department_admin: "Abteilung",
      customer_admin: "Kunde",
      super_admin: "Super-Administration",
    },
    secondFactor: "Zwei-Faktor",
    enrolled: "eingerichtet",
    notEnrolled: "offen",
    lastLogin: "Letzte Anmeldung",
    customer: "Kunde",
    customerChoose: "Kunde auswählen …",
    customerHint:
      "Konten unterhalb der Super-Administration gehören immer zu genau einem Kunden.",
    invite: "Konto einladen",
    inviting: "Wird eingeladen …",
    inviteCreated: "Einladung erstellt",
    inviteHandOver:
      "Dieser Link wird nicht automatisch versendet. Bitte geben Sie ihn der eingeladenen Person weiter — er wird nur einmal angezeigt.",
    signOutEverywhere: "Überall abmelden",
    resetSecondFactor: "Zwei-Faktor zurücksetzen",
    resetSecondFactorConfirm: "Wirklich zurücksetzen",
    resetSecondFactorHint:
      "Für ein verlorenes Gerät. Das Konto muss sich beim nächsten Anmelden neu einrichten, wenn die Richtlinie es verlangt, und wird überall abgemeldet.",
    disable: "Deaktivieren",
    disableConfirm: "Wirklich deaktivieren",
    enable: "Aktivieren",
    loadFailed: "Die Konten konnten nicht geladen werden.",
    inviteFailed: "Die Einladung konnte nicht erstellt werden.",
    actionFailed: "Die Aktion konnte nicht ausgeführt werden.",
  },

  security: {
    title: "Sicherheit",
    intro:
      "Regeln für die Anmeldung an der Verwaltung. Sie sehen die Regeln, die für Sie gelten; ändern dürfen Sie nur die Ihres eigenen Bereichs.",
    secondFactor: "Zwei-Faktor-Authentifizierung",
    platformScope: "Plattform (Super-Administration)",
    platformHint:
      "Gilt für Konten, die zu keinem Kunden gehören. Nur die Super-Administration darf diese Regel ändern.",
    customerScope: "Kunde",
    policy_: {
      disabled: "Aus",
      optional: "Freigestellt",
      required: "Verpflichtend",
    },
    policyHint_: {
      disabled:
        "Wird nicht abgefragt — auch dann nicht, wenn ein Konto bereits einen zweiten Faktor eingerichtet hat. So kommt jemand mit verlorenem Gerät wieder herein.",
      optional:
        "Freiwillig. Wer einen zweiten Faktor eingerichtet hat, muss ihn weiterhin verwenden — sonst würde ein gestohlenes Passwort plötzlich genügen.",
      required:
        "Alle Konten dieses Bereichs richten einen zweiten Faktor ein und werden beim Anmelden dorthin geleitet, wenn sie es noch nicht getan haben.",
    },
    strictestWins:
      "Wer Rechte in mehreren Bereichen hat, unterliegt der strengsten Regel davon.",
    ownFactor: "Ihr eigener zweiter Faktor",
    ownFactorEnrolled: "Eingerichtet.",
    ownFactorNone: "Nicht eingerichtet.",
    removeOwn: "Eigenen zweiten Faktor entfernen",
    removeOwnConfirm: "Wirklich entfernen",
    removeOwnBlocked:
      "Für Ihr Konto ist der zweite Faktor verpflichtend und kann nicht entfernt werden.",
    saved: "Gespeichert.",
    loadFailed: "Die Sicherheitseinstellungen konnten nicht geladen werden.",
    saveFailed: "Die Einstellung konnte nicht gespeichert werden.",
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

  customerPicker: {
    label: "Kunde",
    choose: "Kunde auswählen …",
    /* A super administrator belongs to no customer, so until they pick one the
       tenant screens have nothing to act within. Saying so beats an empty list
       that looks like a customer with no content. */
    none: "Bitte wählen Sie oben einen Kunden aus, um diesen Bereich zu sehen.",
    noneYet: "Es ist noch kein Kunde angelegt. Legen Sie unter „Kunden“ den ersten an.",
  },

  nav: {
    security: "Sicherheit",
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

    embedOrigins: "Erlaubte Einbettungs-Domains",
    embedOriginsHint:
      "Die Websites des Kunden, auf denen die Fortbildung eingebettet werden darf — eine pro Zeile, z. B. https://www.beispiel.de. Ohne Pfad und ohne Schrägstrich am Ende.",
    identityProvider: "Anmeldeverfahren",
    identityProviderHint:
      "Wie sich die Teilnehmenden dieses Projekts anmelden. Lässt sich später ändern, betrifft dann aber alle bestehenden Zugänge.",
    identityProviderKeycloak: "Keycloak des Kunden (eingebettet, z. B. in WordPress)",
    identityProviderLocal: "Zugangsdaten dieser Plattform (eigenes Portal)",
    identityProviderLocalNote:
      "Bei diesem Verfahren werden die Keycloak-Angaben unten nicht verwendet.",

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

  /**
   * Uploads (P23-04).
   *
   * Deliberately says "auf unseren Server" rather than naming a bucket or a
   * provider: the author is choosing where a file goes, not learning our
   * infrastructure, and the answer that matters to them is "not to a link you
   * have to maintain".
   */
  uploads: {
    choose: "Datei hochladen",
    stored: "Hochgeladen",
    remove: "Hochgeladene Datei entfernen",
    progress: "Upload-Fortschritt",
    cancel: "Abbrechen",
    cancelled: "Der Upload wurde abgebrochen.",
    failed: "Der Upload ist fehlgeschlagen. Bitte versuchen Sie es erneut.",
    transportFailed:
      "Die Verbindung zum Dateispeicher ist abgebrochen. Die Datei wurde nicht vollständig übertragen — bitte laden Sie sie erneut hoch.",
    noCourseYet: "Bitte speichern Sie die Fortbildung zuerst.",
    videoUpload: "Video hochladen",
    videoUploadHint:
      "MP4 oder WebM, bis 2 GB. Die Datei wird direkt in den Dateispeicher übertragen und ist anschließend nur für Teilnehmende dieser Fortbildung abrufbar.",
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
      "Pflichtangabe für Videos. Der erforderliche Videoanteil ist ein Prozentsatz dieser Länge — ohne Länge gibt es nichts zu erreichen und der Inhalt wäre überspringbar. Die Gesamtdauer der Fortbildung wird aus den Längen aller Videos berechnet und nicht separat gepflegt.",
    durationDetect: "Aus Video ermitteln",
    durationDetecting: "Wird ermittelt …",
    durationDetected: (seconds: number): string =>
      `Länge übernommen: ${String(seconds)} Sekunden.`,
    durationDetectFailed:
      "Die Länge konnte nicht aus der Quelle gelesen werden. Das ist bei Speicher-Schlüsseln (s3://) und bei Servern ohne CORS-Freigabe normal — bitte die Länge in Sekunden eintragen.",
    captionsUrl: "Untertitel-Datei (WebVTT)",
    captionsHint:
      "URL einer .vtt-Datei mit deutschen Untertiteln. Untertitel sind Stufe A der Barrierefreiheitsrichtlinien (WCAG 1.2.2, EN 301 549): Ohne sie können hörbeeinträchtigte Ärztinnen und Ärzte die Fortbildung nicht absolvieren — und der Fortschritt wird sie als nicht angesehen erfassen.",
    captionsMissing:
      "Für dieses Video sind keine Untertitel hinterlegt. Bei Videos mit Sprache ist das ein Barrierefreiheitsmangel. Reine Folienaufzeichnungen ohne Ton benötigen keine.",
    body: "Text",
    /** On a download: the paragraph the Mediathek card shows (page-05). */
    materialBody: "Beschreibung (erscheint auf der Materialkarte)",
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
    // Presentation — what a physician sees (P13-01).
    presentation: "Inhalte & Darstellung",
    presentationIntro:
      "Diese Angaben erscheinen in der Fortbildungsübersicht und auf der Kursseite.",
    title: "Titel der Fortbildung",
    description: "Beschreibung",
    descriptionHint:
      "Erscheint auf der Kursseite unter „Beschreibung der Fortbildung“ und gekürzt auf der Übersichtskarte.",
    heroImageUrl: "Titelbild (URL)",
    heroImageHint: "Wird neben dem Titel und auf der Übersichtskarte angezeigt.",
    deliveryType: "Format",
    deliveryOnDemand: "On Demand",
    deliveryLive: "Live",
    deliveryPraesenz: "Präsenz",
    thema: "Thema",
    altersgruppe: "Altersgruppe",
    onePerLine: "Ein Eintrag pro Zeile.",
    onePerLineOrdered: "Ein Eintrag pro Zeile, in der gewünschten Reihenfolge.",
    learningObjectives: "Lernziele",
    targetAudience: "Zielgruppe",
    targetAudienceHint: "Zeilenumbrüche bleiben erhalten.",
    prerequisites: "Vorkenntnisse",
    prerequisitesHint:
      "Erscheint im Layout als eigener Absatz unter der Zielgruppe. Die Beschriftung setzt die Anwendung.",
    cmePoints: "CME-Punkte",
    cmePointsHint: "Laut Anerkennungsbescheid.",
    cmeCategory: "Kategorie",
    fortbildungsnummer: "Fortbildungsnummer",
    validFrom: "Anerkennung gültig ab",
    validTo: "Anerkennung gültig bis",
    validityHint: "Aus dem Anerkennungsbescheid der Ärztekammer.",

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

    vnr: "VNR (Veranstaltungsnummer)",
    vnrHint:
      "Die von der Ärztekammer vergebene Veranstaltungsnummer aus dem Anerkennungsbescheid. Ohne sie wird für diesen Kurs keine Punktemeldung an die EIV-FOBI übermittelt.",
    vnrMissing:
      "Ohne VNR werden Abschlüsse zwar erfasst und Bescheinigungen erstellt, es wird aber keine Punktemeldung übermittelt.",

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

  /** Participant accounts (P21-04) — people, not enrolments. */
  participantAccounts: {
    title: "Zugänge",
    intro:
      "Teilnehmende dieses Kunden. Hier werden Zugänge angelegt, Passwörter zurückgesetzt und Konten gesperrt.",
    search: "Suche",
    empty:
      "Noch keine Teilnehmenden. Legen Sie über „Zugang anlegen“ die erste Person an – sie kann sich danach sofort im Fortbildungsportal anmelden.",
    headers: ["Person", "Abgeschlossen / Belegt", "Status", ""] as const,
    create: "Zugang anlegen",
    firstName: "Vorname",
    lastName: "Nachname",
    email: "E-Mail-Adresse",
    password: "Passwort",
    nameWhy:
      "Vor- und Nachname sind erforderlich: die Teilnahmebescheinigung trägt den Namen und kann ohne ihn nicht ausgestellt werden.",
    reset: "Passwort zurücksetzen",
    disable: "Sperren",
    enable: "Entsperren",
    active: "Aktiv",
    disabled: "Gesperrt",
    locked: "Vorübergehend gesperrt",
    mustChange: "Passwort noch nicht geändert",
    federated: "Externe Anmeldung",
    issuedTitle: "Passwort – nur jetzt sichtbar",
    issuedBody:
      "Dieses Passwort wird nur einmal angezeigt und ist danach nicht mehr abrufbar. Geben Sie es der Person weiter; beim ersten Anmelden muss sie ein eigenes Passwort wählen. Ist es verloren, setzen Sie es einfach neu.",
    copy: "Kopieren",
    copied: "Kopiert",
    dismiss: "Schließen",

    /*
     * Merging two credentials onto one person (P21-05).
     *
     * The copy is deliberately heavy. The operation is irreversible, and the
     * screen is the last place anybody is going to read that before doing it.
     */
    merge: "Zugänge zusammenführen",
    mergeIntro:
      "Wenn eine Person zwei Zugänge hat — etwa einen über das Identitätssystem des Kunden und einen für das Fortbildungsportal — führt dies beide auf eine Person zusammen. Alle Einschreibungen, Zertifikate und die EFN wandern auf den Zielzugang; der Quellzugang wird gelöscht.",
    mergeIrreversible:
      "Diese Aktion kann nicht rückgängig gemacht werden. Prüfen Sie beide Seiten, bevor Sie bestätigen.",
    mergeSource: "Quellzugang (wird gelöscht)",
    mergeTarget: "Zielzugang (bleibt bestehen)",
    mergeCheck: "Prüfen",
    mergeHasEfn: "EFN hinterlegt",
    mergeNoEfn: "keine EFN",
    mergeCourses: "Einschreibungen",
    mergeNoCourses: "keine",
    mergeAllowed:
      "Die Zusammenführung ist möglich. Bestätigen Sie mit der ID des Zielzugangs.",
    mergeConfirmLabel: "Zur Bestätigung die ID des Zielzugangs eingeben",
    mergeConfirm: "Endgültig zusammenführen",
    mergeDone: "Die Zugänge wurden zusammengeführt.",
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
