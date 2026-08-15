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

export const de = {
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
      "Fortschritt aller Teilnehmenden. Die EFN wird aus Datenschutzgründen nur verkürzt angezeigt.",
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
    intro:
      "Neu erstellen rendert das Dokument neu und meldet nichts an die Ärztekammer. Erneut senden verschickt dasselbe Dokument. Widerrufen zieht das Dokument zurück, die Teilnahme bleibt bestehen.",
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
      "Die Websites des Kunden, auf denen die Fortbildung eingebettet werden darf — eine pro Zeile, z. B. https://www.beispiel.de. Ohne Pfad und ohne Schrägstrich am Ende.",
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
    sourceType: "Format",
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
    durationDetectFailed:
      "Die Länge konnte nicht aus der Datei gelesen werden. Das kommt bei Servern ohne CORS-Freigabe und bei adaptiven Streams vor — bitte die Länge in Sekunden eintragen und mit der tatsächlichen Videolänge vergleichen.",
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

  courses: {
    title: "Fortbildungen",
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
    intro:
      "Teilnehmende dieses Kunden. Hier werden Zugänge angelegt, Passwörter zurückgesetzt und Konten gesperrt.",
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
    },
  },
} as const;
