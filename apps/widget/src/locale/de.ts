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

import { germanDuration, germanMinutesAndSeconds } from "@ds/domain";

export const de = {
  tabs: {
    overview: "Übersicht",
    speakers: "Experten/Referenten",
    certification: "Zertifizierung",
    library: "Mediathek",
  },

  catalog: {
    title: "Fortbildungsbereich",
    empty: "Für die gewählten Filter stehen derzeit keine Fortbildungen zur Verfügung.",
    open: "Zur Fortbildung",
    /** Already finished — the course stays open for the certificate and the Mediathek. */
    review: "Fortbildung ansehen",
    back: "Zurück zur Übersicht",

    deliveryType: {
      on_demand: "On Demand",
      live: "Live",
      praesenz: "Präsenz",
    },

    thema: "Thema",
    altersgruppe: "Altersgruppe",
    all: "Alle",
    activeFilters: "Aktive Filter",
    removeFilter: (value: string): string => `Filter „${value}" entfernen`,

    pagination: "Seitennavigation",
    previous: "Zurück",
    next: "Vor",
    goToPage: (page: number): string => `Seite ${page}`,

    /**
     * "5 CME Punkte | 5 Module | 2 Stunden 30 Minuten" — the card metadata
     * line from the layout. Parts with no value are dropped rather than shown
     * as a zero: a course with no accredited points is not a "0 CME Punkte"
     * course, it is one whose accreditation is not recorded yet.
     */
    cardMeta: (course: {
      cmePoints: number | null;
      moduleCount: number;
      totalDurationSec: number;
    }): string =>
      [
        course.cmePoints === null ? undefined : `${course.cmePoints} CME Punkte`,
        `${course.moduleCount} ${course.moduleCount === 1 ? "Modul" : "Module"}`,
        course.totalDurationSec === 0 ? undefined : duration(course.totalDurationSec),
      ]
        .filter((part): part is string => part !== undefined)
        .join(" | "),
  },

  overviewTab: {
    description: "Beschreibung der Fortbildung",
    objectives: "Lernziele",
    audience: "Zielgruppe",
    contents: "Inhalte",
    more: "Mehr lesen …",
    less: "Weniger anzeigen",
    moduleLabel: (ordinal: number): string => `Modul ${ordinal}`,
    /** "25:24 Min. · 3 Kapitel" */
    moduleMeta: (durationSec: number, chapters: number): string =>
      [
        durationSec === 0 ? undefined : minutesAndSeconds(durationSec),
        `${chapters} ${chapters === 1 ? "Kapitel" : "Kapitel"}`,
      ]
        .filter((part): part is string => part !== undefined)
        .join(" · "),
  },

  experts: {
    empty: "Für diese Fortbildung sind keine Referentinnen und Referenten hinterlegt.",
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

/**
 * Both duration forms come from `@ds/domain`.
 *
 * They were local functions here until the standalone portal needed the same
 * card metadata line. Two copies would be two sets of pluralisation rules to
 * keep in step, and this file is not the only German the platform renders.
 */
const duration = germanDuration;
const minutesAndSeconds = germanMinutesAndSeconds;
