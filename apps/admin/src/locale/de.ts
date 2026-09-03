/**
 * Every German string the admin console renders (CLAUDE.md §5).
 *
 * The console is explicitly functional rather than beautiful (P9 header), but
 * the copy still has to be precise: this is the screen where somebody changes
 * a number that decides whether a physician's CME points are valid, and the
 * form has to say what the number does rather than just name it.
 */

/**
 * The word the security screen uses for the strictest policy.
 *
 * Hoisted out of `de.security.policy_` because two sentences below quote it
 * and an object literal cannot refer to itself. If it drifts, the notice tells
 * an operator to look for a rule the dropdown does not offer.
 */
const LABEL_REQUIRED = "Verpflichtend";

/**
 * The upload ceiling, from the constant the API enforces (P133-01).
 *
 * It used to be the literal "2 GB", written out in two hints here and two in
 * `en.ts`. P129-01 raised the ceiling to 5 GB and all four went on saying 2 —
 * so the console told an author their 3 GB lecture would be refused by a server
 * that would have taken it, and the client found it by reading the screen.
 *
 * Interpolated rather than made a function of the table, deliberately: `overlay`
 * translates strings and leaves functions in German, so a hint that became a
 * function would silently stop being English. This stays a string, derived once.
 */
const VIDEO_LIMIT = uploadLimitLabel("video");

import { uploadLimitLabel } from "@ds/domain";
import { currentLanguage, overlay } from "./language.js";
import { en } from "./en.js";

/**
 * The German table itself.
 *
 * Exported so `en.ts` can be typed against it without a cycle: annotating `de`
 * below as `typeof german` is what stops its type depending on the overlay
 * that is merged into it.
 */
