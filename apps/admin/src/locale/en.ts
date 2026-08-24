/**
 * English for the console (P86-01, completed P88-03).
 *
 * ## A deep-partial, merged over the German
 *
 * `overlay` walks both tables and takes the English string where there is one.
 * Anything absent renders in German, so the file is safe at every point in its
 * life — half a screen translated is half a screen translated, never a screen
 * of key names.
 *
 * It started as thirty-six strings covering the navigation and the errors. This
 * is the rest: every screen an operator works on, including the long
 * explanatory hints, which are the ones that matter most — a label can be
 * guessed from its field, and a paragraph explaining what a setting will do to
 * existing enrolments cannot.
 *
 * ## What is deliberately left in German
 *
 * The accreditation vocabulary: **Lernerfolgskontrolle**,
 * **Teilnahmebescheinigung**, **Punktemeldung**, **Anerkennungsbescheid**,
 * **Ärztekammer**, **EFN**, **VNR**. These are the words on the paperwork
 * beside the screen — the Bescheid, the EIV-FOBI interface, MEDICE's own
 * documents — and an operator reconciling one against the other needs the same
 * token in both places. "Learning assessment" is a *translation* of
 * Lernerfolgskontrolle and is not the name of the thing; inventing an English
 * equivalent for a term that appears on a legal document is exactly the guess
 * CLAUDE.md §7 refuses.
 *
 * Everything that is a product noun rather than a legal one is translated.
 * *Fortbildung* becomes **course**, because it is what the thing is and the
 * navigation has said so since P86-01.
 *
 * ## Kept honest by a check
 *
 * `scripts/i18n-coverage.mjs` counts what is translated and fails below a
 * floor. Without it this file rots the moment somebody adds a German string,
 * and the rot is invisible — the fallback means the screen still works, in the
 * wrong language, for as long as nobody looks (CLAUDE.md §9.1).
 */

import type { german } from "./de.js";

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends string
    ? string
    : T[K] extends object
      ? DeepPartial<T[K]>
      : never;
};

