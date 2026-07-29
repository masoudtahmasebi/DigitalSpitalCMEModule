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
    removeFilter: (value: string): string => `Filter „${value}“ entfernen`,

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
    title: "Ihr Fortschritt",
    resume: "Fortbildung fortsetzen",
    start: "Fortbildung starten",
    /** The ring's centre reads "2 von 5" — modules, not a percentage. */
    ringValue: (completed: number, total: number): string => `${completed} von ${total}`,
    /** "Sie haben 2 von 5 Modulen abgeschlossen." */
    moduleProgress: (completed: number, total: number): string =>
      `Sie haben ${completed} von ${total} ${total === 1 ? "Modul" : "Modulen"} abgeschlossen.`,
    watchProgress: (achieved: number, required: number): string =>
      `${achieved} % der Videoinhalte angesehen (erforderlich: ${required} %).`,
    complete: "Fortbildung abgeschlossen",
  },

  /**
   * The player (layout §4.3).
   *
   * One deliberate deviation from the layout's wording, recorded in
   * `docs/show-stoppers.md` as S16: the screen shows a bare `63% absolviert`
   * whose referent is not stated, and the requirements record notes that it
   * matches neither the video position nor anything else derivable from the
   * screenshot. Rather than guess which quantity the learner is being told
   * about, `courseProgress` names it. The layout's own word is kept.
   */
  player: {
    /** "Modul 3 von 5" */
    moduleOf: (current: number, total: number): string => `Modul ${current} von ${total}`,
    /** "14:35 / 25:45" */
    position: (position: string, duration: string): string => `${position} / ${duration}`,
    positionLabel: "Wiedergabeposition",
    courseProgress: (percent: number): string =>
      `${percent} % der Fortbildung absolviert`,
    autosave: "Ihr Fortschritt wird automatisch gespeichert",
    pause: "Fortbildung pausieren",
    back: "Zurück zur Übersicht",

    outline: "Modul Übersicht",
    toggleModule: (title: string): string => `Modul „${title}“ ein- oder ausklappen`,

    /**
     * The accessible name of each sidebar state glyph. Not decorative: in the
     * sidebar the icon is the only thing separating a finished chapter from a
     * locked one, so it has to be readable.
     */
    state: {
      completed: "Abgeschlossen",
      playing: "Wird angesehen",
      paused: "Pausiert",
      available: "Verfügbar",
      locked: "Gesperrt",
    },

    tabsLabel: "Inhalte zu diesem Abschnitt",
    tabs: {
      summary: "Zusammenfassung",
      quiz: "Lernerfolgskontrolle",
      reporting: "CME Punktemeldung",
    },
    /** Appended to a locked tab's accessible name, so the padlock is not the only cue. */
    tabLocked: "gesperrt",

    noSummary: "Für diesen Abschnitt ist keine Zusammenfassung hinterlegt.",
    quizLocked: "Wird nach Abschluss der Module freigeschaltet.",
    quizOpen: "Zur Lernerfolgskontrolle",
    reportingLocked: "Wird nach bestandener Lernerfolgskontrolle freigeschaltet.",
    reportingOpen: "Zur CME Punktemeldung",
  },

  gate: {
    locked: "Gesperrt",
    lockedHint: "Bitte schließen Sie den vorherigen Abschnitt ab.",
    available: "Verfügbar",
    completed: "Abgeschlossen",
  },

  /**
   * The player's controls (P5-12).
   *
   * Every control has a text label even where the button shows only an icon:
   * the icon is `aria-hidden` and this is its accessible name, so the player is
   * operable by a physician using a screen reader. That is a floor here rather
   * than a nicety — the alternative is a CME course they cannot complete.
   */
  media: {
    play: "Abspielen",
    pause: "Pause",
    replay: "Erneut abspielen",
    mute: "Ton aus",
    unmute: "Ton ein",
    volume: "Lautstärke",
    seek: "Wiedergabeposition",
    /** Announced for the slider's value: "14:35 von 25:45". */
    seekValue: (position: string, duration: string): string =>
      `${position} von ${duration}`,
    remaining: (clock: string): string => `noch ${clock}`,
    /** The union the server has credited — not the furthest position reached. */
    covered: (percent: number): string => `${percent} % angesehen`,
    speed: "Geschwindigkeit",
    speedValue: (rate: number): string =>
      rate === 1 ? "Normal" : `${String(rate).replace(".", ",")}×`,
    quality: "Qualität",
    qualityAuto: "Automatisch",
    captionsOn: "Untertitel einblenden",
    captionsOff: "Untertitel ausblenden",
    pictureInPicture: "Bild-in-Bild",
    fullscreen: "Vollbild",
    exitFullscreen: "Vollbild beenden",
    buffering: "Wird geladen …",

    /** Named per failure: "it did not play" is not something a learner can act on. */
    error: {
      unsupported:
        "Dieses Video kann in Ihrem Browser nicht abgespielt werden. Bitte verwenden Sie einen aktuellen Browser.",
      network:
        "Das Video konnte nicht geladen werden. Bitte prüfen Sie Ihre Verbindung und versuchen Sie es erneut.",
      decode:
        "Die Videodatei ist beschädigt oder wird nicht unterstützt. Bitte wenden Sie sich an den Betreiber.",
      aborted: "Die Wiedergabe wurde abgebrochen.",
      missing: "Für diesen Abschnitt ist kein Video hinterlegt.",
      retry: "Erneut laden",
    },

    /** Listed in a details element under the player, so the shortcuts are discoverable. */
    shortcuts: "Tastaturkürzel",
    shortcutList: [
      ["Leertaste / K", "Abspielen oder pausieren"],
      ["← / →", "5 Sekunden zurück oder vor"],
      ["J / L", "10 Sekunden zurück oder vor"],
      ["↑ / ↓", "Lautstärke"],
      ["M", "Ton aus oder ein"],
      ["C", "Untertitel"],
      ["F", "Vollbild"],
      ["0 – 9", "Zu 0 % … 90 % springen"],
    ] as ReadonlyArray<readonly [string, string]>,
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
    /** The <track> label a player shows in its captions menu. */
    captions: "Untertitel (Deutsch)",
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
    /** The layout's exact wording for a padlocked group (§4.2). */
    lockedGroup: "Wird nach Abschluss der Module freigeschaltet",
    /** The padlock is decorative; this is what a screen reader hears instead. */
    lockedGroupLabel: (moduleTitle: string): string =>
      `Materialien zu „${moduleTitle}“ sind gesperrt`,
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
