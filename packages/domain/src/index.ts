/**
 * @ds/domain — the pure compliance core.
 *
 * Everything that decides whether a physician earns a CME point lives here,
 * and nothing else does. Zero dependencies, zero I/O, zero ambient time, zero
 * randomness — enforced by `purity.test.ts`.
 */

export {
  courseAvailability,
  invalidAvailabilityWindow,
  isCourseOffered,
} from "./availability.js";
export type {
  AvailabilityWindow,
  CourseAvailability,
  CourseStatus,
} from "./availability.js";

export {
  joinUrl,
  lastWhitespaceIndex,
  stripTrailing,
  stripTrailingSlashes,
} from "./url.js";

export type {
  ChapterNode,
  ContentKind,
  ContentNode,
  ContentProgressRecord,
  ContentStatus,
  CourseNode,
  EnrolmentSnapshot,
  ModuleNode,
} from "./types.js";

/*
 * `creditedDurationSec` and `TAIL_GRACE_SEC` are deliberately **not** here.
 *
 * They are the tail grace (P93-01), and every rule that has to know about them
 * — `watchedPercent`, `watchedSecondsWithin`, `uncoveredSpans`,
 * `courseWatchCoverage`, `watchedCoverageBars` — already applies them inside
 * this package. Exporting them would put a second way to reach the same
 * arithmetic one import away from an API or a screen, which is how §4
 * invariant 6 gets broken and how P68-02 happened: two callers of the same
 * number that stopped agreeing. `scripts/unused-rules.mjs` says the same thing
 * from the other direction — it reported both as exported and uncalled.
 */
export {
  isSeekAllowed,
  maxWatchedPosition,
  mergeWatchedSegments,
  validateSegments,
  watchedPercent,
  uncoveredSpans,
  watchedSecondsWithin,
} from "./watch.js";
export type {
  RejectedSegment,
  SegmentRejectionReason,
  SegmentValidationOptions,
  SegmentValidationResult,
  WatchedSegment,
} from "./watch.js";

export {
  embedOriginAllowed,
  invalidEmbedOriginPatterns,
  isEmbedOriginPattern,
} from "./embed-origin.js";

export { evaluateGate, evaluateSequence } from "./gating.js";
export type { GateReason, GateResult, GateStatus, GatingItem } from "./gating.js";
export { contentGates } from "./module-quiz.js";

export { courseWatchCoverage } from "./coverage.js";
export type { ContentSegments, WatchCoverage } from "./coverage.js";

export {
  hasAdaptiveSource,
  MEDIA_MIME_TYPES,
  mediaSourceProblems,
  mimeTypeForUrl,
  orderSources,
  parseMediaSources,
  streamingKindOf,
} from "./media.js";
export type {
  MediaSource,
  MediaSourceDraft,
  MediaSourceProblem,
  StreamingKind,
} from "./media.js";

export {
  bufferedBars,
  clampVolume,
  coverageBars,
  nextPlaybackRate,
  nudgePositionSec,
  PLAYBACK_RATES,
  positionFraction,
  remainingSec,
  SEEK_JUMP_SEC,
  SEEK_STEP_SEC,
  seekFraction,
  seekPositionSec,
  VOLUME_STEP,
  watchedCoverageBars,
} from "./playback.js";
export type { CoverageBar } from "./playback.js";

export {
  brandingCssVariables,
  fontFaceRule,
  invalidBrandingFields,
  parseBranding,
} from "./branding.js";
export type { Branding } from "./branding.js";

export {
  canDelete,
  deletionVerdict,
  questionRemoval,
  contentProblems,
  correctOptionCount,
  questionProblems,
  validateReorder,
  MIN_QUIZ_OPTIONS,
} from "./authoring.js";
export type {
  ChildCensus,
  ContentDraft,
  ContentProblem,
  DeletionVerdict,
  HierarchyLevel,
  QuestionRemoval,
  OrderedKind,
  QuestionDraft,
  QuestionProblem,
  ReorderRejection,
  ReorderResult,
} from "./authoring.js";

export { sniffFontFormat } from "./font-file.js";
export type { FontFormat, FontRejection, FontSniffResult } from "./font-file.js";

export {
  awardsCmePoints,
  describePublishBlockers,
  publishBlockers,
} from "./publishing.js";
export type { PublishBlocker, PublishCandidate } from "./publishing.js";

export {
  certificateArchiveKey,
  courseAssetKey,
  customerPrefix,
  InvalidStorageKeyError,
  isStorageReference,
  keyBelongsToCustomer,
  storageKeyOf,
} from "./storage-key.js";

export { isWebVtt, looksLikeSrt, srtToVtt } from "./subtitles.js";
export type { SubtitleConversion } from "./subtitles.js";

export {
  InvalidUploadTokenError,
  planUpload,
  UPLOAD_MAX_BYTES,
  planMultipart,
  partRange,
  MULTIPART_PART_BYTES,
  MULTIPART_MAX_PARTS,
  MULTIPART_THRESHOLD_BYTES,
  UPLOAD_TYPES,
  uploadObjectName,
} from "./upload.js";
export type {
  AcceptedUploadType,
  MultipartPlan,
  UploadPlan,
  UploadPurpose,
  UploadRejection,
} from "./upload.js";

export { courseChapterSequence, rollupProgress } from "./progress.js";
export type { CourseRollup, ModuleCompletion, ProgressSummary } from "./progress.js";

export {
  mayRevealCorrectAnswers,
  minimumCorrectAnswers,
  scoreQuiz,
  UnknownQuestionError,
} from "./assessment.js";
export type { Answer, Question, QuestionKind, QuizResult } from "./assessment.js";