export const en: DeepPartial<typeof german> = {
  appTitle: "DS Education — Administration",
  appShort: "DS Education",

  auth: {
    signIn: "Sign in",
    signOut: "Sign out",
    signingIn: "Signing in …",
    failed: "Sign-in failed. Please try again.",
    required: "Please sign in to open the administration console.",
    expired: "Your session has expired. Please sign in again.",
    forbidden:
      "Your account has no access to the administration console. Please contact your administrator.",

    email: "Email address",
    password: "Password",
    invalid: "Email address or password is not correct.",
    codeLabel: "Six-digit code",
    codePrompt: "Please enter the code from your authenticator app.",
    codeSubmit: "Confirm",
    codeInvalid: "The code is not correct or is no longer valid.",

    forgotPassword: "Forgot your password?",
    forgotTitle: "Reset password",
    forgotPrompt:
      "Enter your account's email address. If an account exists for it, we will send you a link to choose a new password.",
    forgotSubmit: "Request link",
    /* "If there is an account" and not "we have sent": the API answers the same
       for an unknown address, and a screen confirming the address exists would
       undo that in the last inch. */
    forgotSent:
      "If an account exists for this address, a link is on its way. It is valid for 60 minutes and can be used once. Please check your spam folder as well.",
    forgotFailed: "The request could not be sent. Please try again in a minute.",
    backToSignIn: "Back to sign-in",

    newPasswordTitle: "Choose a new password",
    newPasswordPrompt:
      "Please choose a password of at least 12 characters. It must not contain your name or your email address.",
    newPassword: "New password",
    newPasswordRepeat: "Repeat password",
    newPasswordSubmit: "Save password",
    newPasswordMismatch: "The two entries do not match.",
    newPasswordDone:
      "The password has been saved. You can sign in now. All existing sessions for this account have been ended.",
    newPasswordLinkDead:
      "This link is no longer valid. Links can be used once and then expire — request a new one with “Forgot your password?”.",

    enrolTitle: "Set up two-factor authentication",
    enrolPrompt:
      "Scan this code with your authenticator app, then enter the six-digit code it shows.",
    enrolManual: "If you cannot scan, enter this key manually:",
    enrolFailed: "Setup could not be started. Please sign in again.",
  },

  learners: {
    title: "Participants",
    intro:
      "Progress for every participant. The EFN is shown only in shortened form, for data protection.",
    empty: "No participation has been recorded for this course yet.",
    emptyHint:
      "A participation is created as soon as somebody enrols on a course. Until then there is nothing to show here.",
    name: "Name",
    efn: "EFN",
    course: "Course",
    watched: "Watched",
    quiz: "Best result",
    submission: "Punktemeldung",
    certificate: "Certificate",
    correctName: "Correct name",
    nameLocked: "Name reported",
    nameLockedHint:
      "The Punktemeldung has already been submitted. A correction has to be made in writing to the Ärztekammer within the correction window.",
    requeue: "Report again",
    withdraw: "Withdraw report",
    withdrawConfirm: "Withdraw permanently",
    withdrawReason: "Reason for the withdrawal",
    withdrawReasonHint:
      "For the audit record, e.g. “withdrawn at the participant's request, ticket 4711”. No personal details.",

    erase: "Erase",
    eraseConfirm: "Erase permanently",
    reason: "Reason for the erasure",
    reasonHint:
      "For the processing record, e.g. “erasure request of 12.03.”. No personal details.",
    stage: {
      none: "open",
      pending: "queued",
      submitted: "submitted",
      abandoned: "abandoned",
      withdrawn: "withdrawn",
    },
    loadFailed: "The participations could not be loaded.",
    saveFailed: "The change could not be saved.",
  },

  certificates: {
    title: "Certificates",
    intro:
      "Regenerating renders the document again and reports nothing to the Ärztekammer. Resending sends the same document. Revoking withdraws the document; the participation remains.",
    empty: "No certificates have been created yet.",
    emptyHint:
      "A certificate is created automatically as soon as somebody completes a course. It cannot be created by hand here.",
    participant: "Participant",
    status: "Status",
    issued: "Issued",
    delivered: "Sent",
    regenerate: "Regenerate",
    resend: "Resend",
    revoke: "Revoke",
    revokeConfirm: "Really revoke",
    alreadyRevoked: "Revoked",
    notIssued: "Not yet issued",
    state: {
      pending: "being created",
      issued: "issued",
      delivered: "sent",
      bounced: "delivery failed",
      revoked: "revoked",
    },
    loadFailed: "The certificates could not be loaded.",
    actionFailed: "The action could not be carried out.",
  },

  staff: {
    title: "Accounts",
    intro: "Administration accounts. You only see accounts you are allowed to manage.",
    name: "Name",
    email: "Email address",
    role: "Role",
    password: "Password (optional)",
    passwordHint:
      "If a password is entered the account can be used immediately and no invitation link is created. Left empty, an invitation is created instead. At least 12 characters; the password must not contain the email address.",
    createWithPassword: "Create account with password",
    createdTitle: "Account created",

    setPassword: "Set password",
    newPassword: "New password",
    newPasswordHint:
      "At least 12 characters. All open sessions and invitation links for this account become invalid.",
    settingPassword: "Setting …",

    roleHint: "Determines what this account may create and change.",
    roleCourseEditor: "Courses only",
    roleDepartmentAdmin: "Department",
    roleCustomerAdmin: "Customer",
    roleSuperAdmin: "Super administrator",
    role_: {
      course_editor: "Courses only",
      department_admin: "Department",
      customer_admin: "Customer",
      super_admin: "Super administrator",
    },
    secondFactor: "Two-factor",
    enrolled: "set up",
    notEnrolled: "open",
    lastLogin: "Last sign-in",
    customer: "Customer",
    customerChoose: "Choose a customer …",
    customerHint:
      "Accounts below the super administrator always belong to exactly one customer.",
    invite: "Invite account",
    inviting: "Inviting …",
    inviteCreated: "Invitation created",
    inviteHandOver:
      "No email delivery is configured, so nothing was sent. Please pass this link to the invited person — it is shown only once. They use it to choose their own password; nobody can set one for them here.",
    inviteSent:
      "The invitation has been sent to the address given. If it does not arrive you can pass this link on directly — it is shown only once.",
    inviteCopy: "Copy link",
    inviteCopied: "Copied",
    inviteValidity: "Valid for 7 days, usable once.",
    signOutEverywhere: "Sign out everywhere",
    resetSecondFactor: "Reset two-factor",
    resetSecondFactorConfirm: "Really reset",
    resetSecondFactorHint:
      "For a lost device. The account has to set it up again at its next sign-in if the policy requires it, and is signed out everywhere.",
    disable: "Disable",
    disableConfirm: "Really disable",
    enable: "Enable",
    loadFailed: "The accounts could not be loaded.",
    inviteFailed: "The invitation could not be created.",
    actionFailed: "The action could not be carried out.",
  },

  security: {
    title: "Security",
    intro:
      "Rules for signing in to the administration console. You see the rules that apply to you; you may only change those of your own scope.",
    secondFactor: "Two-factor authentication",
    platformScope: "Platform (super administrator)",
    platformHint:
      "Applies to accounts belonging to no customer. Only the super administrator may change this rule.",
    customerScope: "Customer",
    policy_: {
      disabled: "Off",
      optional: "Optional",
      required: "Required",
    },
    policyHint_: {
      disabled:
        "Not asked for — not even when an account already has a second factor set up. That is how somebody with a lost device gets back in.",
      optional:
        "Voluntary. Anybody who has set up a second factor still has to use it — otherwise a stolen password would suddenly be enough.",
      required:
        "Every account in this scope sets up a second factor and is taken there at sign-in if they have not done so yet.",
    },
    strictestWins:
      "Anybody with rights in several scopes is subject to the strictest rule among them.",
    governsYou: "applies to you",
    ownCustomerScope: "Your customer scope",
    ownFactor: "Your own second factor",
    ownFactorEnrolled: "Set up.",
    ownFactorNone: "Not set up.",
    platformMail: "Platform email delivery",
    platformMailIntro:
      "The platform sends email about administration accounts from this address — password reset links, for instance. For participants the SMTP settings of the respective project apply instead.",
    platformMailReady:
      "Delivery is configured. “Forgot your password?” works for administration accounts.",
    platformMailIncomplete:
      "Server and sender address are still missing. Without them no link can be sent — the people affected then need an invitation from another administrator.",
    platformMailSecure: "Encrypted from connection start (port 465)",
    platformMailTest: "Send test email",
    platformMailTestHint:
      "Sends a test message to your own address using the saved settings. Please save first — what is checked is what is stored, not what is in the form.",
    platformMailTestSending: "Sending test email …",
    platformMailTestNotConfigured:
      "No delivery is configured. Server and sender address are required.",
    platformMailTestUnreachable:
      "The request could not be made. Please check your connection and whether you are still signed in.",

    removeOwn: "Remove your own second factor",
    removeOwnConfirm: "Really remove",
    removeOwnConfirmRotates: "Reset and set up again",
    removeOwnRotated:
      "The second factor has been reset. You will set up a new one at your next sign-in — your scope's rule stays “Required”.",
    removeOwnRemoved:
      "The second factor has been removed. From now on you sign in with a password only.",
    removeOwnBlocked:
      "A second factor is required for your account and therefore cannot be removed. To set up a new one — after changing device, for example — set your scope's rule above to “Optional”, remove the factor, set up a new one, and put the rule back to “Required”.",
    saved: "Saved.",
    loadFailed: "The security settings could not be loaded.",
    saveFailed: "The setting could not be saved.",
  },

  customers: {
    title: "Customers",
    intro: "Every customer on the platform. Only super administrators see this overview.",
    name: "Name",
    slug: "Short name",
    departments: "Departments",
    projects: "Projects",
    courses: "Courses",
    created: "Created",
    create: "Create customer",
    creating: "Creating …",
    rename: "Rename",
    remove: "Delete",
    removeConfirm: "Delete this customer permanently?",
    empty: "No customers have been created yet.",
    emptyHint:
      "A customer is the platform's tenant boundary. Everything else — departments, projects, courses — is created below it. Create the first one with the form below.",
    slugHint: "Lower case letters, digits and hyphens. Cannot be changed later.",
    contains: "Still contains",
    loadFailed: "The customer list could not be loaded.",
    saveFailed: "The customer could not be saved.",
  },

  customerPicker: {
    label: "Customer",
    choose: "Choose a customer …",
    none: "Please choose a customer above to see this section.",
    noneYet: "No customer exists yet. Create the first one under “Customers”.",
  },

  build: {
    console: "Console",
    api: "API",
    skew: "Different builds — please deploy again.",
    apiUnknown: "The API reports no build (older version).",
  },

  language: {
    german: "Deutsch",
    english: "English",
  },

  nav: {
    security: "Security",
    courses: "Courses",
    participants: "Participants",
    branding: "Appearance",
    organisation: "Organisation",
    back: "Back",
    groupCatalogue: "Catalogue",
    groupPeople: "Participation",
    groupPlatform: "Settings",
    menu: "Menu",
    closeMenu: "Close menu",
  },

  common: {
    add: "Add",
    save: "Save",
    saving: "Saving …",
    saved: "Saved.",
    cancel: "Cancel",
    edit: "Edit",
    delete: "Delete",
    confirmDelete: "Really delete",
    moveUp: "Move up",
    moveDown: "Move down",
    name: "Name",
    slug: "Short name",
    title: "Title",
    optional: "optional",
    slugHint:
      "Lower case letters, digits and hyphens. The short name appears in addresses and cannot be changed later.",
    unsaved: "There are unsaved changes.",
  },

  organisation: {
    title: "Organisation",
    intro:
      "Departments and projects organise this tenant's courses. A project is a surface — a customer's WordPress site, or our own portal — and decides which Keycloak realm sign-ins are checked against.",

    departments: "Departments",
    departmentsEmpty: "No departments have been created yet.",
    newDepartment: "New department",
    columnProjects: "Projects",

    projects: "Projects",
    projectsEmpty: "No projects have been created yet.",
    newProject: "New project",
    columnDepartment: "Department",
    columnCourses: "Courses",
    columnRealm: "Keycloak realm",

    embedOrigins: "Allowed embedding domains",
    embedOriginsHint:
      "The customer's websites on which the course may be embedded — one per line, without a path and without a trailing slash. " +
      "One exact address: https://www.example.com · every sub-domain: https://*.example.com (the domain itself is not included — give it its own line) · " +
      "any port, for local development: http://localhost:*. " +
      "A bare star, or https://*, is not possible: the course would then answer any website at all on behalf of the signed-in person.",
    embedOriginsRejected: (entries: readonly string[]): string =>
      entries.length === 1
        ? `This line is not a valid address: ${entries[0] ?? ""}`
        : `These lines are not valid addresses: ${entries.join(", ")}`,
    identityProvider: "Sign-in method",
    identityProviderHint:
      "How this project's participants sign in. It can be changed later, but the change then affects every existing account.",
    identityProviderKeycloak: "The customer's Keycloak (embedded, e.g. in WordPress)",
    identityProviderLocal: "This platform's own credentials (own portal)",
    identityProviderLocalNote:
      "With this method the Keycloak settings below are not used.",

    loginUrl: "The customer's own sign-in page",
    loginUrlHint:
      "If participants sign in on the customer's website — in a WordPress portal, for example — enter that page's address here. The overview page then links there instead of showing a sign-in form of its own. Leave empty to sign in through this portal.",

    keycloak: "Sign-in (Keycloak)",
    keycloakWarning:
      "These values decide which realm every access token of this project is checked against. A wrong value locks out every participant of this project.",
    issuer: "Issuer",
    issuerHint: "For example https://auth.example.com/realms/medice",
    audience: "Audience",
    realm: "Realm",

    branding: "Appearance and data protection",
    brandingIntro:
      "Text and images this project's participants see. Empty fields use the platform's default text.",
    catalogTitle: "Overview heading",
    catalogTitleHint:
      "For example “ADHD continuing education”. Without one the platform uses a generic heading.",
    catalogIntro: "Overview introduction",
    catalogHeroImageUrl: "Overview cover image",
    catalogSealImageUrl: "Accreditation seal",
    catalogSealAlt: "Description of the seal",
    catalogSealHint:
      "Give both together. A seal without a description is read out by screen readers as “image” alone — at the very point where accreditation is being claimed.",

    privacyPolicy: "Consent for the Punktemeldung",
    privacyPolicyHint:
      "Only when both fields are set does the completion form show the consent checkbox and store the consent provably (Art. 7(1) GDPR). If either is missing, no consent is collected.",
    privacyPolicyUrl: "Link to the privacy notice",
    privacyPolicyVersion: "Version of the privacy notice",
    privacyPolicyVersionHint:
      "For example “privacy-2026-01”. Stored on completion so it can later be shown which version was agreed to.",
    privacyPolicyIncomplete:
      "Please give link and version together, or leave both empty.",

    smtp: "Email delivery (SMTP)",
    smtpIntro:
      "Used to send the Teilnahmebescheinigungen. Without these settings the platform sends no email for this project.",
    smtpHost: "Server",
    smtpPort: "Port",
    smtpUsername: "User name",
    smtpPassword: "Password",
    smtpPasswordHint:
      "Stored encrypted and never shown again. Leave empty to keep the stored password.",
    smtpPasswordStored: "A password is stored.",
    smtpPasswordMissing: "No password is stored.",
    smtpFromAddress: "Sender address",
    smtpFromName: "Sender name",
  },

  newCourse: {
    action: "New course",
    title: "Create a new course",
    intro:
      "Only the essentials. VNR, points, organiser and scientific lead are added afterwards in the settings — where the platform also checks what is still missing for the Teilnahmebescheinigung.",
    project: "Project",
    description: "Description",
    deliveryType: "Format",
    delivery: {
      on_demand: "on demand",
      live: "live webinar",
      praesenz: "in person",
    },
    create: "Create course",
    noProjects: "Before a course can be created there has to be at least one project.",
  },

  uploads: {
    choose: "Upload file",
    stored: "Uploaded",
    remove: "Remove uploaded file",
    progress: "Upload progress",
    cancel: "Cancel",
    cancelled: "The upload was cancelled.",
    failed: "The upload failed. Please try again.",
    transportFailed:
      "The connection to file storage was lost. The file was not transferred completely — please upload it again.",
    noCourseYet: "Please save the course first.",
    videoUpload: "Upload video",
    videoUploadHint:
      "MP4 or WebM, up to 2 GB. The file is transferred straight to file storage and is afterwards retrievable only by participants of this course.",

    previewLoading: "Loading preview …",
    previewFailed:
      "The preview could not be loaded. The file is still stored — please check it through the participant view.",
    previewPosterAlt: "Preview of the uploaded image",
    previewVideoLabel: "Preview of the uploaded video",
    previewOpen: "Open file",
  },

  structure: {
    title: "Contents",
    intro:
      "Order determines unlocking: a chapter becomes reachable only once the one before it is complete. Changes to the order therefore affect participations already under way.",
    empty: "This course has no modules yet.",

    module: "Module",
    newModule: "Add module",
    moduleSubtitle: "Subtitle",

    chapter: "Chapter",
    newChapter: "Add chapter",
    chapterBody: "Introduction",
    noChapters: "No chapters yet.",
    moveToModule: "Move to another module",

    content: "Content",
    newContent: "Add content",
    noContents: "No contents yet.",
    kind: "Type",
    kinds: {
      video: "Video",
      text: "Text",
      quiz: "Lernerfolgskontrolle",
      details: "Detail information",
      material: "Media library file",
    },
    sources: "Video sources",
    sourcesHint:
      "Several renditions of the same recording. The browser takes the first one it can play — adaptive streams (HLS) therefore come first.",
    sourceUrl: "URL",
    sourceLabel: "Label",
    sourceLabelHint: "Appears in the quality menu, e.g. “720p”.",
    addSource: "Add video source",
    sourcesMissing:
      "A video needs at least one source — without one the course cannot be watched.",

    mediaCheck: "Check media",
    mediaOk: "In order",
    mediaProblem: "Problem",
    mediaChecking: "Checking video servers …",
    mediaCheckIntro:
      "Asks every video server for a single byte and checks whether it answers range requests. Without range requests the player cannot seek — and to a participant that looks exactly like the anti-skip gate.",
    mediaCheckAllGood:
      "Every video source answers range requests. The player can seek within the part already watched.",
    mediaCheckProblems:
      "Not every video source is in order. Please pass the addresses named below to whoever operates the video server.",
    mediaCheckNone: "This course has no video sources yet.",
    mediaCheckFailed: "The check could not be carried out. Please try again later.",
    mediaVerdict: {
      seekable: "In order — range requests are answered.",
      no_range:
        "The video server delivers the file in full and ignores range requests, so the player cannot seek. That is a setting of the video server and not of the course.",
      unreachable:
        "The video server refused the address. Usually the address is misspelt or the file is not public.",
      failed:
        "The video server could not be reached. That may be the address, the certificate, or the server itself.",
      signed_by_us:
        "File from our own storage — signed at playback, so nothing to check.",
    },
    posterUrl: "Preview image",
    posterHint:
      "The still shown before playback starts. Without a preview image the player shows a black area until the first frame.",
    durationSec: "Video length",
    durationHint:
      "Could not be read from the file — please enter the length in seconds. The required share of video is a percentage of this length: too large a number makes the section impossible to complete, because the seconds it demands do not exist in the video.",
    durationMeasuredHint:
      "Read from the video file rather than maintained by hand. The required share of video is a percentage of this length; the course's total duration is calculated from the lengths of all its videos.",
    durationDetecting: "Reading the length from the video …",
    posterCapturing: "Taking a preview image from the video …",
    durationDetectFailed:
      "The length could not be read from the file. That happens with servers without a CORS rule and with adaptive streams — please enter the length in seconds and compare it against the actual video length.",
    captionsUrl: "Subtitle file (WebVTT or SRT)",
    captionsHint:
      "File or URL with German subtitles. SRT files are converted to the WebVTT format on upload, which is what browsers require for subtitle tracks. Subtitles are Level A of the accessibility guidelines (WCAG 1.2.2, EN 301 549): without them physicians with a hearing impairment cannot take the course — and progress will record it as not watched.",
    captionsMissing:
      "No subtitles are stored for this video. For videos with speech that is an accessibility defect. Silent slide recordings need none.",
    body: "Text",
    materialBody: "Description (appears on the media card)",
    fileUrl: "File URL",

    lockedByRecords:
      "Cannot be deleted: participations have already been recorded. This data is the evidence for points already awarded.",
    locked: "In use",
    lockedRule:
      "Modules, chapters and contents with recorded participations can no longer be deleted — this data is the evidence for points already awarded.",
    noQuestions: "No questions — nobody can pass this Lernerfolgskontrolle.",
    editQuiz: "Edit questions",

    reordering: "Saving the order …",
    reorderFailed: "The order could not be saved. Nothing was changed.",
  },

  experts: {
    title: "Speakers",
    intro:
      "Appear under the “Referenten” tab of the learner interface. The list is replaced in full.",
    empty: "No speakers are stored.",
    add: "Add speaker",
    unnamed: "New speaker",
    roleLabel: "Role",
    roleLabelHint: "For example “scientific lead” or “speaker”.",
    name: "Name",
    institution: "Institution",
    biography: "Short biography",
    photoUrl: "Photo URL",
  },

  quiz: {
    title: "Lernerfolgskontrolle",
    intro:
      "The order of the questions is the order in the exam. Marking is on exact agreement: with “one correct answer” exactly the right option must be chosen, with “several correct answers” exactly the set of right ones.",
    empty: "No questions yet.",
    addQuestion: "Add question",
    backToStructure: "Back to the contents",
    unsavedChanges: "Unsaved changes will be lost.",
    prompt: "Question",
    kind: "Answer type",
    kinds: {
      single: "one correct answer",
      multi: "several correct answers",
    },
    option: "Answer option",
    addOption: "Add answer option",
    isCorrect: "correct",
    unnamed: "New question",
    lockedByAnswers:
      "Cannot be deleted: this question has already been answered. A submitted attempt has to keep meaning what it meant when it was marked.",

    noCorrect: "At least one answer option has to be marked correct.",
    tooManyCorrect: "With “one correct answer” exactly one option may be marked correct.",
    tooFewOptions: "At least two answer options.",
    emptyPrompt: "The question must not be empty.",
    emptyOption: "Answer options must not be empty.",
    fixBeforeSaving: "Please correct the marked questions before saving.",
  },

  evaluation: {
    title: "Evaluation form",
    intro:
      "The Anerkennungsbescheid requires an evaluation. Without questions the course cannot be completed.",
    empty: "No questions yet.",
    addQuestion: "Add question",
    prompt: "Question",
    kind: "Type",
    kinds: {
      scale: "Scale 1–5",
      text: "Free text",
      single: "Choice",
    },
    required: "Mandatory question",
    options: "Choices",
    addOption: "Add choice",
    optionsHint:
      "Only for “Choice”. Nobody can answer a choice question with no choices.",
    lockedByAnswers: "Cannot be deleted: this question has already been answered.",
    freeTextPrivacy:
      "Free-text answers may contain personal information. They are evaluated only in aggregate and appear in no log.",
  },

  media: {
    title: "Media library",
    close: "Close",

    /* The one button, and the dialog behind it (P90-01). */
    choose: "Select media",
    dialogTitle: "Select media",
    tabsLabel: "Where the file comes from",
    tabs: {
      library: "Media library",
      upload: "Upload file",
      url: "From address (URL)",
    },
    dropHere: "Drag a file here, or choose one",
    uploadHints: {
      video:
        "MP4 or WebM, up to 2 GB. The file goes straight to storage and is then reachable only by participants of this course.",
      poster: "JPEG, PNG or WebP. Shown as the course's preview image.",
      captions:
        "WebVTT (.vtt) or SRT (.srt). SRT files are converted to WebVTT on upload — storage always holds WebVTT.",
      material: "PDF document. Offered to participants in the course's Mediathek.",
    },
    urlLabel: "Address of the file",
    urlHint:
      "For files that are not held here: a video on your own server, or an adaptive stream (HLS, .m3u8). The address has to be publicly reachable.",
    urlSubmit: "Use this address",

    intro:
      "Every file uploaded for this customer. Pick one instead of uploading the same file again.",
    empty:
      "No file has been uploaded for this customer yet. Once you upload something it appears here and can be used in other courses.",
    unknownType: "File type unknown",
    assetTitle: "Title",
    assetAlt: "Alternative text",
    altHint:
      "The title names the file for you in this list. The alternative text describes the image for people who cannot see it — screen readers read it out, and it is required for accessibility (WCAG 1.1.1). Left empty, it counts as not set.",
    use: "Use this file",
    forget: "Remove from library",
    forgetHint:
      "Removing only deletes the entry from this list — the file itself stays in storage. While a course still uses the file, removing it is refused.",

    nav: "Media library",
    screenIntro:
      "Every file of this customer: videos, images, PDF documents and subtitles. Here you name files, add alternative text, and remove what is no longer needed. To use a file, open the course and click “Select media” there.",
    filterLabel: "Filter by file type",
    kinds: {
      all: "All",
      video: "Videos",
      image: "Images",
      document: "Documents",
      captions: "Subtitles",
      audio: "Audio",
    },
    search: "Search",
    refresh: "Refresh",
    noMatch: "No file matches this selection. Change the filter or the search.",
    unused: "Used in no course",
    noPreview: "No preview available",
    openFile: "Open file",
  },

  copy: {
    nav: "Wording",
    intro:
      "Change the labels and sentences participants see in a course. Leave a field empty to use the default. Changes apply to the selected project.",
    project: "Project",
    filter: "Search",
    save: "Save wording",
    saving: "Saving …",
    saved: "Saved.",
    fixed: "Not editable",
    fixedHint:
      "This sentence contains a number and is built in code so that singular and plural are both correct (“1 Punkt” against “4 Punkten”). As a free-text template the singular would be lost.",
  },

  branding: {
    title: "Typeface",
    intro:
      "The uploaded typeface is used in the learner interface. Without one, the default typeface is shown.",
    privacy:
      "The file is stored on our own servers and delivered from there. No third-party fonts are loaded, so none of your users' IP addresses are passed to third parties.",
    elsewhere:
      "Heading, cover image, seal and the data-protection consent are under Organisation, on the project itself.",

    familyName: "Font family name",
    familyNameHint:
      "Freely chosen, for example “Medice Sans”. Letters, digits, spaces, hyphen and underscore are allowed.",
    familyNameInvalid:
      "Only letters, digits, spaces, hyphen and underscore, at most 64 characters.",

    file: "Font file",
    fileHint:
      "WOFF2 or WOFF, at most 2 MB. Other formats are refused. Please upload only fonts you hold a web-embedding licence for.",
    tooLarge: "The font file is too large (2 MB maximum).",

    stored: "Stored",
    none: "No custom typeface",
    saved: "The typeface has been saved.",

    remove: "Remove typeface",
    removeHint:
      "The default typeface is then used again. Certificates already delivered are unchanged.",
  },

  loading: "Loading …",

  error: {
    title: "Something went wrong",
    retry: "Try again",
    generic: "Please try again later.",
    misconfigured:
      "The administration console is not configured correctly. Please check the environment variables.",
  },

  /** The Punktemeldung queue (P110-01). */
  eivQueue: {
    // German on purpose: Punktemeldung, VNR and EFN appear verbatim on the
    // Anerkennungsbescheid and in the EIV-FOBI interface, and an operator
    // reconciling a screen against the paperwork needs the same token in both.
    nav: "Punktemeldungen",
    title: "Punktemeldungen",
    screenIntro:
      "Every Punktemeldung on this installation and its state. Sorted by deadline — the report whose statutory eight-day limit is nearest is at the top, not the newest one.",

    loadFailed: "The Punktemeldungen could not be loaded.",
    actionFailed: "The action failed.",

    filter: "Filter by status",
    statusAll: "All",
    status: {
      queued: "Queued",
      held: "Held back",
      submitted: "Reported",
      failed_retryable: "Retry scheduled",
      failed_permanent: "Permanently failed",
      window_closed: "Deadline passed",
      withdrawn: "Withdrawn",
    },

    participant: "EFN",
    course: "Course",
    status_: "Status",
    due: "Reporting deadline",
    attempts: "Attempts",
    vnr: "VNR",
    lastError: "Last error",
    dueNow: "Will be reported on the next sweep",

    dueTitle: "Reports due",
    dueBody: (count: number): string =>
      count === 1
        ? "One Punktemeldung will be sent to the Ärztekammer on the worker's next sweep."
        : `${String(count)} Punktemeldungen will be sent to the Ärztekammer on the worker's next sweep.`,

    empty: "No Punktemeldungen",
    emptyHint:
      "Once somebody completes a course and supplies their EFN, the report appears here.",

    requeue: "Queue again",
    withdraw: "Withdraw",
    withdrawConfirm: "Really withdraw?",
    withdrawCancel: "Cancel",
    withdrawFor: (efn: string): string => `Withdraw the Punktemeldung for ${efn}`,
    withdrawReason: "Withdrawn by an administrator",

    previous: "Back",
    next: "Next",
    pageOf: (page: number, last: number): string =>
      `Page ${String(page)} of ${String(last)}`,
  },

  eivCheck: {
    title: "Check the EIV connection",
    intro:
      "Uses this course's VNR and password to check that reporting to the Ärztekammer works — before the first participation has to be reported.",
    readOnly: "Nothing is reported and nothing is changed. Data is only read.",
    needsVnr:
      "No VNR is stored for this course yet. Enter the VNR and VNR password above and save, then the connection can be checked.",

    password: "VNR password (optional)",
    passwordHint:
      "Leave empty to check the stored password. A password entered here is used only for this check and is not saved — so a new password can be tested without overwriting the working one.",
    action: "Check connection",
    running: "Checking …",

    resultOk: "The EIV connection works. The Ärztekammer accepts this VNR and password.",
    resultAuthFailed:
      "The Ärztekammer rejected the VNR or the password. Please check both against the Anerkennungsbescheid.",
    resultUnreachable:
      "The credentials were accepted, but one of the queries failed. Details below — often the service is only temporarily unavailable.",

    endpoint: "Address checked",

    tierLabel: "System",
    tier: {
      mock: "The platform's own local test system — does not reach the Ärztekammer",
      test: "EIV's test system — reports land in no real register",
      live: "The Ärztekammer's live register — reports are binding",
      unknown: "Unrecognised address — treated as a live register",
    },

    submissionsLabel: "Punktemeldung",
    submissionsOn: "Armed — completed courses are reported",
    submissionsOff: "Switched off — nothing is reported",

    liveArmed:
      "This installation reports points bindingly to the Ärztekammer. " +
      "Every completed course files a real Punktemeldung against the " +
      "participant's own EFN.",

    reportedCount: "Participations already reported",
    passwordSource: "Password",
    passwordTyped: "entered here, not saved",

    eventTitle: "What the Ärztekammer holds for this VNR",
    eventName: "Event",
    eventCategory: "Category",
    eventPeriod: "Accreditation period",
    eventPoints: "Points",
    pointsValue: (attendance: number | null, assessment: number | null): string =>
      `Attendance ${attendance ?? "—"} · Lernerfolg ${assessment ?? "—"}`,
    lernerfolgMismatch:
      "This course reports the Lernerfolg point, but the Ärztekammer holds none for this VNR. A submission claiming it would be refused.",
    eventLocked:
      "This event is closed for reporting at the Ärztekammer. No further participation can be reported.",

    detailToggle: "Technical details",
    steps: {
      authenticate: "Sign in with VNR and password",
      event: "Read event data",
      reported: "Read points already reported",
    },
    stepOk: "succeeded",
    stepFailed: "failed",

    advice: {
      auth: "Check the VNR and password — both are on the Anerkennungsbescheid.",
      rate_limited: "Too many requests. Check again in a few minutes.",
      server: "EIV reported an error. Check again later.",
      network: "EIV was unreachable from this server. Check the network or the address.",
      business:
        "The Ärztekammer rejected the request on its merits. Please check the Anerkennungsbescheid.",
      format: "EIV's response was shaped unexpectedly. Please involve support.",
      unknown: "Unexpected error. The technical message is shown beside it.",
    },
  },

  courses: {
    title: "Courses",
    empty: "No courses are stored for this tenant.",
    emptyHint:
      "A course consists of modules, chapters and contents. You can create it now and extend it at any time.",
    columnTitle: "Title",
    columnVnr: "VNR",
    columnPoints: "Points",
    columnParticipants: "Participants",
    columnCertificate: "Certificate",
    certificateReady: "ready",
    certificateNotReady: "incomplete",
    columnActions: "Actions",
    delete: "Delete",
    deleteConfirm: "Really delete?",
    deleteAria: (title: string): string => `Delete course “${title}”`,
    lockedByEnrolments:
      "Cannot be deleted: participations have already been recorded. This data is the evidence for points already awarded.",
    deleteRule:
      "A course with no recorded participations can be deleted; one with participations cannot.",
  },

  course: {
    presentation: "Contents & presentation",
    presentationIntro:
      "These details appear in the course overview and on the course page.",
    title: "Course title",
    description: "Description",
    descriptionHint:
      "Appears on the course page under “Beschreibung der Fortbildung” and, shortened, on the overview card.",
    heroImageUrl: "Cover image (URL)",
    heroImageHint: "Shown beside the title and on the overview card.",
    deliveryType: "Format",
    deliveryOnDemand: "On demand",
    deliveryLive: "Live",
    deliveryPraesenz: "In person",
    thema: "Topic",
    altersgruppe: "Age group",
    onePerLine: "One entry per line.",
    onePerLineOrdered: "One entry per line, in the order you want.",
    learningObjectives: "Learning objectives",
    targetAudience: "Intended audience",
    targetAudienceHint: "Line breaks are preserved.",
    prerequisites: "Prior knowledge",
    prerequisitesHint:
      "Appears in the layout as its own paragraph under the intended audience. The application sets the label.",
    cmePoints: "CME points",
    cmePointsHint: "As stated in the Anerkennungsbescheid.",
    cmeCategory: "Category",
    fortbildungsnummer: "Course number",
    validFrom: "Accreditation valid from",
    validTo: "Accreditation valid until",
    validityHint: "From the Ärztekammer's Anerkennungsbescheid.",

    settings: "Settings",
    visibility: "Visibility",
    draftExplained:
      "This course is a draft. Participants do not see it — it does not appear in the catalogue and cannot be opened. New courses are always drafts until you publish them.",
    publishedExplained: "This course is published and visible to participants.",
    publish: "Publish",
    unpublish: "Retract (draft)",
    compliance: "Evidence rules",
    certificate: "Teilnahmebescheinigung",
    save: "Save",
    saving: "Saving …",
    saved: "Changes saved.",

    requiredWatchPercent: "Required share of video",
    requiredWatchHint:
      "The share of video content that has to have been watched. What is measured is time actually watched, not the furthest playback position — skipping ahead does not count.",

    passThresholdPercent: "Pass mark of the Lernerfolgskontrolle",
    passThresholdHint: "The share of correctly answered questions needed to pass.",
    accreditationConfirm:
      "I understand that this value contradicts the Anerkennungsbescheid.",

    notRetroactive:
      "Changes apply to new participations only. Participations already begun keep the values that were in force when they started.",

    organizer: "Organiser",
    eventLocation: "Location",
    accreditationBody: "Ärztekammer",
    scientificLeadTitle: "Title of the scientific lead",
    scientificLeadName: "Name of the scientific lead",
    certificateIssuePlace: "Place of issue",

    vnr: "VNR (event number)",
    vnrHint:
      "The event number issued by the Ärztekammer, from the Anerkennungsbescheid. Without it no Punktemeldung is submitted to EIV-FOBI for this course.",
    vnrMissing:
      "Without a VNR, completions are still recorded and certificates created, but no Punktemeldung is submitted.",

    vnrPassword: "VNR password",
    vnrPasswordHint:
      "Stored encrypted and never shown again. Leave empty to keep the stored password.",
    eivPunkte: "Points in the report",
    eivPunkteHint:
      "EIV reports the points for attendance and those for the Lernerfolgskontrolle separately. Which of them a course may claim is stated in the Anerkennungsbescheid — when in doubt, check with the Ärztekammer below.",
    eivPunkteBasis: "Points for attendance",
    eivPunkteLernerfolg: "Points for the Lernerfolgskontrolle",

    eivCheck: "Check with the Ärztekammer",
    eivCheckHint:
      "Asks EIV what is on file for this VNR. Nothing is reported and nothing is changed. The period matters most: EIV refuses a report whose participation date falls outside it.",
    eivCheckAction: "Fetch data",
    eivChecking: "Fetching …",
    eivCheckNeedsCredentials: "This needs both the VNR and the VNR password on file.",
    eivThema: "Topic",
    eivZeitraum: "Accredited period",
    eivKategorie: "Category",
    eivLocked:
      "The Ärztekammer has closed this event for reports. No further points will be credited.",
    eivLernerfolgMismatch:
      "This event has 0 points on file for the Lernerfolgskontrolle, but it is ticked above. EIV may therefore refuse the report.",

    vnrPasswordStored: "A password is stored.",
    vnrPasswordMissing: "No password is stored.",

    stamp: "Stamp of the scientific lead",
    signature: "Signature of the scientific lead",
    imageStored: "Stored",
    imageMissing: "Missing",
    imageHint:
      "PNG or JPEG, at most 512 KB. The Bescheid requires the scientific lead's stamp and signature on every certificate.",
    uploadImages: "Upload images",
    uploading: "Uploading …",

    missingForCertificate: "Still missing before a Teilnahmebescheinigung can be issued:",
    readyForCertificate: "This course can issue Teilnahmebescheinigungen.",
  },

  participantAccounts: {
    title: "Accounts",
    intro:
      "This customer's participants. Accounts are created here, passwords reset and accounts locked.",
    search: "Search",
    empty: "No participants yet.",
    emptyHint:
      "Create the first person with “Create account” — they can sign in to the course portal straight away.",
    create: "Create account",
    firstName: "First name",
    lastName: "Surname",
    email: "Email address",
    password: "Password",
    nameWhy:
      "First name and surname are required: the Teilnahmebescheinigung carries the name and cannot be issued without it.",
    reset: "Reset password",
    disable: "Lock",
    enable: "Unlock",
    active: "Active",
    disabled: "Locked",
    locked: "Temporarily locked",
    mustChange: "Password not yet changed",
    federated: "External sign-in",
    issuedTitle: "Password – visible only now",
    issuedBody:
      "This password is shown once and cannot be retrieved afterwards. Pass it to the person; at their first sign-in they have to choose their own. If it is lost, simply issue a new one.",
    copy: "Copy",
    copied: "Copied",
    dismiss: "Close",

    merge: "Merge accounts",
    mergeIntro:
      "When one person has two accounts — one through the customer's identity system and one for the course portal, say — this merges both onto one person. Every enrolment, certificate and the EFN move to the target account; the source account is deleted.",
    mergeIrreversible:
      "This action cannot be undone. Check both sides before you confirm.",
    mergeSource: "Source account (will be deleted)",
    mergeTarget: "Target account (will remain)",
    mergeCheck: "Check",
    mergeHasEfn: "EFN on file",
    mergeNoEfn: "no EFN",
    mergeCourses: "Enrolments",
    mergeNoCourses: "none",
    mergeAllowed: "The merge is possible. Confirm with the target account's ID.",
    mergeConfirmLabel: "Enter the target account's ID to confirm",
    mergeConfirm: "Merge permanently",
    mergeDone: "The accounts have been merged.",
  },

  participants: {
    title: "Participants",
    empty: "No participations are recorded for this course.",
    export: "Export as CSV",
    filterAll: "All",
    filterComplete: "Certified",
    filterAwaiting: "Awaiting certification",
    filterOpen: "In progress",
    filterAttention: "Check report",

    columnName: "Person",
    columnEmail: "Email",
    columnProgress: "Progress",
    columnWatched: "Video",
    columnQuiz: "Lernerfolgskontrolle",
    columnEvaluation: "Evaluation",
    columnEfn: "EFN",
    columnCourseComplete: "Course",
    columnComplete: "Certified",
    completedUndated: "completed",
    columnEiv: "Punktemeldung",
    columnCertificate: "Certificate",

    yes: "yes",
    no: "no",
    passed: "passed",
    notPassed: "open",

    attentionHint:
      "These reports could not be submitted after the automatic retries. The Ärztekammer accepts a report by original attendance list in justified exceptional cases — the deadline is 8 days from participation.",

    eiv: {
      none: "none",
      queued: "queued",
      submitted: "reported",
      failed: "failed",
      needs_attention: "check",
      abandoned: "abandoned",
      withdrawn: "withdrawn",
    },

    certificate: {
      none: "none",
      pending: "pending",
      issued: "issued",
      delivered: "delivered",
      bounced: "undeliverable",
    },
  },
};
