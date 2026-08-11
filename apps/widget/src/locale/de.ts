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
    /**
     * The catalogue heading, when the project has not set one.
     *
     * The layout says "Fortbildungsbereich für ADHS", and that is MEDICE's
     * heading, not the platform's — a second customer in a different
     * therapeutic area would have been reading it over their own courses. It
     * moved to `Branding.catalogTitle`, and what is left here is the generic
     * fallback, in the same spirit as `intro` below.
     */
    title: "Fortbildungsbereich",
    /** The hero eyebrow, set above the title in the layout. */
    eyebrow: "Weiterbildung für Ärzte",
    /**
     * The hero paragraph. Deliberately generic: this widget is multi-tenant and
     * a customer's own wording belongs in their branding, not compiled into the
     * bundle. It says what the area is, not what the therapeutic area is.
     */
    intro: "Hier finden Sie Fortbildungsangebote, im besten Fall mit CME-Zertifizierung.",
    /** The seal in the hero corner. */
    sealTop: "Zertifizierte",
    sealMain: "CME",
    sealBottom: "Fortbildung",
    filterHeading: "Fortbildungen filtern",
    selectThema: "Thema auswählen",
    selectAltersgruppe: "Altersgruppe auswählen",
    empty: "Für die gewählten Filter stehen derzeit keine Fortbildungen zur Verfügung.",
    open: "Zur Fortbildung",
    /** Already finished — the course stays open for the certificate and the Mediathek. */
    review: "Fortbildung ansehen",
    /**
     * The card's one-line state for a course that is finished but not yet
     * certified (P52-05).
     *
     * Short, because it shares a card with a title, a description and two
     * buttons — and it only has to do one thing: give a reason to open a
     * course the learner has already been through. The detail screen says what
     * is missing.
     */
    certificationOpen: "Abgeschlossen – Zertifizierung noch offen",
    back: "Zurück zur Übersicht",

    /**
     * The catalogue's tab labels.
     *
     * Two, matching the layout, and they name **functions** rather than
     * delivery types — the client's note on this screen is that the second tab
     * is where live events (via Zoom) and whatever follows them will live. So
     * `Weitere` covers every delivery type that is not on-demand rather than
     * being a `Live` tab and a `Präsenz` tab that both stand empty.
     *
     * `deliveryType` below is still the per-value label, used by the admin
     * console's course form, where the underlying value genuinely is what is
     * being chosen.
     */
    sections: {
      onDemand: "On Demand",
      weitere: "Weitere",
    },

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
    objectivesLead: "Diese Fortbildung vermittelt Ihnen:",
    audience: "Zielgruppe",
    contents: "Inhalte",
    more: "Mehr lesen …",
    less: "Weniger anzeigen",
    moduleLabel: (ordinal: number): string => `Modul ${ordinal}`,
    /**
     * "25:24 Min.", and nothing after it.
     *
     * It was "25:24 Min. · 3 Kapitel". The layout's Inhalte row carries the
     * duration alone, and the chapter count was worse than merely extra: the
     * MEDICE course has one chapter per module, so it printed "· 1 Kapitel" on
     * every row — three repetitions of a number a learner cannot use.
     *
     * Empty when the module has no timed content, so a row does not end in a
     * bare "Min.".
     */
    moduleDuration: (durationSec: number): string =>
      durationSec === 0 ? "" : minutesAndSeconds(durationSec),
  },

  experts: {
    heading: "Die Experten/Expertinnen aus dieser Fortbildung",
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

  /** The meta strip under the course hero. */
  duration: (seconds: number): string => duration(seconds),

  overview: {
    title: "Ihr Fortschritt",
    resume: "Fortbildung fortsetzen",
    start: "Fortbildung starten",
    /** The word beside the orange points chip in the meta bar. */
    cmePoints: "CME Punkte",
    moduleCount: (count: number): string =>
      `${count} ${count === 1 ? "Modul" : "Module"}`,
    /** The ring's centre reads "2 von 5" — modules, not a percentage. */
    ringValue: (completed: number, total: number): string => `${completed} von ${total}`,
    /** "Sie haben 2 von 5 Modulen abgeschlossen." */
    moduleProgress: (completed: number, total: number): string =>
      `Sie haben ${completed} von ${total} ${total === 1 ? "Modul" : "Modulen"} abgeschlossen.`,
    watchProgress: (achieved: number, required: number): string =>
      `${achieved} % der Videoinhalte angesehen (erforderlich: ${required} %).`,
    complete: "Fortbildung abgeschlossen",
    /**
     * Shown when the course is done but the point is not yet claimed (P51-01).
     *
     * The physician has finished — the banner above says so — and this line
     * exists only to answer the question that immediately follows it: *and
     * now?* Naming the tab is the whole point; "Ihre Zertifizierung ist noch
     * offen" on its own is the correct-and-useless answer CLAUDE.md §9.4 is
     * about. There is no deadline in this sentence because there is none: they
     * may come back whenever they like.
     */
    certificationOpen:
      "Für Ihre CME-Punkte fehlen noch Angaben. Sie finden sie unter „Zertifizierung“ und können sie jederzeit nachtragen.",
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
    /**
     * What replaces **Fortbildung pausieren** once the server opens the quiz
     * gate (layout row 6.6). Teal rather than orange: the accent marks the
     * action that belongs to the course in progress, and once the watching is
     * done the exam is the way forward rather than a pause.
     */
    quizBegin: "Lernerfolgskontrolle beginnen",
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
    /**
     * Why the scrub bar will not go further.
     *
     * Stated rather than implied: a control that silently refuses reads as
     * broken, and the learner's next move is to reload the page or write to
     * support. Named as an accreditation condition, because it is one — the
     * points require the material to have been seen.
     */
    seekLocked:
      "Vorspulen ist nicht möglich. Für die Fortbildungspunkte muss das Video vollständig angesehen werden.",
    /** The slider's value when the range is capped: "14:35 von 25:45, freigegeben bis 12:30". */
    seekValueLimited: (position: string, duration: string, limit: string): string =>
      `${position} von ${duration}, freigegeben bis ${limit}`,
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
      ["← / →", "5 Sekunden zurück oder vor (vor nur bis zum Gesehenen)"],
      ["J / L", "10 Sekunden zurück oder vor (vor nur bis zum Gesehenen)"],
      ["↑ / ↓", "Lautstärke"],
      ["M", "Ton aus oder ein"],
      ["C", "Untertitel"],
      ["F", "Vollbild"],
      ["0 – 9", "Zu 0 % … 90 % springen (nur bis zum Gesehenen)"],
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

  /**
   * The Zertifizierung tab — layout page 04, read off the render.
   *
   * Informational throughout. The tab used to carry the module outline, the EFN
   * field and **Fortbildung abschließen**; the layout puts none of that here and
   * #60 moved it to where the layout does put it (the quiz-passed screen, then
   * page 13).
   *
   * Every number is the course's own. A sentence that said "80 %" in prose while
   * the course was configured at 70 would be a platform telling a physician the
   * wrong accreditation condition, so the thresholds are arguments.
   */
  certification: {
    title: "Zertifizierung",

    points: "CME-Punkte",
    pointsSentence: (points: number): string =>
      points === 1
        ? "Für die erfolgreiche Teilnahme an dieser Fortbildung erhalten Sie 1 CME-Punkt."
        : `Für die erfolgreiche Teilnahme an dieser Fortbildung erhalten Sie ${points} CME-Punkte.`,
    /**
     * A course without accreditation is a supported case, not a broken one —
     * the client asked for it and `ds-ohne-punkte` exists to exercise it. The
     * tab says so plainly rather than drawing a Zertifizierung panel with every
     * value blank.
     */
    noPoints:
      "Diese Fortbildung ist nicht zertifiziert und vergibt keine CME-Punkte. Eine Punktemeldung an die Ärztekammer erfolgt nicht.",

    accreditation: "Akkreditierung",
    accreditedBy: (body: string, points: number): string =>
      `Diese Fortbildung ist von der ${body} zertifiziert und wurde mit ${String(points)} CME-${points === 1 ? "Punkt" : "Punkten"} akkreditiert.`,
    validity: (from: string, to: string): string => `Gültigkeit: ${from} – ${to}`,
    fortbildungsnummer: (value: string): string => `Fortbildungsnummer: ${value}`,

    requirements: "Voraussetzungen für den Zertifikatserwerb",
    requirementsLead:
      "Um das CME-Zertifikat zu erhalten, müssen Sie folgende Kriterien erfüllen:",
    requirementWatch: (percent: number): string =>
      `Vollständige Videowiedergabe: Mindestens ${percent} % aller Videomodule müssen angesehen werden`,
    requirementQuiz: (percent: number): string =>
      `Erfolgreiches Bestehen des Wissenstests: Mindestens ${percent} % der Fragen müssen korrekt beantwortet werden`,
    requirementEvaluation: "Evaluationsbogen ausfüllen: Kurze Bewertung der Fortbildung",

    reporting: "Punktemeldung",
    reportingBody:
      "Nach erfolgreicher Teilnahme erfolgt eine automatisierte Punktemeldung über eine direkte Anbindung an das EIV (Elektronischer Informationsverteiler).",
    reportingEfn:
      "Ihre erworbenen CME-Punkte werden direkt an Ihre zuständige Ärztekammer übermittelt. Hierfür benötigen wir Ihre EFN (Einheitliche Fortbildungsnummer), die nach erfolgreichem Fortbildungsabschluss abgefragt wird.",

    certificate: "Ihr Zertifikat",
    certificateLead:
      "Nach erfolgreichem Abschluss steht Ihr personalisiertes Teilnahmezertifikat sofort zum Download bereit. Es enthält:",
    /**
     * The layout's five bullets. Fixed rather than derived: they describe what
     * the certificate renderer actually prints (P8), and a list generated from
     * whatever the course happens to have set would quietly shrink on a course
     * with no Ärztekammer — while the PDF still printed the other four.
     */
    certificateContents: [
      "Ihren Namen und Ihre EFN",
      "Titel und Inhalt der Fortbildung",
      "Anzahl der CME-Punkte",
      "Akkreditierungsnachweis der Ärztekammer",
      "Datum der Teilnahme",
    ],
  },

  quiz: {
    title: "Lernerfolgskontrolle",
    /** The heading under the eyebrow on page 08, and on every question screen. */
    exam: "Abschlussprüfung",

    /*
     * The three stat cards on page 08.
     *
     * `Antwortformat` is derived from the questions rather than fixed: a course
     * whose author wrote multiple-choice questions and whose screen promised
     * "Eine Antwort pro Frage" would be lying to a physician about how to pass.
     */
    statQuestions: "Anzahl Fragen",
    statQuestionsCaption: "Fragen gesamt",
    statFormat: "Antwortformat",
    formatSingle: "Single Choice",
    formatMixed: "Single & Multiple Choice",
    formatSingleCaption: "Eine Antwort pro Frage",
    formatMixedCaption: "Teilweise mehrere Antworten pro Frage",
    statPass: "Bestehen",
    statPassValue: (percent: number): string => `${percent} %`,
    /** "Mind. 8 von 11 richtig" — the same arithmetic the server scores with. */
    statPassCaption: (needed: number, total: number): string =>
      `Mind. ${needed} von ${total} richtig`,

    banner:
      "Beantworten Sie alle Fragen nacheinander. Das Ergebnis wird Ihnen am Ende der Prüfung angezeigt.",
    /**
     * **The layout's button says "Teilprüfung starten"** directly under a
     * heading that says Abschlussprüfung, and no per-module assessment exists
     * anywhere in the thirteen pages or in this budget (S20). Naming a feature
     * that does not exist is worse than departing from the render, so the button
     * says what it actually starts.
     */
    start: "Abschlussprüfung starten",

    /** "Frage 5 von 11" */
    questionOf: (current: number, total: number): string =>
      `Frage ${current} von ${total}`,
    questionLabel: (ordinal: number): string => `Frage ${ordinal}`,
    /** Shown when the option list is taller than its box (layout 9.3). */
    scrollHint: "Weitere Antworten durch Scrollen sichtbar",
    previous: "Zurück",
    next: "Weiter",

    attemptsUsed: (used: number): string =>
      used === 1 ? "1 Versuch bisher" : `${used} Versuche bisher`,
    attemptsUnlimited: "Die Anzahl der Versuche ist nicht begrenzt.",
    singleHint: "Bitte wählen Sie eine Antwort.",
    multiHint: "Bitte wählen Sie alle zutreffenden Antworten.",
    submit: "Antworten absenden",
    submitting: "Wird ausgewertet …",
    unanswered: "Bitte beantworten Sie diese Frage, bevor Sie fortfahren.",

    /* The two result screens, pages 11 and 12. */
    passedTitle: "Abschlussprüfung bestanden!",
    failedTitle: "Prüfung nicht bestanden",
    /** "10 / 11" over "richtige Antworten". */
    scoreOf: (correct: number, total: number): string => `${correct} / ${total}`,
    scoreCaption: "richtige Antworten",
    scoreRequirement: (needed: number, total: number): string =>
      `${needed} von ${total} richtige Antworten zum Bestehen erforderlich`,
    passedSentence: (correct: number, total: number): string =>
      `Sie haben ${correct} von ${total} Fragen richtig beantwortet.`,
    failedSentence: (correct: number, total: number, needed: number): string =>
      `Sie haben ${correct} von ${total} Fragen richtig beantwortet. Zum Bestehen der Lernerfolgskontrolle sind mindestens ${needed} richtige Antworten erforderlich. Bitte wiederholen Sie die Abschlussprüfung.`,
    retry: "Abschlussprüfung wiederholen",
    pause: "Fortbildung pausieren",
    pauseHint: "Prüfung zu einem späteren Zeitpunkt fortsetzen",
    claim: "CME-Punkte geltend machen",
    /** No points to claim, so the passed screen offers the way onwards instead. */
    claimWithoutPoints: "Fortbildung abschließen",

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

  /** The Punktemeldung screen — layout page 13, copied from the render. */
  completion: {
    title: "Herzlichen Glückwunsch!",
    subtitle: "Sie haben die Fortbildung abgeschlossen.",
    intro:
      "Um Ihre CME-Punkte zu melden und Ihr Zertifikat auszustellen, benötigen wir Ihre Angaben. Die Daten werden direkt und sicher an Ihre zuständige Ärztekammer übermittelt.",
    /** The grey box with the question-mark icon. */
    whyEfn:
      "Warum benötigen wir Ihre EFN? Die Einheitliche Fortbildungsnummer (EFN) ermöglicht die eindeutige Zuordnung Ihrer CME-Punkte. Sie finden die EFN auf Ihrem Arztausweis oder in Ihrem Kammerkonto.",

    titleLabel: "Titel",
    titlePlaceholder: "Bitte Auswählen",
    /**
     * The `Titel` select's options.
     *
     * The layout draws the control but not its list, so this one is ours.
     * **Confirm with MEDICE** — it is the only place in this file where the
     * copy was not read off a render. "Ohne Titel" exists because the layout
     * marks the field required and offers no empty choice, which would
     * otherwise make the form impossible for a physician who has none.
     */
    titles: [
      "Ohne Titel",
      "Dr. med.",
      "Dr. med. dent.",
      "Dr. rer. nat.",
      "Dr. rer. medic.",
      "PD Dr. med.",
      "Prof. Dr. med.",
      "Prof. Dr.",
    ],

    givenNameLabel: "Vorname",
    givenNamePlaceholder: "z.B. Philipp",
    familyNameLabel: "Nachname",
    familyNamePlaceholder: "z.B. Mustermann",

    efnLabel: "EFN-Nummer",
    /**
     * **The layout says eighteen.** Page 13 reads "Die 18-stellige EFN" and
     * its placeholder is eighteen characters long; the platform validates
     * fifteen, which is the number the EIV requirements were written from.
     * The hint has to agree with the validator or a physician is told to type
     * a length the field then refuses — so it says fifteen until S21 is
     * answered. See docs/show-stoppers.md.
     */
    efnHint: "Die 15-stellige EFN finden Sie auf Ihrem Arztausweis",
    efnInvalid: "Die EFN muss aus genau 15 Ziffern bestehen.",
    efnSaved: "Ihre EFN ist hinterlegt.",

    /** Split so the Datenschutzerklärung can be a link, as the layout draws it. */
    consentBefore:
      "Ich stimme der Verarbeitung meiner personenbezogenen Daten zur Übermittlung der CME-Punkte an die Ärztekammer gemäß der ",
    consentLink: "Datenschutzerklärung",
    consentAfter: " zu.",
    consentRequired: "Bitte stimmen Sie der Übermittlung zu.",

    submit: "Daten übermitteln",
    submitting: "Wird übermittelt …",
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
    download: "Download",
    moduleFilter: "Modul",
    allModules: "Alle Module",
    /** "Materialien zu Modul 1" — the group heading from the layout. */
    groupHeading: (ordinal: number): string => `Materialien zu Modul ${ordinal}`,
    /**
     * The card's secondary line: file type and size, whichever are known.
     *
     * Stands in for the layout's description paragraph, which has no field on
     * `Material` — see MediathekPanel. Saying "PDF · 1,4 MB" is at least true;
     * a lorem-ipsum sentence in its place would not be.
     */
    fileMeta: (material: {
      mimeType: string | null;
      fileSize: number | null;
    }): string => {
      const kind = material.mimeType === null ? undefined : fileKind(material.mimeType);
      const size =
        material.fileSize === null ? undefined : de.library.size(material.fileSize);
      return [kind, size]
        .filter((part): part is string => part !== undefined)
        .join(" · ");
    },
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

/**
 * "PDF", "Video", "Dokument" — a human word for a MIME type.
 *
 * A closed mapping with a neutral fallback rather than showing the raw type:
 * "application/vnd.openxmlformats-officedocument.wordprocessingml.document" is
 * not something to put on a card.
 */
function fileKind(mimeType: string): string {
  if (mimeType === "application/pdf") return "PDF";
  if (mimeType.startsWith("video/")) return "Video";
  if (mimeType.startsWith("audio/")) return "Audio";
  if (mimeType.startsWith("image/")) return "Bild";
  return "Dokument";
}

const duration = germanDuration;
const minutesAndSeconds = germanMinutesAndSeconds;
