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

export {
  isSeekAllowed,
  maxWatchedPosition,
  mergeWatchedSegments,
  validateSegments,
  watchedPercent,
  watchedSecondsWithin,
  watchedSeconds,
} from "./watch.js";
export type {
  RejectedSegment,
  SegmentRejectionReason,
  SegmentValidationOptions,
  SegmentValidationResult,
  WatchedSegment,
} from "./watch.js";

export { evaluateGate, evaluateSequence } from "./gating.js";
export type { GateReason, GateResult, GateStatus, GatingItem } from "./gating.js";

export { courseWatchCoverage } from "./coverage.js";
export type { ContentSegments, WatchCoverage } from "./coverage.js";

export {
  hasAdaptiveSource,
  MEDIA_MIME_TYPES,
  mediaSourceProblems,
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
  UPLOAD_TYPES,
  uploadObjectName,
} from "./upload.js";
export type {
  AcceptedUploadType,
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
  isValidEfn,
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

export {
  certificateAction,
  maskEfn,
  nameCorrection,
  subjectErasure,
} from "./moderation.js";
export type {
  CertificateAction,
  CertificateActionVerdict,
  CertificateStatus,
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
  clampSeek,
  clampSeekToLimit,
  playerSeekLimit,
  RESUME_GRANULARITY_SEC,
  resumePosition,
  seekCeiling,
} from "./resume.js";
export type { ResumeInput } from "./resume.js";