export const german = {
  appTitle: "DS Education — Verwaltung",
  /* The sidebar is 15 rem wide and the full title does not fit in it — it
     rendered as "DS Education — Ve…", which is worse than a short name. */
  appShort: "DS Education",

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
    // Passwort vergessen (P40-02).
    forgotPassword: "Passwort vergessen?",
    forgotTitle: "Passwort zurücksetzen",
    forgotPrompt:
      "Geben Sie die E-Mail-Adresse Ihres Kontos ein. Wenn es ein Konto dazu gibt, senden wir Ihnen einen Link, mit dem Sie ein neues Passwort vergeben können.",
    forgotSubmit: "Link anfordern",
    /* Deliberately says "wenn" and not "wir haben": the API answers the same
       for an unknown address, and a screen that confirmed the address exists
       would undo that in the last inch. */
    forgotSent:
      "Wenn es ein Konto zu dieser Adresse gibt, ist ein Link unterwegs. Er ist 60 Minuten gültig und kann einmal verwendet werden. Prüfen Sie bitte auch den Spam-Ordner.",
    forgotFailed:
      "Die Anfrage konnte nicht gesendet werden. Bitte versuchen Sie es in einer Minute erneut.",
    backToSignIn: "Zurück zur Anmeldung",

    // Setting a password from an invitation or a reset link (P40-02).
    newPasswordTitle: "Neues Passwort vergeben",
    newPasswordPrompt:
      "Bitte wählen Sie ein Passwort mit mindestens 12 Zeichen. Es darf Ihren Namen und Ihre E-Mail-Adresse nicht enthalten.",
    newPassword: "Neues Passwort",
    newPasswordRepeat: "Passwort wiederholen",
    newPasswordSubmit: "Passwort speichern",
    newPasswordMismatch: "Die beiden Eingaben stimmen nicht überein.",
    newPasswordDone:
      "Das Passwort wurde gespeichert. Sie können sich jetzt anmelden. Alle bisherigen Anmeldungen dieses Kontos wurden beendet.",
    newPasswordLinkDead:
      "Dieser Link ist nicht mehr gültig. Links sind einmalig verwendbar und laufen ab — fordern Sie über „Passwort vergessen?“ einen neuen an.",

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
      "Der Fortschritt in den Fortbildungen — eine Zeile je Teilnahme, nicht je Person: wer zwei Fortbildungen belegt, steht zweimal hier. Die Zugänge selbst verwalten Sie unter „Zugänge“. Die EFN wird aus Datenschutzgründen nur verkürzt angezeigt.",
    empty: "Zu dieser Fortbildung liegen noch keine Teilnahmen vor.",
    emptyHint:
      "Eine Teilnahme entsteht, sobald sich eine Person an einer Fortbildung anmeldet. Bis dahin ist hier nichts zu sehen.",
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
    /* Operator actions on a Punktemeldung (P31-02). */
    requeue: "Erneut melden",
    withdraw: "Meldung widerrufen",
    withdrawConfirm: "Endgültig widerrufen",
    withdrawReason: "Grund des Widerrufs",
    withdrawReasonHint:
      "Für das Prüfprotokoll, z. B. „Widerruf auf Wunsch der Teilnehmerin, Ticket 4711“. Keine Angaben zur Person.",

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
      /* An operator took a reported Punktemeldung back at the Ärztekammer
         (P31-02). Not the same as "keine": the points existed and were
         removed, and a physician may reasonably ask why. */
      withdrawn: "widerrufen",
    },
    loadFailed: "Die Teilnahmen konnten nicht geladen werden.",
    saveFailed: "Die Änderung konnte nicht gespeichert werden.",
  },

  certificates: {
    title: "Bescheinigungen",
    /*
     * What the screen *is*, before what its three buttons do (P136-01).
     *
     * The old text opened on the difference between "Neu erstellen" and
     * "Erneut senden" — useful, and an answer to a question somebody only has
     * once they know what they are looking at. The second sentence is the other
     * pair that reads alike: a Bescheinigung is the physician's document, a
     * Punktemeldung is the report to the Ärztekammer, and they are separate
     * screens because they can succeed and fail independently.
     */
    intro:
      "Die ausgestellten Teilnahmebescheinigungen — das Dokument für die teilnehmende Person. Die Meldung der Punkte an die Ärztekammer ist etwas anderes und steht unter „Punktemeldungen“. Neu erstellen rendert das Dokument neu und meldet nichts an die Ärztekammer. Erneut senden verschickt dasselbe Dokument. Widerrufen zieht das Dokument zurück, die Teilnahme bleibt bestehen.",
    empty: "Es wurden noch keine Bescheinigungen erstellt.",
    emptyHint:
      "Eine Bescheinigung entsteht automatisch, sobald eine Person eine Fortbildung abgeschlossen hat. Sie lässt sich hier nicht von Hand anlegen.",
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
    /*
     * Why the delivery was given up on (P118-02).
     *
     * "Zustellung fehlgeschlagen" is the fact; these are the sentences that
     * say what to do about it. Each names the next step, because two of the
     * three are not fixable by pressing Erneut senden and the button that
     * looks like the answer is disabled for exactly those two.
     */
    abandoned: {
      no_recipient:
        "Für diese Person ist keine E-Mail-Adresse hinterlegt. Die Bescheinigung steht zum Download bereit und kann versendet werden, sobald eine Adresse vorliegt.",
      permanent_rejection:
        "Der empfangende Server hat die Adresse dauerhaft abgelehnt. Bitte lassen Sie die Adresse korrigieren; ein erneuter Versand an dieselbe Adresse schlägt wieder fehl.",
      attempts_exhausted:
        "Der Versand ist mehrfach vorübergehend fehlgeschlagen und wurde aufgegeben. Prüfen Sie die SMTP-Einstellungen der Plattform und versenden Sie danach erneut.",
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
    /*
     * Setting a password directly (P64-01).
     *
     * The hint is the load-bearing part: the form's behaviour changes with a
     * field left empty, and until it said so the answer to "how do I create an
     * account with a password" was not on the screen at all.
     */
    password: "Passwort (optional)",
    passwordHint:
      "Wird ein Passwort eingetragen, ist das Konto sofort nutzbar und es wird kein Einladungslink erzeugt. Bleibt das Feld leer, wird stattdessen eine Einladung erstellt. Mindestens 12 Zeichen; das Passwort darf die E-Mail-Adresse nicht enthalten.",
    createWithPassword: "Konto mit Passwort anlegen",
    createdTitle: "Konto angelegt",
    createdBody: (email: string): string =>
      `${email} kann sich ab sofort mit dem vergebenen Passwort anmelden. Es wurde kein Einladungslink erzeugt.`,

    setPassword: "Passwort setzen",
    setPasswordFor: (email: string): string => `Passwort für ${email} setzen`,
    newPassword: "Neues Passwort",
    newPasswordHint:
      "Mindestens 12 Zeichen. Alle offenen Sitzungen und Einladungslinks dieses Kontos werden dabei ungültig.",
    settingPassword: "Wird gesetzt …",

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
      "Es ist kein E-Mail-Versand eingerichtet, deshalb wurde nichts verschickt. Bitte geben Sie diesen Link der eingeladenen Person weiter — er wird nur einmal angezeigt. Damit vergibt sie ihr eigenes Passwort; ein Passwort kann hier niemand für sie festlegen.",
    inviteSent:
      "Die Einladung wurde an die angegebene Adresse verschickt. Falls sie nicht ankommt, können Sie diesen Link auch direkt weitergeben — er wird nur einmal angezeigt.",
    inviteCopy: "Link kopieren",
    inviteCopied: "Kopiert",
    inviteValidity: "7 Tage gültig, einmal verwendbar.",
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
      required: LABEL_REQUIRED,
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
    /*
     * Which of these rows is the reader's own (P74-01).
     *
     * Without it the screen draws two or more rules, says "die Regel Ihres
     * Bereichs ist Verpflichtend", and leaves the reader to guess which one
     * that is — and the obvious guess, the customer row directly under the
     * cursor, is the wrong one for a super administrator.
     */
    governsYou: "für Sie maßgeblich",
    /** When the API sent a scope the console has no name for. */
    ownCustomerScope: "Ihr Kundenbereich",
    ownFactor: "Ihr eigener zweiter Faktor",
    ownFactorEnrolled: "Eingerichtet.",
    ownFactorNone: "Nicht eingerichtet.",
    // The platform's own mail sender (P40-01).
    platformMail: "E-Mail-Versand der Plattform",
    platformMailIntro:
      "Von dieser Adresse verschickt die Plattform E-Mails zu Verwaltungskonten — etwa Links zum Zurücksetzen eines Passworts. Für Teilnehmende gelten stattdessen die SMTP-Angaben des jeweiligen Projekts.",
    platformMailReady:
      "Der Versand ist eingerichtet. „Passwort vergessen?“ funktioniert für Verwaltungskonten.",
    platformMailIncomplete:
      "Server und Absenderadresse fehlen noch. Ohne sie kann kein Link verschickt werden — Betroffene brauchen dann eine Einladung durch eine andere Administration.",
    platformMailSecure: "Verschlüsselt ab Verbindungsaufbau (Port 465)",
    /*
     * The test send, and the four things it can say (P77-01).
     *
     * Each names what to do next, because the whole reason this control exists
     * is that the alternative — trigger a real password reset and wait — tells
     * you nothing when it fails (CLAUDE.md §9.4).
     */
    platformMailTest: "Test-E-Mail senden",
    platformMailTestHint:
      "Sendet eine Testnachricht mit den gespeicherten Einstellungen an Ihre eigene Adresse. Bitte zuerst speichern — geprüft wird, was gespeichert ist, nicht was im Formular steht.",
    platformMailTestSending: "Test-E-Mail wird gesendet …",
    platformMailTestSent: (address: string): string =>
      `Test-E-Mail an ${address} gesendet. Bitte prüfen Sie, ob sie ankommt — auch im Spam-Ordner — und ob die Absenderadresse stimmt.`,
    platformMailTestNotConfigured:
      "Es ist kein Versand eingerichtet. Server und Absenderadresse werden benötigt.",
    /*
     * The SMTP server's own words, not a paraphrase. A translated or summarised
     * error would drop the one detail that identifies the problem — a response
     * code, a host name, a certificate subject.
     */
    platformMailTestFailed: (reason: string): string =>
      `Der Versand ist fehlgeschlagen. Meldung des Servers: ${reason}`,
    /* A 4xx: the server answered and said no. Never "check your connection". */
    platformMailTestRefused:
      "Die Anfrage wurde abgelehnt. Bitte laden Sie die Seite neu und melden Sie sich gegebenenfalls erneut an — nur Super-Administratoren dürfen den Plattform-Absender ändern und testen.",
    platformMailTestUnreachable:
      "Die Anfrage konnte nicht gestellt werden. Bitte prüfen Sie Ihre Verbindung und ob Sie noch angemeldet sind.",

    removeOwn: "Eigenen zweiten Faktor entfernen",
    removeOwnConfirm: "Wirklich entfernen",

    /*
     * What "entfernen" means while the rule says "verpflichtend" (P69-01).
     *
     * Reported from production: *"i removed the 2factor for an account, and
     * again after login, it is asking for setting a 2factor auth."* Both halves
     * are true, and together they read as a broken button.
     *
     * Under `required` the removal succeeds and the **policy does not change**,
     * so the next sign-in goes straight to enrolment — which is a rotation, not
     * a removal. That is the correct security behaviour: a removal that also
     * relaxed the rule would let anyone holding a live session turn the second
     * factor off for good. What was wrong is that the screen did not say so,
     * and P66-02 made the button work without making its meaning match its
     * label (CLAUDE.md §9.2, §9.4).
     *
     * So the consequence is stated before the click, and the confirmation says
     * what it is really confirming.
     */
    removeOwnRotates: (scope: string): string =>
      `Für Sie gilt die Regel „${LABEL_REQUIRED}“ aus ${scope}. Ein Entfernen ` +
      "setzt den zweiten Faktor deshalb nur zurück: beim nächsten Anmelden " +
      "richten Sie einen neuen ein — genau das, was ein Gerätewechsel braucht. " +
      "Wenn Sie gar keinen zweiten Faktor mehr verwenden möchten, stellen Sie " +
      `zuerst oben ${scope} auf „Freigestellt“.`,
    /*
     * The same fact for somebody who cannot act on it (P74-01).
     *
     * A `department_admin` under a `required` customer policy may not set
     * policies at all, so the sentence above would send them to a control they
     * do not have. Naming who can is the §9.4 half that P38-07 taught: an
     * action that is deliberately impossible has to say so where somebody looks
     * for it.
     */
    removeOwnRotatesLocked: (scope: string): string =>
      `Für Sie gilt die Regel „${LABEL_REQUIRED}“ aus ${scope}. Ein Entfernen ` +
      "setzt den zweiten Faktor deshalb nur zurück: beim nächsten Anmelden " +
      "richten Sie einen neuen ein. Diese Regel dürfen Sie nicht ändern — " +
      "wenden Sie sich an eine Administration, die den genannten Bereich " +
      "verwaltet.",
    removeOwnConfirmRotates: "Zurücksetzen und neu einrichten",
    removeOwnRotated:
      "Der zweite Faktor wurde zurückgesetzt. Beim nächsten Anmelden richten " +
      "Sie einen neuen ein — die Regel Ihres Bereichs bleibt „Verpflichtend“.",
    removeOwnRemoved:
      "Der zweite Faktor wurde entfernt. Sie melden sich künftig nur mit " +
      "Passwort an.",
    /*
     * Says what to do next, not only that the door is shut (P38-07).
     *
     * The previous wording stopped at "kann nicht entfernt werden", which left
     * the one person able to change the rule — a super administrator, reading
     * the screen the rule lives on — with no idea that they could. That is the
     * whole situation of a sole super administrator replacing their phone: the
     * reset button on Konten refuses a self-reset by design, nobody else exists
     * to reset it for them, and the way through is two clicks above this line.
     */
    removeOwnBlocked:
      "Für Ihr Konto ist der zweite Faktor verpflichtend und kann deshalb nicht " +
      "entfernt werden. Um ihn neu einzurichten — etwa bei einem neuen Gerät —, " +
      "stellen Sie die Regel Ihres Bereichs oben auf „Freigestellt“, entfernen " +
      "Sie den Faktor, richten Sie ihn neu ein und stellen Sie die Regel wieder " +
      "auf „Verpflichtend“.",
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
    emptyHint:
      "Ein Kunde ist die Mandantengrenze der Plattform. Alles Weitere — Abteilungen, Projekte, Fortbildungen — entsteht darunter. Legen Sie den ersten mit dem Formular unten an.",
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
    /* The blocking prompt (P127-01). `none` and `noneYet` above state the
       problem; these ask the question and name the next step. */
    promptTitle: "Bitte wählen Sie einen Kunden",
    promptBody:
      "Dieser Bereich gehört zu einem Kunden. Wählen Sie aus, mit welchem Kunden Sie arbeiten möchten.",
    promptEmptyBody:
      "Es ist noch kein Kunde angelegt. Legen Sie zuerst einen Kunden an — danach stehen alle Bereiche zur Verfügung.",
    promptCreate: "Kunden anlegen",
    promptNoRights:
      "Ihr Konto darf keine Kunden anlegen. Bitte wenden Sie sich an eine Administratorin oder einen Administrator.",
  },

  /**
   * The build footer (P46-01). German, like everything an operator reads —
   * CLAUDE.md §5. The commit itself is not translated: it is an identifier that
   * has to match `docker images` and the deploy log character for character.
   */
  build: {
    console: "Konsole",
    api: "API",
    skew: "Unterschiedliche Stände — bitte erneut deployen.",
    apiUnknown: "Die API meldet keinen Stand (ältere Version).",
  },

  /** The language switch in the header (P86-01). */
  language: {
    german: "Deutsch",
    english: "English",
    /**
     * The button's accessible name (P86-01).
     *
     * A two-letter label is the right *visible* control for a two-language
     * switch — a dropdown for two options is heavier than the choice — but
     * "EN" read out on its own says nothing. The name says what pressing it
     * does, which is the question somebody using a screen reader is asking.
     */
    switchTo: (language: string): string => `Sprache wechseln zu ${language}`,
  },

  nav: {
    security: "Sicherheit",
    courses: "Fortbildungen",
    participants: "Teilnehmende",
    branding: "Erscheinungsbild",
    organisation: "Organisation",
    back: "Zurück",

    /**
     * Headings over the navigation groups (P30-02).
     *
     * Ten destinations in one flat list is a list an operator reads top to
     * bottom every time, because nothing tells them which part of it they are
     * in. The three groups are the three questions the console answers: what
     * is on offer, who is taking it, and how the platform itself is set up.
     */
    groupCatalogue: "Angebot",
    groupPeople: "Teilnahme",
    groupPlatform: "Einstellungen",

    menu: "Menü",
    closeMenu: "Menü schließen",
  },

  common: {
    add: "Hinzufügen",
    save: "Speichern",
    saving: "Wird gespeichert …",
    saved: "Gespeichert.",
    cancel: "Abbrechen",
    edit: "Bearbeiten",
    /**
     * Accessible names for the row-level Bearbeiten buttons.
     *
     * A screen reader announces a button by its accessible name alone, so a
     * page of rows each ending in "Bearbeiten" is a page of buttons that all
     * sound the same.
     */
    editDepartment: (name: string): string => `Abteilung ${name} bearbeiten`,
    editProject: (name: string): string => `Projekt ${name} bearbeiten`,
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
      "Die Websites des Kunden, auf denen die Fortbildung eingebettet werden darf — eine pro Zeile, ohne Pfad und ohne Schrägstrich am Ende. " +
      "Genau eine Adresse: https://www.beispiel.de · alle Subdomains: https://*.beispiel.de (die Domain selbst ist damit nicht gemeint, dafür eine eigene Zeile) · " +
      "jeder Port, für die lokale Entwicklung: http://localhost:*. " +
      "Ein Stern allein oder https://* ist nicht möglich: die Fortbildung würde damit jeder beliebigen Website im Namen der angemeldeten Person antworten.",
    /**
     * Which lines the save would be refused for (P94-04).
     *
     * Names the values, because the operator typed them seconds ago and an
     * error that will not repeat the input cannot be acted on. §9.5's rule is
     * about values that identify a person; a hostname is not one.
     */
    embedOriginsRejected: (entries: readonly string[]): string =>
      entries.length === 1
        ? `Diese Zeile ist keine gültige Adresse: ${entries[0] ?? ""}`
        : `Diese Zeilen sind keine gültigen Adressen: ${entries.join(", ")}`,
    identityProvider: "Anmeldeverfahren",
    identityProviderHint:
      "Wie sich die Teilnehmenden dieses Projekts anmelden. Lässt sich später ändern, betrifft dann aber alle bestehenden Zugänge.",
    identityProviderKeycloak: "Keycloak des Kunden (eingebettet, z. B. in WordPress)",
    identityProviderLocal: "Zugangsdaten dieser Plattform (eigenes Portal)",
    identityProviderLocalNote:
      "Bei diesem Verfahren werden die Keycloak-Angaben unten nicht verwendet.",

    loginUrl: "Eigene Anmeldeseite des Kunden",
    loginUrlHint:
      "Wenn die Teilnehmenden sich auf der Website des Kunden anmelden — zum Beispiel im WordPress-Portal —, tragen Sie hier die Adresse dieser Seite ein. Die Übersichtsseite verlinkt dann dorthin, statt ein eigenes Anmeldeformular zu zeigen. Leer lassen für die Anmeldung über dieses Portal.",

    keycloak: "Anmeldung (Keycloak)",
    keycloakWarning:
      "Diese Werte entscheiden, gegen welchen Realm jedes Zugangstoken dieses Projekts geprüft wird. Ein falscher Wert sperrt alle Teilnehmenden dieses Projekts aus.",
    issuer: "Issuer",
    issuerHint: "Zum Beispiel https://auth.example.de/realms/medice",
    audience: "Audience",
    realm: "Realm",

    branding: "Auftritt und Datenschutz",
    brandingIntro:
      "Texte und Bilder, die die Teilnehmenden dieses Projekts sehen. Leere Felder verwenden die Standardtexte der Plattform.",
    catalogTitle: "Überschrift der Übersicht",
    catalogTitleHint:
      "Zum Beispiel „Fortbildungsbereich für ADHS“. Ohne Angabe verwendet die Plattform eine allgemeine Überschrift.",
    catalogIntro: "Einleitungstext der Übersicht",
    catalogHeroImageUrl: "Titelbild der Übersicht",
    catalogSealImageUrl: "Zertifizierungssiegel",
    catalogSealAlt: "Bildbeschreibung des Siegels",
    catalogSealHint:
      "Beides zusammen angeben. Ein Siegel ohne Beschreibung wird von Screenreadern nur als „Bild“ vorgelesen — an der Stelle, an der die Zertifizierung behauptet wird.",

    privacyPolicy: "Einwilligung zur Punktemeldung",
    privacyPolicyHint:
      "Nur wenn beide Felder gesetzt sind, wird auf dem Abschlussformular die Einwilligungs-Checkbox angezeigt und die Zustimmung nachweisbar gespeichert (Art. 7 Abs. 1 DSGVO). Fehlt eines der beiden, wird keine Einwilligung erhoben.",
    privacyPolicyUrl: "Link zur Datenschutzerklärung",
    privacyPolicyVersion: "Fassung der Datenschutzerklärung",
    privacyPolicyVersionHint:
      "Zum Beispiel „datenschutz-2026-01“. Wird zum Abschluss gespeichert, damit später belegbar ist, welcher Fassung zugestimmt wurde.",
    privacyPolicyIncomplete:
      "Bitte Link und Fassung gemeinsam angeben oder beide leer lassen.",

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

    /* The wizard (P132-03). */
    stepsLabel: "Schritte",
    steps: {
      basics: "Grunddaten",
      presentation: "Darstellung",
      review: "Prüfen & anlegen",
    },
    stepHints: {
      basics:
        "Zu welchem Projekt die Fortbildung gehört, wie sie heißt und unter welchem Kürzel sie erreichbar ist. Das Kürzel lässt sich später nicht mehr ändern.",
      presentation:
        "Was Teilnehmende im Katalog sehen, bevor sie die Fortbildung öffnen — mehr als Format und Beschreibung ist das dort nicht.",
      review:
        "Was jetzt angelegt wird, und was danach noch fehlt, bevor Teilnehmende die Fortbildung sehen können.",
    },
    stepOf: (at: number, total: number): string => `Schritt ${at} von ${total}`,
    back: "Zurück",
    next: "Weiter",
    /* Names the fields, never their values (CLAUDE.md §9.5). */
    missing: (fields: readonly string[]): string =>
      `Es fehlt noch: ${fields.join(", ")}.`,
    notSaved: "Nichts ist gespeichert, bis Sie „Fortbildung anlegen“ drücken.",
    descriptionHint:
      "Erscheint im Katalog unter dem Titel. Zwei bis drei Sätze reichen — die ausführliche Beschreibung der Detailseite wird später bearbeitet.",

    preview: "Vorschau",
    previewHint:
      "Eine Annäherung. Das Portal zeichnet die Karte mit dem Erscheinungsbild des Kunden.",
    previewNoTitle: "Noch ohne Titel",
    previewNoDescription: "Ohne Beschreibung erscheint im Katalog nur der Titel.",
    draftBadge: "Entwurf",

    nextTitle: "Danach, in dieser Reihenfolge:",
    nextSteps: [
      {
        title: "Inhalte",
        body: "Module, Kapitel, Videos und die Lernerfolgskontrolle anlegen.",
      },
      {
        title: "Zertifizierung",
        body: "VNR, Punkte, Kategorie, Veranstaltender und wissenschaftliche Leitung. Ohne diese Angaben kann keine Teilnahmebescheinigung ausgestellt werden.",
      },
      {
        title: "Veröffentlichen",
        body: "Bis dahin ist die Fortbildung ein Entwurf: sie erscheint nicht im Katalog und kann nicht geöffnet werden.",
      },
    ] as const,
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
    videoUploadHint: `MP4 oder WebM, bis ${VIDEO_LIMIT}. Die Datei wird direkt in den Dateispeicher übertragen und ist anschließend nur für Teilnehmende dieser Fortbildung abrufbar.`,

    // Seeing the file rather than its name (P74-03).
    previewLoading: "Vorschau wird geladen …",
    previewFailed:
      "Die Vorschau konnte nicht geladen werden. Die Datei bleibt hinterlegt — bitte prüfen Sie sie über die Teilnehmenden-Ansicht.",
    previewPosterAlt: "Vorschau des hochgeladenen Bildes",
    previewVideoLabel: "Vorschau des hochgeladenen Videos",
    previewOpen: "Datei öffnen",
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
    sourceLabel: "Bezeichnung",
    sourceLabelHint: "Erscheint in der Qualitätsauswahl, z. B. „720p“.",
    addSource: "Videoquelle hinzufügen",
    removeSource: (url: string): string => `Videoquelle „${url}“ entfernen`,
    sourcesMissing:
      "Ein Video braucht mindestens eine Quelle — ohne sie kann die Fortbildung nicht angesehen werden.",

    /*
     * The Range check (P62-03, P63-04).
     *
     * Written for the person who has to act on it, which is why no verdict here
     * is a status code. `mediaNoRange` is the one the whole check exists for: a
     * host that answers 200 to a Range request looks healthy everywhere else,
     * and its symptom in the player is identical to the anti-skip gate — so the
     * sentence has to say which of the two it is.
     */
    mediaCheck: "Medien prüfen",
    mediaOk: "In Ordnung",
    mediaProblem: "Problem",
    mediaChecking: "Videoserver werden geprüft …",
    mediaCheckIntro:
      "Fragt jeden Videoserver nach einem einzelnen Byte und prüft, ob er Bereichsabrufe beantwortet. Ohne Bereichsabrufe lässt sich im Player nicht springen — und für Teilnehmende sieht das genauso aus wie die Sperre gegen Vorspulen.",
    mediaCheckAllGood:
      "Alle Videoquellen beantworten Bereichsabrufe. Im Player kann innerhalb des bereits angesehenen Bereichs gesprungen werden.",
    mediaCheckProblems:
      "Nicht alle Videoquellen sind in Ordnung. Bitte die unten genannten Adressen an den Betreiber des Videoservers weitergeben.",
    mediaCheckNone: "Diese Fortbildung hat noch keine Videoquellen.",
    mediaCheckFailed:
      "Die Prüfung konnte nicht durchgeführt werden. Bitte später erneut versuchen.",
    mediaVerdict: {
      seekable: "In Ordnung — Bereichsabrufe werden beantwortet.",
      no_range:
        "Der Videoserver liefert die Datei vollständig und ignoriert Bereichsabrufe. Der Player kann deshalb nicht springen. Das ist eine Einstellung des Videoservers und nicht der Fortbildung.",
      unreachable:
        "Der Videoserver hat die Adresse abgelehnt. Meist ist die Adresse falsch geschrieben oder die Datei ist nicht öffentlich.",
      failed:
        "Der Videoserver war nicht erreichbar. Das kann an der Adresse, am Zertifikat oder am Server selbst liegen.",
      signed_by_us:
        "Datei aus dem eigenen Speicher — wird beim Abspielen signiert und muss nicht geprüft werden.",
    },
    posterUrl: "Vorschaubild",
    posterHint:
      "Standbild vor dem Start. Ohne Vorschaubild zeigt der Player bis zum ersten Bild eine schwarze Fläche.",
    durationSec: "Länge des Videos",
    /*
     * The length is read from the file (P75-01), so the copy stops asking for
     * it. `durationHint` is now only shown in the one case where no file could
     * be read; `durationMeasuredHint` is the normal case.
     */
    durationHint:
      "Konnte nicht aus der Datei gelesen werden — bitte die Länge in Sekunden eintragen. Der erforderliche Videoanteil ist ein Prozentsatz dieser Länge: Eine zu große Zahl macht den Abschnitt unabschließbar, weil die geforderten Sekunden im Video nicht existieren.",
    durationMeasuredHint:
      "Aus der Videodatei gelesen und nicht von Hand gepflegt. Der erforderliche Videoanteil ist ein Prozentsatz dieser Länge; die Gesamtdauer der Fortbildung wird aus den Längen aller Videos berechnet.",
    durationMeasured: (seconds: number): string =>
      `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, "0")} (${String(seconds)} Sekunden)`,
    durationDetecting: "Länge wird aus dem Video gelesen …",
    /**
     * The stored length was wrong, and the correction is not saved yet
     * (P76-03).
     *
     * P75-01 made the form measure and overwrite. On its own that hides the
     * repair: the field shows the right number, and nothing says the content
     * had been refusing to complete for every learner — nor that leaving this
     * screen without saving leaves it refusing.
     *
     * So: what was stored, what the file actually is, what it cost, what to do.
     * The last part is the one that makes this a mechanism rather than a
     * remark (CLAUDE.md §9.4).
     */
    /**
     * The new file's length, after the operator changed the video (P80-02).
     *
     * Not a warning. The stored number describes the file that was there
     * before, so of course it differs — and saying „Teilnehmende konnten
     * diesen Abschnitt nicht abschließen" about a video nobody has seen yet
     * is alarming and untrue. It states what happened and what to do.
     */
    /** Shown while a still is being taken from the video (P80-01). */
    posterCapturing: "Vorschaubild wird aus dem Video erzeugt …",
    durationFollowedNewFile: (measuredSec: number): string =>
      `Neue Datei erkannt — die Länge wurde auf ${String(measuredSec)} Sekunden aktualisiert. Mit „Speichern“ wird sie übernommen.`,
    durationCorrected: (storedSec: number, measuredSec: number): string =>
      `Die gespeicherte Länge (${String(storedSec)} Sekunden) stimmt nicht mit der Videodatei überein ` +
      `(${String(measuredSec)} Sekunden). Ist die gespeicherte Länge größer als die Datei, ` +
      "konnten Teilnehmende diesen Abschnitt nicht abschließen. " +
      "Mit „Speichern“ wird die gemessene Länge übernommen.",
    durationDetectFailed:
      "Die Länge konnte nicht aus der Datei gelesen werden. Das kommt bei Servern ohne CORS-Freigabe und bei adaptiven Streams vor — bitte die Länge in Sekunden eintragen und mit der tatsächlichen Videolänge vergleichen.",
    /**
     * The other cause, which used to be reported as the one above (P161-03).
     *
     * The message above is for a file the browser reached and could not read.
     * This one is for a reference the API would not sign at all — the browser
     * never saw the file. Naming CORS for that sends an author to a bucket
     * policy that is not the problem, which is the mistake §11 is about and
     * P70-01 is the price of.
     */
    durationUnreadable:
      "Auf diese Datei konnte nicht zugegriffen werden — die Vorschau und die Längenmessung wurden von der Plattform abgelehnt, nicht vom Speicher. Bitte die Datei erneut aus der Mediathek wählen oder neu hochladen; wenn das bleibt, ist es ein Fehler und kein Einstellungsproblem.",
    /**
     * Why the button is not there at all (P68-02).
     *
     * The message above is for a probe that ran and failed. This one is for the
     * case where there is nothing to click, which is what an author reaches
     * after uploading a video here — the file is a storage key, not an address
     * this browser can open. Saying so is the difference between a limitation
     * and a screen that looks half-built.
     */
    captionsUrl: "Untertitel-Datei (WebVTT oder SRT)",
    /*
     * The field takes SRT now (P74-05), and the label says so rather than the
     * hint alone: the label is what somebody reads before deciding whether they
     * have the right file, and "WebVTT" on its own is what sent them away to
     * convert one by hand.
     */
    captionsHint:
      "Datei oder URL mit deutschen Untertiteln. SRT-Dateien werden beim Hochladen automatisch in das WebVTT-Format umgewandelt, das Browser für Untertitelspuren verlangen. Untertitel sind Stufe A der Barrierefreiheitsrichtlinien (WCAG 1.2.2, EN 301 549): Ohne sie können hörbeeinträchtigte Ärztinnen und Ärzte die Fortbildung nicht absolvieren — und der Fortschritt wird sie als nicht angesehen erfassen.",
    captionsMissing:
      "Für dieses Video sind keine Untertitel hinterlegt. Bei Videos mit Sprache ist das ein Barrierefreiheitsmangel. Reine Folienaufzeichnungen ohne Ton benötigen keine.",
    body: "Text",
    /** The Zusammenfassung under the player (P115-02). */
    videoBody: "Zusammenfassung",
    videoBodyHint:
      "Erscheint im Player unter dem Video. Ohne Eintrag steht dort „Für diesen Abschnitt ist keine Zusammenfassung hinterlegt.“ — Absätze durch eine Leerzeile trennen.",
    /** On a download: the paragraph the Mediathek card shows (page-05). */
    materialBody: "Beschreibung (erscheint auf der Materialkarte)",
    fileUrl: "Datei-URL",

    /** "3 Teilnahmen erfasst" — why a delete is refused. */
    learnerRecords: (count: number): string =>
      count === 1 ? "1 Teilnahme erfasst" : `${count} Teilnahmen erfasst`,
    lockedByRecords:
      "Kann nicht gelöscht werden: es sind bereits Teilnahmen erfasst. Diese Daten sind der Nachweis für bereits vergebene Punkte.",
    /**
     * Still has something inside it (P162-02).
     *
     * The API has always refused this — `chapters.module_id` and
     * `contents.chapter_id` are `ON DELETE RESTRICT` — but until P162-01 the
     * refusal was a foreign-key violation and reached the operator as
     * „Internal server error“. Now it is a 409 with a sentence, and the button
     * that produces it is disabled before it is pressed, which is the half that
     * makes it an answer rather than an error (§9.2).
     *
     * It names the count, because "delete the things inside first" is only
     * actionable if you know how many and of what.
     */
    lockedByChildren: (count: number, what: string): string =>
      `Kann nicht gelöscht werden: enthält noch ${String(count)} ${what}. Diese müssen zuerst gelöscht werden.`,
    childChapters: (count: number): string => (count === 1 ? "Kapitel" : "Kapitel"),
    childContents: (count: number): string => (count === 1 ? "Inhalt" : "Inhalte"),
    childQuestions: (count: number): string => (count === 1 ? "Frage" : "Fragen"),
    /**
     * The two words on the row; `lockedByRecords` stays as its title and
     * accessible name (P100-01).
     *
     * The long sentence is the *rule* and is identical on every row — it is
     * stated once, in `lockedRule` at the top of the screen. What a row needs
     * is a marker that something is locked and, on hover or to a screen
     * reader, why.
     *
     * "In Verwendung" rather than "Gesperrt" (P101-01). The client read the
     * first wording as a state somebody had *imposed* — something to unlock —
     * when the fact is that the row is referenced by data elsewhere. A marker
     * naming the cause sends the reader to the right question; one naming only
     * the effect sends them looking for the switch that turned it on.
     */
    locked: "In Verwendung",
    /*
     * The content lock (P178-01) — and note this one *is* "Gesperrt".
     *
     * P101-01 renamed the row marker from "Gesperrt" to "In Verwendung"
     * because the client read the first wording as a state somebody had
     * imposed and went looking for the switch. Here that reading is exactly
     * right: somebody did impose it, there is a switch, and the sentence says
     * where. The same word is wrong one screen up and right here, which is why
     * the two are separate keys rather than one shared string.
     */
    contentLockTitle: "Inhalte gesperrt",
    contentLockBody:
      "Module, Kapitel, Inhalte und Fragen dieser Fortbildung lassen sich nicht ändern. Die Sperre wird automatisch gesetzt, sobald jemand die Fortbildung abgeschlossen hat: Ein Video, das danach hinzukommt, senkt den Fortschritt aller Teilnehmenden, die bereits fertig waren.",
    contentLockWays:
      "Sie haben zwei Möglichkeiten: die Sperre unter „Zertifizierung“ aufheben und diese Fortbildung ändern — oder dort eine Kopie erstellen und diese frei bearbeiten. Die Kopie ist ein Entwurf ohne Teilnehmende und ohne VNR.",
    lockedRule:
      "Module, Kapitel und Inhalte mit erfassten Teilnahmen lassen sich nicht mehr löschen — diese Daten sind der Nachweis für bereits vergebene Punkte.",
    questionCount: (count: number): string =>
      count === 1 ? "1 Frage" : `${count} Fragen`,
    noQuestions: "Keine Fragen — diese Lernerfolgskontrolle kann niemand bestehen.",
    editQuiz: "Fragen bearbeiten",
    /** The same screen on a locked course, where it can only be read. */
    viewQuiz: "Fragen ansehen",

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
    /** The row's title before a name has been typed (P100-02). */
    unnamed: "Neuer Referent",
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
    railAdd: "Frage am Ende anfügen",
    railHeading: (count: number): string =>
      count === 1 ? "1 Frage" : `${String(count)} Fragen`,
    railProblem: "Diese Frage ist unvollständig",
    addQuestion: "Frage hinzufügen",
    /** The read-only view on a content-locked course (P178-01). */
    lockedBody:
      "Diese Lernerfolgskontrolle gehört zu einer gesperrten Fortbildung und kann nur gelesen werden. Fragen, Antworten und die Bewertung bleiben unverändert — das ist die Grundlage, auf der bereits jemand bestanden hat.",
    /** Screen-reader only: „✓“ alone says nothing to a screen reader. */
    correctOption: "richtige Antwort",
    /*
     * The way out, at the bottom where the work ends (P74-06).
     *
     * Named rather than "Zurück": this screen is two levels down — a course, a
     * tab, a quiz — so "back" has two plausible answers. It names the tab the
     * quiz replaced, which is "Inhalte"; the neighbouring tab is called "Inhalte
     * & Darstellung" and the two are easy to confuse, so the wording has to
     * point at exactly one of them.
     */
    backToStructure: "Zurück zu den Inhalten",
    unsavedChanges: "Nicht gespeicherte Änderungen gehen dabei verloren.",
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
    /** The row's title before a prompt has been typed (P100-02). */
    unnamed: "Neue Frage",
    /**
     * Not a refusal any more (P114-01).
     *
     * This used to read "Kann nicht gelöscht werden" and it was the whole
     * defect: one recorded answer froze the exam for ever. The row still cannot
     * be deleted — it is the evidence behind a CME point — but the *question*
     * can leave the exam, which is what the author was asking for. So the
     * sentence now says what the button will do, in the order it happens.
     */
    retireOnRemove:
      "Diese Frage wurde bereits beantwortet. Sie wird deshalb nicht gelöscht, sondern aus der Lernerfolgskontrolle entfernt: künftige Teilnehmende sehen sie nicht mehr, bereits abgegebene Versuche behalten ihr Ergebnis.",
    confirmRetire: "Aus Prüfung entfernen",
    /** What the exam holds that is no longer in it. */
    retiredNotice: (count: number): string =>
      count === 1
        ? "1 Frage wurde aus dieser Lernerfolgskontrolle entfernt. Sie bleibt gespeichert, weil bereits abgegebene Versuche sie als Nachweis brauchen."
        : `${count} Fragen wurden aus dieser Lernerfolgskontrolle entfernt. Sie bleiben gespeichert, weil bereits abgegebene Versuche sie als Nachweis brauchen.`,
    retiredTitle: "Entfernte Fragen",

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
    /** The read-only view on a content-locked course (P178-01). */
    lockedBody:
      "Der Evaluationsbogen gehört zu einer gesperrten Fortbildung und kann nur gelesen werden. Bereits abgegebene Antworten beziehen sich auf genau diese Fragen.",
  },

  /** Texte — the customer's own words for the learner's screens (P83-04). */
  /** The Mediathek picker (P81-03). */
  media: {
    title: "Mediathek",
    close: "Schließen",

    /* The one button, and the dialog behind it (P90-01). */
    choose: "Medien auswählen",
    dialogTitle: "Medien auswählen",
    tabsLabel: "Woher die Datei kommt",
    tabs: {
      library: "Mediathek",
      upload: "Datei hochladen",
      url: "Von Adresse (URL)",
    },
    dropHere: "Datei hierher ziehen oder auswählen",
    /*
     * What this field accepts, per purpose (P90-01).
     *
     * One dialog serves four fields, and the first version showed the video
     * hint in all of them — so an author uploading a PDF was told it could be
     * several gigabytes of MP4. A hint that describes a different field is worse than
     * none: it is a confident wrong answer at the moment somebody is deciding
     * whether their file will be accepted.
     */
    uploadHints: {
      video: `MP4 oder WebM, bis ${VIDEO_LIMIT}. Die Datei wird direkt in den Dateispeicher übertragen und ist anschließend nur für Teilnehmende dieser Fortbildung abrufbar.`,
      poster: "JPEG, PNG oder WebP. Wird als Vorschaubild der Fortbildung angezeigt.",
      captions:
        "WebVTT (.vtt) oder SRT (.srt). SRT-Dateien werden beim Hochladen automatisch in WebVTT umgewandelt — im Dateispeicher liegt immer WebVTT.",
      material:
        "PDF-Dokument. Wird Teilnehmenden in der Mediathek der Fortbildung angeboten.",
    },
    urlLabel: "Adresse der Datei",
    urlHint:
      "Für Dateien, die nicht hier liegen: ein Video auf Ihrem eigenen Server oder ein adaptiver Stream (HLS, .m3u8). Die Adresse muss öffentlich abrufbar sein.",
    urlSubmit: "Adresse übernehmen",

    intro:
      "Alle Dateien, die für diesen Kunden hochgeladen wurden. Wählen Sie eine aus, statt dieselbe Datei erneut hochzuladen.",
    empty:
      "Für diesen Kunden wurde noch keine Datei hochgeladen. Sobald Sie etwas hochladen, erscheint es hier und kann in weiteren Fortbildungen verwendet werden.",
    unknownType: "Dateityp unbekannt",
    assetTitle: "Titel",
    assetAlt: "Alternativtext",
    altHint:
      "Der Titel benennt die Datei für Sie in dieser Liste. Der Alternativtext beschreibt das Bild für Menschen, die es nicht sehen können — er wird von Screenreadern vorgelesen und ist für die Barrierefreiheit (WCAG 1.1.1) erforderlich. Bleibt er leer, gilt er als nicht gesetzt.",
    use: "Diese Datei verwenden",
    forget: "Aus Mediathek entfernen",
    upload: {
      title: "Dateien hinzufügen",
      course: "Fortbildung",
      chooseCourse: "Fortbildung auswählen …",
      courseHint:
        "Dateien werden unter einer Fortbildung gespeichert. In der Mediathek stehen sie danach für alle Fortbildungen dieses Kunden zur Verfügung.",
      drop: "Dateien hierher ziehen",
      choose: "Dateien auswählen",
      busy: "Wird hochgeladen …",
      needCourse: "Bitte wählen Sie zuerst eine Fortbildung aus.",
      done: "Fertig",
      failed: "Fehlgeschlagen",
      someFailed:
        "Nicht alle Dateien konnten hochgeladen werden. Die erfolgreichen sind in der Liste unten.",
      refused: {
        unsupported_type:
          "Dieses Dateiformat wird nicht akzeptiert. Erlaubt sind MP4, WebM, MP3, M4A, JPG, PNG, WebP, PDF und VTT.",
        too_large: "Diese Datei ist zu groß.",
        empty: "Diese Datei ist leer.",
      },
    },
    forgetHint:
      "Entfernen löscht nur den Eintrag aus dieser Liste — die Datei selbst bleibt im Dateispeicher erhalten. Solange eine Fortbildung die Datei noch verwendet, wird das Entfernen abgelehnt.",

    /* The Mediathek screen (P88-01). */
    nav: "Mediathek",
    screenIntro:
      "Alle Dateien dieses Kunden: Videos, Bilder, PDF-Dokumente und Untertitel. Hier benennen Sie Dateien, hinterlegen Alternativtexte und entfernen, was nicht mehr gebraucht wird. Zum Verwenden einer Datei öffnen Sie die Fortbildung und klicken dort auf „Medien auswählen“.",
    filterLabel: "Nach Dateityp filtern",
    kinds: {
      all: "Alle",
      video: "Videos",
      image: "Bilder",
      document: "Dokumente",
      captions: "Untertitel",
      audio: "Audio",
    },
    search: "Suchen",
    refresh: "Aktualisieren",
    noMatch:
      "Zu dieser Auswahl gibt es keine Datei. Ändern Sie den Filter oder die Suche.",
    count: (shown: number, total: number): string =>
      shown === total
        ? `${total} ${total === 1 ? "Datei" : "Dateien"}`
        : `${shown} von ${total} Dateien`,
    bytes: (n: number): string => `${n} ${n === 1 ? "Byte" : "Bytes"}`,
    /*
     * Given the already-formatted size, not the byte count.
     *
     * The formatting rule lives in `media-library.ts` beside the unit table it
     * needs; a locale file that computed it would be a second implementation of
     * "1,4 MB", and the two would disagree the first time either changed.
     */
    totalSize: (size: string): string => `Belegter Speicher in dieser Liste: ${size}`,
    /* Singular and plural, because "1 Inhalten" is wrong and people notice. */
    usedBy: (n: number): string =>
      n === 1 ? "In 1 Inhalt verwendet" : `In ${n} Inhalten verwendet`,
    unused: "In keiner Fortbildung verwendet",
    noPreview: "Keine Vorschau verfügbar",
    openFile: "Datei öffnen",
  },

  copy: {
    nav: "Texte",
    intro:
      "Hier ändern Sie die Beschriftungen und Sätze, die Teilnehmende in der Fortbildung sehen. Leer lassen heißt: der Standardtext wird verwendet. Die Änderungen gelten für das gewählte Projekt.",
    project: "Projekt",
    filter: "Suchen",
    save: "Texte speichern",
    saving: "Wird gespeichert …",
    saved: "Gespeichert.",
    counts: (shown: number, total: number): string => `${shown} von ${total} Texten`,
    fallback: (value: string): string => `Standard: ${value}`,
    fixed: "Nicht änderbar",
    fixedHint:
      "Dieser Satz enthält eine Zahl und wird im Code gebildet, damit Einzahl und Mehrzahl stimmen („1 Punkt“ gegenüber „4 Punkten“). Als frei bearbeitbare Vorlage ginge die Einzahl verloren.",
  },

  branding: {
    title: "Schriftart",
    /*
     * Names what this screen is **not** (P136-01).
     *
     * The menu says "Erscheinungsbild" and the screen holds one font field.
     * Colours, logo and the privacy-policy link are a *project's* branding and
     * live under Organisation, because they differ per surface and the typeface
     * does not. An operator who clicks "Erscheinungsbild" looking for the brand
     * colour finds a font upload and no statement that they are in the wrong
     * place — which is §9.4 with the reader standing right in front of it.
     */
    intro:
      "Die Schriftart dieses Kunden. Sie wird in der Lernoberfläche verwendet; ohne eigene Schriftart wird die Standardschrift angezeigt. Farben, Logo und Datenschutz-Link gehören zum jeweiligen Projekt und werden unter „Organisation“ am Projekt eingestellt.",
    privacy:
      "Die Datei wird auf unseren eigenen Servern gespeichert und von dort ausgeliefert. Es werden keine Schriften von Drittanbietern geladen, sodass keine IP-Adressen Ihrer Nutzerinnen und Nutzer an Dritte übermittelt werden.",
    /**
     * Where the rest of the project's appearance lives.
     *
     * This screen is only the font, because a file upload needs its own
     * endpoint. Everything else — Überschrift, Titelbild, Siegel and the
     * Datenschutz-Einwilligung — is stored on the project row and edited with
     * the project's other settings. Saying so here saves an operator the hunt.
     */
    elsewhere:
      "Überschrift, Titelbild, Siegel und die Datenschutz-Einwilligung finden Sie unter Organisation beim jeweiligen Projekt.",

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

  /**
   * The EIV connection check (P103-01).
   *
   * Two registers on purpose, and the order is the point. The headline is for
   * whoever has to decide something — a PM reading "Die Verbindung zum EIV
   * funktioniert" needs nothing else. The `advice` strings are for whoever has
   * to fix it, and each one names an action rather than a diagnosis: a person
   * told `rate_limited` learns nothing they can do.
   */
  /** The Punktemeldung queue (P110-01). */
  eivQueue: {
    /*
     * Whether anything will actually be filed (P121-01).
     *
     * `willFile` is the API's own answer, not two flags this screen combines —
     * a console that ANDed them itself would be a second opinion about what the
     * worker does, and disagreeing here means somebody believes nothing is
     * being reported while it is.
     *
     * Both readings are shown. A banner that appeared only when reporting was
     * off would leave its absence meaning both "reporting is live" and "this
     * build is too old to say" — the two states it most matters to tell apart.
     */
    reporting: {
      liveTitle: "Meldungen werden übermittelt",
      live: "Abgeschlossene Teilnahmen werden an die Ärztekammer gemeldet. Eine Testteilnahme auf einer akkreditierten Fortbildung führt zu einer echten Punktemeldung.",
      offTitle: "Meldungen werden nicht übermittelt",
      off: "Punktemeldungen werden erfasst und in die Warteschlange gestellt, aber nichts wird an eine Ärztekammer gesendet.",
      endpoint: {
        mock: "Ziel: Mock-Endpunkt.",
        test: "Ziel: EIV-Testsystem.",
        live: "Ziel: EIV-Produktivsystem.",
        unknown:
          "Ziel: nicht erkannt — der Worker sendet an einen unbekannten Endpunkt nichts.",
      },
    },
    /*
     * What EIV said, as a sentence naming who can act (P119-03).
     *
     * The API's vocabulary is `validation`, `business`, `auth`. An operator
     * reading `validation` in a table has been told the truth in a language
     * that is not theirs — and worse, for the one value where the answer is
     * "this is not yours to fix, the physician has been asked", they would go
     * looking for a way to fix it and find none (§9.2, §9.4).
     */
    failureKind: {
      validation:
        "Die Ärztekammer hat die EFN der teilnehmenden Person abgelehnt. Das kann nur sie selbst korrigieren — sie wurde in ihrem Kursabschluss darauf hingewiesen. Nach der Korrektur wird die Meldung automatisch erneut eingereicht.",
      business:
        "Die Ärztekammer hat die Veranstaltung abgelehnt — meist eine unbekannte oder gesperrte VNR, oder ein Datum außerhalb des Anerkennungszeitraums. Bitte prüfen Sie die VNR der Fortbildung.",
      auth: "Die Zugangsdaten wurden abgelehnt oder fehlen. Bitte hinterlegen Sie das VNR-Passwort in den Einstellungen der Fortbildung.",
      transport:
        "Die Ärztekammer war nicht erreichbar. Wird automatisch erneut versucht.",
      server:
        "Die Ärztekammer hat einen Serverfehler gemeldet. Wird automatisch erneut versucht.",
      rate_limited:
        "Die Ärztekammer hat zu viele Anfragen gemeldet. Wird automatisch erneut versucht.",
      unknown:
        "Die Antwort der Ärztekammer war nicht eindeutig. Bitte prüfen Sie den technischen Fehler unten.",
    },
    nav: "Punktemeldungen",
    title: "Punktemeldungen",
    screenIntro:
      "Die gesetzlich vorgeschriebene Meldung der CME-Punkte an die Ärztekammer, je abgeschlossener Teilnahme eine. Die Liste ist nach Frist sortiert — oben steht die Meldung, deren gesetzliche Acht-Tage-Frist am nächsten ist, nicht die neueste.",

    loadFailed: "Die Punktemeldungen konnten nicht geladen werden.",
    actionFailed: "Die Aktion ist fehlgeschlagen.",

    filter: "Nach Status filtern",
    statusAll: "Alle",
    status: {
      queued: "In der Warteschlange",
      held: "Zurückgestellt",
      submitted: "Gemeldet",
      failed_retryable: "Erneuter Versuch geplant",
      failed_permanent: "Endgültig fehlgeschlagen",
      window_closed: "Frist abgelaufen",
      withdrawn: "Widerrufen",
    },

    participant: "EFN",
    course: "Fortbildung",
    status_: "Status",
    due: "Meldefrist",
    attempts: "Versuche",
    vnr: "VNR",
    lastError: "Letzter Fehler",
    dueNow: "Wird beim nächsten Durchlauf gemeldet",

    dueTitle: "Fällige Meldungen",
    dueBody: (count: number): string =>
      count === 1
        ? "Eine Punktemeldung wird beim nächsten Durchlauf des Workers an die Ärztekammer übermittelt."
        : `${String(count)} Punktemeldungen werden beim nächsten Durchlauf des Workers an die Ärztekammer übermittelt.`,

    empty: "Keine Punktemeldungen",
    emptyHint:
      "Sobald eine Person eine Fortbildung abschließt und ihre EFN angibt, erscheint die Meldung hier.",

    requeue: "Erneut einreihen",
    withdraw: "Widerrufen",
    withdrawConfirm: "Wirklich widerrufen?",
    withdrawCancel: "Abbrechen",
    withdrawFor: (efn: string): string => `Punktemeldung für ${efn} widerrufen`,
    withdrawReason: "Widerruf durch die Verwaltung",

    previous: "Zurück",
    next: "Weiter",
    pageOf: (page: number, last: number): string =>
      `Seite ${String(page)} von ${String(last)}`,
  },

  eivCheck: {
    title: "Verbindung zum EIV prüfen",
    intro:
      "Prüft mit der VNR und dem Passwort dieser Fortbildung, ob die Meldung an die Ärztekammer funktioniert — bevor die erste Teilnahme gemeldet werden muss.",
    /*
     * Stated, not implied.
     *
     * An operator who is unsure whether a button reports somebody will not
     * press it, and one who assumes it does not — wrongly — is the person this
     * platform must never have. The endpoint behind this genuinely cannot
     * reach `push_teilnahme`; saying so is reporting a fact, not reassuring.
     */
    readOnly:
      "Dabei wird nichts gemeldet und nichts verändert. Es werden ausschließlich Daten gelesen.",
    needsVnr:
      "Für diese Fortbildung ist noch keine VNR hinterlegt. Tragen Sie die VNR und das VNR-Passwort oben ein und speichern Sie, dann kann die Verbindung geprüft werden.",

    /*
     * Which register to check against (P157-01).
     *
     * The client asked to be able to aim the check himself. The wording says
     * what each choice *is* rather than what it is called internally, because
     * "configured" and "test" are our words: an operator needs to know whether
     * a green result means the Ärztekammer or a rehearsal.
     */
    environment: "Register",
    environmentHint:
      "Das Testsystem ist die Übungsumgebung des EIV. Dort gemeldete Punkte erreichen keine Ärztekammer und keine Ärztin — es ist die Umgebung, die der EIV für die Entwicklung vorsieht. Diese Prüfung liest ohnehin nur; die Auswahl entscheidet, welches System antwortet.",
    environmentConfigured: "Register dieser Installation",
    environmentTest: "Testsystem des EIV",

    password: "VNR-Passwort (optional)",
    passwordHint:
      "Leer lassen, um das gespeicherte Passwort zu prüfen. Ein hier eingetragenes Passwort wird nur für diese Prüfung verwendet und nicht gespeichert — so lässt sich ein neues Passwort testen, ohne das funktionierende zu überschreiben.",
    action: "Verbindung prüfen",
    running: "Prüfung läuft …",

    resultOk:
      "Die Verbindung zum EIV funktioniert. VNR und Passwort werden von der Ärztekammer akzeptiert.",
    resultAuthFailed:
      "Die Ärztekammer hat die VNR oder das Passwort abgelehnt. Bitte prüfen Sie beide Angaben aus dem Anerkennungsbescheid.",
    resultUnreachable:
      "Die Zugangsdaten wurden akzeptiert, aber eine der Abfragen ist fehlgeschlagen. Details unten — häufig ist der Dienst nur vorübergehend nicht erreichbar.",

    endpoint: "Geprüfte Adresse",

    /*
     * Which register, in words (P107-01).
     *
     * The address alone does not answer it. EIV call their sandbox
     * `backend-test.eiv-fobi.de` and the live register `backend.eiv-fobi.de`,
     * so one word separates a rehearsal from a statutory filing — and the
     * client read the two as the same thing, which is exactly the outcome to
     * expect from anyone who has not memorised EIV's naming (§9.4).
     *
     * "Echtsystem" and "Testsystem" rather than "live"/"test": these are the
     * words a German operator uses about a system they are afraid of breaking.
     */
    tierLabel: "System",
    tier: {
      mock: "Lokales Testsystem der Plattform — erreicht die Ärztekammer nicht",
      test: "Testsystem der EIV — Meldungen landen in keinem echten Register",
      live: "Echtsystem der Ärztekammer — Meldungen sind verbindlich",
      unknown: "Unbekannte Adresse — wird wie ein Echtsystem behandelt",
    },

    /*
     * Whether the worker is armed, which decides what a completed Fortbildung
     * actually does. It was readable only in `config.env` over SSH — so the one
     * person who can decide whether to go live could not see the current state
     * of the decision.
     */
    submissionsLabel: "Punktemeldung",
    submissionsOn: "Aktiv — abgeschlossene Fortbildungen werden gemeldet",
    submissionsOff: "Abgeschaltet — es wird nichts gemeldet",

    /*
     * The one combination worth a warning rather than a label. Everything else
     * on this screen is a statement; this is the state in which the next
     * physician to finish files a statutory report against their own EFN, and
     * the person reading it should know before they close the tab.
     */
    liveArmed:
      "Diese Installation meldet Punkte verbindlich an die Ärztekammer. " +
      "Jede abgeschlossene Fortbildung erzeugt eine echte Punktemeldung auf die " +
      "EFN der teilnehmenden Person.",

    reportedCount: "Bereits gemeldete Teilnahmen",
    passwordSource: "Passwort",
    passwordTyped: "hier eingegeben, nicht gespeichert",

    eventTitle: "Das sagt die Ärztekammer zu dieser VNR",
    eventName: "Veranstaltung",
    eventCategory: "Kategorie",
    /*
     * The accredited period, which is not decoration.
     *
     * A `teilnahmedatum` outside this window is refused, and for an on-demand
     * Fortbildung taken across a year that is potentially every completion.
     */
    eventPeriod: "Anerkennungszeitraum",
    eventPoints: "Punkte",
    pointsValue: (attendance: number | null, assessment: number | null): string =>
      `Teilnahme ${attendance ?? "—"} · Lernerfolg ${assessment ?? "—"}`,
    lernerfolgMismatch:
      "Diese Fortbildung meldet den Lernerfolgspunkt, die Ärztekammer führt für diese VNR aber keinen. Eine Meldung mit Lernerfolg würde abgelehnt.",
    eventLocked:
      "Diese Veranstaltung ist bei der Ärztekammer für Meldungen gesperrt. Es kann keine weitere Teilnahme gemeldet werden.",

    detailToggle: "Technische Details",
    steps: {
      authenticate: "Anmeldung mit VNR und Passwort",
      event: "Veranstaltungsdaten lesen",
      reported: "Bereits gemeldete Punkte lesen",
    },
    stepOk: "erfolgreich",
    stepFailed: "fehlgeschlagen",

    /** Each names what to do, not what happened. */
    advice: {
      auth: "VNR und Passwort prüfen — beide stehen im Anerkennungsbescheid.",
      rate_limited: "Zu viele Anfragen. In einigen Minuten erneut prüfen.",
      server: "Beim EIV ist ein Fehler aufgetreten. Später erneut prüfen.",
      network:
        "Der EIV war von diesem Server aus nicht erreichbar. Netzwerk oder Adresse prüfen.",
      business:
        "Die Ärztekammer hat die Anfrage inhaltlich abgelehnt. Bitte den Anerkennungsbescheid prüfen.",
      format:
        "Die Antwort des EIV war unerwartet aufgebaut. Bitte den Support einschalten.",
      unknown: "Unerwarteter Fehler. Die technische Meldung steht daneben.",
    },
  },

  /**
   * Plattform → Punktemeldung (P180-01).
   *
   * The screen that replaces three lines in `config.env`. Every sentence is
   * written for somebody about to change what leaves this installation, and the
   * one that matters most is `liveWarning`: a Punktemeldung cannot be unfiled.
   */
  platform: {
    nav: "Punktemeldung",
    title: "Punktemeldung an die Ärztekammer",
    intro:
      "Diese Einstellungen gelten für die gesamte Installation, nicht für einzelne Kunden oder Fortbildungen. Sie entscheiden, ob abgeschlossene Teilnahmen an die Ärztekammer gemeldet werden und an welches System.",

    workerLegend: "Übermittlung",
    workerLabel: "Punktemeldungen automatisch übermitteln",
    workerHintOn:
      "Der Dienst prüft etwa jede Minute, ob abgeschlossene Teilnahmen zu melden sind, und übermittelt sie an das unten gewählte System.",
    workerHintOff:
      "Es wird derzeit nichts übermittelt. Abgeschlossene Teilnahmen bleiben in der Warteschlange und werden gemeldet, sobald Sie die Übermittlung einschalten — auch rückwirkend.",
    /*
     * The sentence that is easy to leave out and expensive to leave out: the
     * queue does not start at the moment somebody flips the switch.
     */
    workerBacklogWarning:
      "Achtung: Beim Einschalten werden auch alle bereits wartenden Meldungen übermittelt, nicht nur neue.",

    endpointLegend: "Zielsystem",
    endpointHint:
      "An welches System die Meldungen gehen. Die Adresse dazu ist fest hinterlegt und lässt sich hier nicht frei eingeben.",
    endpoints: {
      mock: "Testattrappe auf diesem Server",
      test: "Testsystem der EIV (backend-test.eiv-fobi.de)",
      live: "Echtsystem der Ärztekammer (backend.eiv-fobi.de)",
    },
    endpointHints: {
      mock: "Nichts verlässt diesen Server. Für Entwicklung und für die Prüfung des Ablaufs.",
      test: "Das System, das die EIV ausdrücklich für Integrationen vorsieht. Zugangsdaten und Testveranstaltungen kommen vom EIV-Support, nicht von Ihrer echten VNR.",
      live: "Echte Punktemeldungen auf den Fortbildungskonten echter Ärztinnen und Ärzte.",
    },
    endpointUrl: "Adresse",

    liveLegend: "Bestätigung für das Echtsystem",
    liveWarning:
      "Eine übermittelte Punktemeldung lässt sich nicht zurücknehmen. Sie kann nur widerrufen werden, und der Widerruf bleibt im Fortbildungskonto der betroffenen Person sichtbar. Bitte bestätigen Sie ausdrücklich, dass an das Echtsystem gemeldet werden darf.",
    liveConfirm:
      "Ich bestätige, dass diese Installation echte Punktemeldungen an die Ärztekammer übermitteln darf.",
    liveConfirmed: (at: string): string =>
      `Bestätigt am ${at}. Wenn Sie das Zielsystem wechseln, erlischt diese Bestätigung.`,
    liveMissing:
      "Für das Echtsystem fehlt die Bestätigung. Solange sie fehlt, wird nichts übermittelt.",

    save: "Einstellungen speichern",
    saving: "Wird gespeichert …",
    saved: "Die Einstellungen wurden gespeichert.",
    updatedAt: (at: string): string => `Zuletzt geändert am ${at}.`,
  },

  contentLock: {
    legend: "Inhaltssperre",
    label: "Inhalte dieser Fortbildung sperren",
    /**
     * Two hints, because the consequence of the switch is different in each
     * direction and a single sentence would describe only the state it is
     * already in (§9.4).
     */
    hintUnlocked:
      "Solange die Sperre nicht gesetzt ist, können Module, Kapitel und Inhalte jederzeit geändert werden. Die Sperre wird automatisch gesetzt, sobald jemand die Fortbildung abschließt.",
    hintLocked:
      "Die Inhalte sind gesperrt. Wenn Sie die Sperre aufheben und danach Inhalte hinzufügen, sinkt der Fortschritt aller Teilnehmenden, die die Fortbildung bereits abgeschlossen haben — auch derjenigen, die ihre Punkte noch nicht geltend gemacht haben. Für eine neue Fassung ist eine Kopie der sichere Weg.",

    cloneLegend: "Kopie erstellen",
    cloneHint:
      "Kopiert Module, Kapitel, Inhalte, Fragen, Referenten und den Evaluationsbogen in eine neue Fortbildung. Die Kopie ist ein Entwurf, ist nicht gesperrt und hat keine Teilnehmenden. VNR, VNR-Passwort und Gültigkeitszeitraum werden nicht übernommen — sie gehören zu genau einer akkreditierten Veranstaltung.",
    cloneSlug: "Kürzel der Kopie",
    cloneSlugHint: "Kleinbuchstaben, Ziffern und Bindestriche. Wird Teil der Adresse.",
    cloneTitle: "Titel der Kopie",
    cloneAction: "Kopie erstellen",
    cloning: "Kopie wird erstellt …",
    cloneDone: "Die Kopie wurde erstellt.",
    cloneOpen: "Kopie öffnen",

    /*
     * The sample (P180-02). The client: *"also with sample certificate
     * generation, if we use test server, i should easily test this"*.
     */
    sampleLegend: "Musterbescheinigung",
    sampleHint:
      "Erzeugt eine Teilnahmebescheinigung mit den echten Angaben dieser Fortbildung — VNR, Punkte, Stempel, Unterschrift — und einer erfundenen Person. So sehen Sie das fertige Dokument, bevor die erste Teilnehmerin es bekommt. Es wird dabei nichts ausgestellt und nichts gespeichert.",
    sampleAction: "Musterbescheinigung erzeugen",
    sampleBusy: "Wird erzeugt …",
    sampleMarked:
      "Auf dem Dokument steht „MUSTER — keine gültige Bescheinigung“. Es ist als Muster erkennbar und darf nicht weitergegeben werden.",
  },

  courses: {
    title: "Fortbildungen",
    /** Shown beside a course whose contents are closed to edits (P178-01). */
    lockedBadge: "Inhalte gesperrt",
    /*
     * The one screen that had no intro at all, and the one an operator opens
     * first (P136-01). A reviewer put it plainly: the learner side explains
     * itself from the screens, and the administration does not — "if I look at
     * the viewer who is going to use it, few things still need to be improved".
     *
     * It names the three stages rather than the table's columns, because what
     * a newcomer cannot work out is not what a row means: it is that a course
     * is invisible until somebody publishes it, which is the state every
     * course they create will be in.
     */
    intro:
      "Alle Fortbildungen dieses Kunden. Eine neue Fortbildung entsteht in drei Schritten: Inhalte anlegen, Zertifizierung ausfüllen, veröffentlichen. Bis zur Veröffentlichung ist sie ein Entwurf und für Teilnehmende nicht sichtbar.",
    empty: "Für diesen Mandanten sind keine Fortbildungen hinterlegt.",
    emptyHint:
      "Eine Fortbildung besteht aus Modulen, Kapiteln und Inhalten. Sie können sie anlegen und später jederzeit erweitern.",
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

    /*
     * Deleting a Fortbildung (P101-02).
     *
     * `DELETE /admin/courses/{slug}` has existed since P12-04 and no screen
     * offered it, so the only way to remove a course created by mistake was a
     * request nobody in the console could make. §9.2's mirror: an action the
     * system performs and the screen hides is as misleading as one it refuses.
     *
     * Same rule as the structure rows — a course with recorded participations
     * is evidence for points already awarded — so the same marker and the same
     * sentence, rather than a second vocabulary for one rule.
     */
    columnActions: "Aktionen",
    delete: "Löschen",
    deleteConfirm: "Wirklich löschen?",
    deleteAria: (title: string): string => `Fortbildung „${title}“ löschen`,
    lockedByEnrolments:
      "Kann nicht gelöscht werden: es sind bereits Teilnahmen erfasst. Diese Daten sind der Nachweis für bereits vergebene Punkte.",
    deleteRule:
      "Eine Fortbildung ohne erfasste Teilnahmen kann gelöscht werden; mit Teilnahmen nicht mehr.",
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
    validFrom: "Anerkennung gültig ab",
    validTo: "Anerkennung gültig bis",
    validityHint: "Aus dem Anerkennungsbescheid der Ärztekammer.",

    settings: "Einstellungen",
    /**
     * The publish section (P53-01).
     *
     * "Sichtbarkeit" rather than "Status": an operator asks whether physicians
     * can see the course, not what its status field says.
     */
    visibility: "Sichtbarkeit",
    draftExplained:
      "Diese Fortbildung ist ein Entwurf. Teilnehmende sehen sie nicht — sie erscheint nicht im Katalog und kann nicht geöffnet werden. Neue Fortbildungen sind immer Entwürfe, bis Sie sie veröffentlichen.",
    publishedExplained:
      "Diese Fortbildung ist veröffentlicht und für Teilnehmende sichtbar.",
    publish: "Veröffentlichen",
    /**
     * Not "Löschen" and not "Deaktivieren": retracting keeps every enrolment
     * and every result. It stops the course being offered, which is the same
     * thing an abgelaufener Teilnahmezeitraum does (P51-02).
     */
    unpublish: "Zurückziehen (Entwurf)",
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

    /*
     * This used to read "Änderungen gelten nur für neue Teilnahmen. Bereits
     * begonnene Teilnahmen behalten die Werte, die bei ihrem Start gültig
     * waren." — and it stopped being true in P174-01, when the client asked
     * for the three gating thresholds to come from the course:
     *
     *   > The three gating thresholds — required_watch_percent,
     *   > pass_threshold_percent, max_quiz_attempts should come from the
     *   > course.
     *
     * `findEnrolment` reads all three from `courses` today. The enrolment's
     * snapshot columns are still written and are no longer what any gate is
     * decided on. So an edit here does reach somebody who is halfway through,
     * which is what was asked for — and this sentence was telling the operator
     * the opposite (§11.9: a comment is a claim; §11.14: repeating a stale
     * note asserts it).
     *
     * Renamed with it. `notRetroactive` would have gone on describing the
     * behaviour it no longer has, in every call site and every search.
     */
    thresholdReach:
      "Änderungen wirken sofort — auch auf laufende Teilnahmen. Wer die Fortbildung bereits abgeschlossen hat, behält seinen Abschluss; wer noch dabei ist, wird ab sofort an den neuen Werten gemessen.",

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
    /* Which credit the Punktemeldung claims (P31-02, S25). */
    eivPunkte: "Punkte in der Meldung",
    eivPunkteHint:
      "Der EIV meldet die Punkte für die Teilnahme und die für die Lernerfolgskontrolle getrennt. Welche eine Fortbildung beanspruchen darf, steht im Anerkennungsbescheid — im Zweifel unten bei der Ärztekammer prüfen.",
    eivPunkteBasis: "Punkte für die Teilnahme",
    eivPunkteLernerfolg: "Punkte für die Lernerfolgskontrolle",

    /* The VNR pre-check (P31-02). */
    eivCheck: "Bei der Ärztekammer prüfen",
    eivCheckHint:
      "Fragt den EIV, was zu dieser VNR hinterlegt ist. Es wird nichts gemeldet und nichts verändert. Wichtig ist vor allem der Zeitraum: Der EIV weist eine Meldung ab, deren Teilnahmedatum außerhalb liegt.",
    eivCheckAction: "Daten abrufen",
    eivChecking: "Wird abgerufen …",
    eivCheckNeedsCredentials: "Dafür müssen VNR und VNR-Passwort hinterlegt sein.",
    eivThema: "Thema",
    eivZeitraum: "Anerkannter Zeitraum",
    eivKategorie: "Kategorie",
    eivLocked:
      "Die Ärztekammer hat diese Veranstaltung für Meldungen gesperrt. Es wird kein Punkt mehr gutgeschrieben.",
    eivLernerfolgMismatch:
      "Für diese Veranstaltung sind 0 Punkte für die Lernerfolgskontrolle hinterlegt, oben ist sie aber angehakt. Der EIV kann die Meldung deshalb ablehnen.",

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
    /*
     * Says which of the two people-screens this is (P136-01).
     *
     * "Zugänge" and "Teilnehmende" are one letter apart in meaning to anybody
     * who has not built this: one is a person who can sign in, the other is
     * that person's progress through one Fortbildung. Each now says what it is
     * *and* names the other, because the question is never "what is this
     * table" — it is "which of the two am I looking at".
     */
    intro:
      "Die Personen dieses Kunden, die sich anmelden können — eine Zeile je Person. Hier legen Sie Zugänge an, setzen Passwörter zurück und sperren Konten. Wie weit jemand in einer Fortbildung ist, steht unter „Teilnehmende“.",
    search: "Suche",
    /* Split in two for the empty state (P30-02): the first line says what is
       missing, the second what to do about it. */
    empty: "Noch keine Teilnehmenden.",
    emptyHint:
      "Legen Sie über „Zugang anlegen“ die erste Person an – sie kann sich danach sofort im Fortbildungsportal anmelden.",
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
    filterComplete: "Zertifiziert",
    /**
     * The group that exists because of P51-01, and the reason this filter was
     * worth adding: these people have *finished the Fortbildung* and are
     * waiting only on the Evaluationsbogen or their EFN. Under the old
     * two-way split they were counted as "Offen" beside people who had not
     * started, so the one list worth acting on could not be produced.
     */
    filterAwaiting: "Zertifizierung offen",
    filterOpen: "In Bearbeitung",
    filterAttention: "Meldung prüfen",

    columnName: "Person",
    columnEmail: "E-Mail",
    columnProgress: "Fortschritt",
    columnWatched: "Video",
    columnQuiz: "Lernerfolgskontrolle",
    columnEvaluation: "Evaluation",
    columnEfn: "EFN",
    columnCourseComplete: "Fortbildung",
    columnComplete: "Zertifiziert",
    /** Course finished, but before the date was recorded (migration 0037). */
    completedUndated: "abgeschlossen",
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
      /* Reported and then taken back at the Ärztekammer by an operator
         (P31-02). Deliberately not "keine": the points were credited once. */
      withdrawn: "widerrufen",
    },

    certificate: {
      none: "keine",
      pending: "ausstehend",
      issued: "ausgestellt",
      delivered: "zugestellt",
      bounced: "unzustellbar",
      // Missing until P179-01. `certificates` has had the state since
      // migration 0023 and the cell rendered blank for it.
      revoked: "widerrufen",
    },

    /*
     * The support panel (P179).
     *
     * The client, on a row reading "unzustellbar" with nothing beside it:
     *
     *   > what does `undeliverable` mean, i need a retry button, i need error
     *   > handling, i need debugging […] how can an admin download the
     *   > certificate of a person to send it to them as a support person, this
     *   > part is quite weak!
     *
     * Every sentence below answers one of those, in the words of somebody
     * holding a telephone rather than a database.
     */
    support: {
      open: "Details und Support",
      close: "Schließen",
      openAria: (name: string): string => `Support-Details für ${name} öffnen`,

      certificateHeading: "Teilnahmebescheinigung",
      /*
       * The sentence the whole ticket exists for. `bounced` is about the
       * e-mail and about nothing else — `delivery.service.ts` is explicit that
       * a failed delivery must never affect the entitlement — and an operator
       * who does not know that will tell a physician they have lost their
       * certificate.
       */
      bouncedExplained:
        "„Unzustellbar“ bedeutet: die E-Mail konnte nicht zugestellt werden. Die Bescheinigung selbst ist gültig und steht der teilnehmenden Person in ihrem Kursbereich weiterhin zum Download bereit.",
      reasonLabel: "Ursache",
      reasons: {
        no_recipient:
          "Für diese Person ist keine E-Mail-Adresse hinterlegt. Erneutes Senden kann nicht gelingen — laden Sie die Bescheinigung herunter und senden Sie sie auf einem anderen Weg.",
        permanent_rejection:
          "Der empfangende Server hat die Adresse dauerhaft abgelehnt. Erneutes Senden an dieselbe Adresse kann nicht gelingen — die Adresse muss korrigiert werden.",
        attempts_exhausted:
          "Alle automatischen Zustellversuche sind fehlgeschlagen, ohne dass die Adresse abgelehnt wurde. Erneutes Senden ist hier sinnvoll.",
      },
      /** When `delivery_abandoned_reason` holds something this version does not know. */
      reasonUnknown:
        "Die Zustellung wurde abgebrochen; die Ursache ist in dieser Version nicht näher benannt.",
      lastErrorLabel: "Letzte Rückmeldung des Mailservers",
      lastErrorHint:
        "Die technische Meldung des Versandwegs — z. B. „SMTP 550“ für eine abgelehnte Adresse oder „no SMTP host configured“, wenn für dieses Projekt kein Mailserver hinterlegt ist.",
      attemptsLabel: "Zustellversuche",
      firstAttemptLabel: "Erster Versuch",
      nextAttemptLabel: "Nächster Versuch",
      nextAttemptNone: "kein weiterer automatischer Versuch",

      download: "Bescheinigung herunterladen",
      downloadHint:
        "Lädt die PDF-Datei herunter, damit Sie sie der teilnehmenden Person auf einem anderen Weg zusenden können. Es wird dabei nichts verschickt und nichts neu ausgestellt.",
      resend: "Erneut senden",
      resendBlocked:
        "Erneutes Senden würde hier zwangsläufig wieder fehlschlagen — siehe Ursache.",
      regenerate: "Neu erstellen",
      regenerateHint:
        "Erzeugt das Dokument neu, z. B. nach einer Namenskorrektur. An die Ärztekammer wird dabei nichts gemeldet.",
      noCertificate:
        "Für diese Teilnahme wurde noch keine Bescheinigung ausgestellt. Sie entsteht, sobald die Person die Fortbildung abgeschlossen hat.",
      pendingCertificate:
        "Die Bescheinigung ist vorgemerkt, aber noch nicht ausgestellt. „Neu erstellen“ stößt die Ausstellung erneut an.",
      revokedCertificate:
        "Diese Bescheinigung wurde widerrufen. Sie kann weder heruntergeladen noch erneut versendet werden.",
      resent: "Die Bescheinigung wurde erneut in die Zustellung gegeben.",
      regenerated: "Die Bescheinigung wird neu erstellt.",

      efnHeading: "EFN und Punktemeldung",
      efnStored: "Hinterlegte EFN",
      efnNone: "Für diese Person ist keine EFN hinterlegt.",
      efnMaskHint:
        "Aus Datenschutzgründen werden nur die letzten vier Ziffern angezeigt — genug, um die Nummer mit der Person am Telefon abzugleichen.",
      /*
       * The finding this panel exists to surface. Two copies of one number,
       * and until P179-03 no screen could tell you they had drifted apart.
       */
      efnDiverges:
        "Achtung: Die vorgemerkte Punktemeldung würde eine andere EFN übermitteln als die, die die teilnehmende Person hinterlegt hat. Korrigieren Sie die Meldung, bevor sie übermittelt wird.",
      efnAgrees: "Die vorgemerkte Punktemeldung übermittelt genau diese EFN.",
      efnCorrectLegend: "EFN der Punktemeldung korrigieren",
      /*
       * §9.4, and the sentence that keeps the client from asking for something
       * the database will refuse: say at the control what it does and what it
       * does not.
       */
      efnCorrectHint:
        "Korrigiert die EFN dieser Punktemeldung — also das, was wir an die Ärztekammer übermitteln. Das Profil der teilnehmenden Person wird dabei nicht verändert: die EFN gehört ihr, und nur sie selbst kann sie in ihrem Kursbereich ändern. Die Meldung wird dadurch nicht abgeschickt.",
      efnCorrectField: "Neue EFN (15 Ziffern)",
      efnCorrectAction: "Punktemeldung korrigieren",
      efnCorrected: "Die EFN der Punktemeldung wurde korrigiert.",
      efnCorrectUnavailable:
        "Für diese Teilnahme liegt keine Punktemeldung vor, die korrigiert werden könnte.",
      efnCorrectLocked:
        "Diese Teilnahme wurde bereits an die Ärztekammer gemeldet. Eine Korrektur ist hier nicht mehr möglich — sie muss innerhalb der Korrekturfrist bei der Ärztekammer erfolgen.",
    },
  },
} as const;

/**
 * The table every screen imports (P86-01).
 *
 * Still called `de`, and deliberately: thirty files import it under that name,
 * the German is the source of truth, and renaming it everywhere to add a
 * language switch would be churn with no reader.
 *
 * The language is decided once, at import, before any component renders — see
 * `language.ts` for why switching reloads. English is a partial overlay, so an
 * untranslated key renders in German rather than as a key name or a blank.
 */
export const de: typeof german =
  currentLanguage() === "en" ? overlay(german, en) : german;
