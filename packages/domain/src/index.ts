/**
 * @ds/domain — the pure compliance core.
 *
 * Everything that decides whether a physician earns a CME point lives here,
 * and nothing else does. Zero dependencies, zero I/O, zero ambient time, zero
 * randomness — enforced by `purity.test.ts`.
 */

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
  brandingCssVariables,
  fontFaceRule,
  invalidBrandingFields,
  parseBranding,
} from "./branding.js";
export type { Branding } from "./branding.js";

export { sniffFontFormat } from "./font-file.js";
export type { FontFormat, FontRejection, FontSniffResult } from "./font-file.js";

export {
  courseAssetKey,
  customerPrefix,
  InvalidStorageKeyError,
  isStorageReference,
  keyBelongsToCustomer,
  storageKeyOf,
} from "./storage-key.js";

export { courseChapterSequence, rollupProgress } from "./progress.js";
export type { CourseRollup, ModuleCompletion, ProgressSummary } from "./progress.js";

export { scoreQuiz, UnknownQuestionError } from "./assessment.js";
export type { Answer, Question, QuestionKind, QuizResult } from "./assessment.js";

export {
  CORRECTION_WINDOW_DAYS,
  eivDeadlines,
  isValidEfn,
  REPORTING_WINDOW_DAYS,
} from "./eiv.js";
export type { EivDeadlineInput, EivDeadlines, EivPhase } from "./eiv.js";

export { MAX_ATTEMPTS, planEivAttempt, RETRY_INTERVAL_MINUTES } from "./eiv-retry.js";
export type {
  EivAbandonReason,
  EivAction,
  EivAttemptFailure,
  EivAttemptInput,
  EivAttemptPlan,
} from "./eiv-retry.js";

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

export { addCalendarDays, berlinDateOf, endOfBerlinDay } from "./berlin.js";
export type { BerlinDate } from "./berlin.js";

export { resolveTenantContext } from "./authorization.js";
export type {
  AppRole,
  RoleGrant,
  TenantDenialReason,
  TenantResolution,
  TenantResolutionResult,
} from "./authorization.js";