export {
  CORRECTION_WINDOW_DAYS,
  eivDeadlines,
  isPlaceholderVnr,
  isValidEfn,
  PLACEHOLDER_VNR,
  REPORTING_WINDOW_DAYS,
} from "./eiv.js";

export { alertLevelFor, dueAlerts } from "./eiv-alert.js";
export type { EivAlert, EivAlertCandidate, EivAlertLevel } from "./eiv-alert.js";
export type { EivDeadlineInput, EivDeadlines, EivPhase } from "./eiv.js";

export { MAX_ATTEMPTS, planEivAttempt, RETRY_INTERVAL_MINUTES } from "./eiv-retry.js";
export type {
  EivAbandonReason,
  EivAction,
  EivAttemptFailure,
  EivAttemptInput,
  EivAttemptPlan,
} from "./eiv-retry.js";

export { planCredentialMerge } from "./credential-merge.js";
export type { MergePlan, MergeRefusal, MergeSide } from "./credential-merge.js";

export { isCourseComplete } from "./completion.js";
export type {
  CompletionCondition,
  CompletionInput,
  CompletionResult,
} from "./completion.js";

export {
  buildCertificateData,
  creditSentence,
  missingCertificateFields,
} from "./certificate.js";
export type {
  CertificateData,
  CertificateField,
  CertificateInput,
} from "./certificate.js";

export {
  addCalendarDays,
  berlinDateOf,
  endOfBerlinDay,
  formatBerlinDate,
  formatBerlinIsoDate,
  formatBerlinDateTime,
  formatBerlinTime,
  BerlinFormatError,
} from "./berlin.js";
export type { BerlinDate } from "./berlin.js";

export { resolveTenantContext } from "./authorization.js";
export type {
  AppRole,
  RoleGrant,
  TenantDenialReason,
  TenantResolution,
  TenantResolutionResult,
} from "./authorization.js";

export { clockTime, germanDuration, germanMinutesAndSeconds } from "./duration.js";

export {
  backoffMinutes,
  planDeliveryAttempt,
  DELIVERY_BACKOFF_MINUTES,
  MAX_DELIVERY_ATTEMPTS,
} from "./delivery-retry.js";
export type {
  DeliveryAbandonReason,
  DeliveryAction,
  DeliveryAttemptInput,
  DeliveryFailure,
  DeliveryPlan,
} from "./delivery-retry.js";

/**
 * Staff identity (ADR-0012). The rules deciding who may sign in to the admin
 * console, stay signed in, and create other accounts.
 */
export {
  canGrant,
  canManage,
  capabilitiesOf,
  checkPassword,
  INVITE_VALID_DAYS,
  inviteStatus,
  LOCKOUT_MINUTES,
  lockoutStatus,
  MAX_FAILED_ATTEMPTS,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  RESET_VALID_MINUTES,
  resetStatus,
  secondFactorStep,
  applicableSecondFactorPolicy,
  governingSecondFactorScopes,
  canRemoveOwnSecondFactor,
  canResetSecondFactorOf,
  DEFAULT_CUSTOMER_SECOND_FACTOR,
  DEFAULT_PLATFORM_SECOND_FACTOR,
  SESSION_ABSOLUTE_HOURS,
  SESSION_IDLE_MINUTES,
  sessionStatus,
} from "./staff-identity.js";
export type {
  GrantCheck,
  GrantDenial,
  ManagedEntity,
  InviteState,
  InviteVerdict,
  LockoutState,
  LockoutVerdict,
  PasswordCheck,
  PasswordContext,
  PasswordRejection,
  SecondFactorOutcome,
  SecondFactorPolicy,
  SessionInvalidReason,
  SessionState,
  SessionVerdict,
  StaffRole,
  StaffScope,
} from "./staff-identity.js";

export {
  totpCounters,
  verifyTotp,
  TOTP_DIGITS,
  TOTP_DRIFT_STEPS,
  TOTP_STEP_SEC,
} from "./totp.js";
export type { TotpRejection, TotpVerdict } from "./totp.js";

export { punktemeldungOutcome } from "./punktemeldung.js";
export type {
  PunktemeldungActor,
  PunktemeldungInput,
  PunktemeldungKind,
  PunktemeldungOutcome,
} from "./punktemeldung.js";

export {
  certificateAction,
  efnRefresh,
  maskEfn,
  nameCorrection,
  subjectErasure,
  submissionStage,
} from "./moderation.js";
export type {
  CertificateAction,
  CertificateActionVerdict,
  CertificateStatus,
  EfnRefreshVerdict,
  ErasureVerdict,
  NameCorrectionVerdict,
  SubmissionStage,
} from "./moderation.js";

export { composeAttestedName, NAME_PART_MAX_LENGTH } from "./attested-name.js";
export type {
  AttestedNameParts,
  AttestedNameProblem,
  AttestedNameResult,
} from "./attested-name.js";

export { configValue } from "./runtime-config.js";
export type { RuntimeConfig } from "./runtime-config.js";

export {
  clampSeekToLimit,
  playerSeekLimit,
  RESUME_GRANULARITY_SEC,
  resumePosition,
  seekCeiling,
} from "./resume.js";
export type { ResumeInput } from "./resume.js";

export {
  applyCopyOverrides,
  copyDefaultAt,
  copyKeysOf,
  COPY_MAX_LENGTH,
  invalidCopyKeys,
  parseCopyOverrides,
} from "./copy.js";
export type { CopyOverrides, CopyRejection, RejectedCopy } from "./copy.js";

export { lengthsAgree, mediaLengthVerdict } from "./gate-reachability.js";
export type { MediaLengthInput, MediaLengthVerdict } from "./gate-reachability.js";
