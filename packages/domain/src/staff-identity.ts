/**
 * The rules governing a staff account (P12-01), implementing ADR-0012.
 *
 * Everything here decides whether somebody may sign in, stay signed in, or
 * create another account. That makes it a compliance decision in exactly the
 * sense `CLAUDE.md` §4 invariant 4 means — a wrong answer hands one customer's
 * administrator the participation records of another's physicians — so it lives
 * in this package, pure and exhaustively tested, rather than inside a NestJS
 * service where it would be reachable only through HTTP.
 *
 * Pure in the strict sense the package requires: no clock, no randomness, no
 * hashing. `now` is always an argument. Password *hashing* is deliberately not
 * here — Argon2id is I/O-bound native work and belongs in the API — but every
 * decision *about* a password is, including the one that matters most, which is
 * when to stop accepting attempts.
 *
 * ## What is deliberately not modelled
 *
 * There is no "password strength score". Composition rules (a digit, a symbol,
 * mixed case) push people towards `Passwort1!` and are worse than a length
 * floor; NIST SP 800-63B has said so since 2017 and the BSI's own guidance
 * followed. The floor here is length plus a denylist check the caller supplies,
 * which is the pair that actually correlates with resistance to guessing.
 */

export type StaffRole = "super_admin" | "customer_admin" | "department_admin";

/** Ordered by breadth of access. The index is the comparison, nothing else. */
const ROLE_RANK: readonly StaffRole[] = [
  "department_admin",
  "customer_admin",
  "super_admin",
];

function rank(role: StaffRole): number {
  return ROLE_RANK.indexOf(role);
}

// ---------------------------------------------------------------------------
// Passwords
// ---------------------------------------------------------------------------

/**
 * Twelve, not eight.
 *
 * These accounts can read every physician's participation record for a
 * customer, and a super admin's can read every customer's. Eight characters is
 * the floor for an account whose compromise costs the account holder; this one
 * costs several thousand people who never chose it.
 */
export const MIN_PASSWORD_LENGTH = 12;

/**
 * Upper bound, because Argon2id will hash whatever it is given and a
 * megabyte-long password is a denial-of-service vector, not a security
 * improvement.
 */
export const MAX_PASSWORD_LENGTH = 256;

export type PasswordRejection =
  "too_short" | "too_long" | "too_common" | "contains_identifier";

export type PasswordCheck =
  { readonly ok: true } | { readonly ok: false; readonly reason: PasswordRejection };

export interface PasswordContext {
  /** The account's email and name — a password containing them is guessable. */
  readonly identifiers: readonly string[];
  /**
   * Whether this password appears in a breach corpus. Supplied by the caller
   * because the corpus is I/O; the *decision* to refuse it is here.
   */
  readonly knownBreached?: boolean;
}

/**
 * Whether a proposed password may be accepted.
 *
 * Length is measured in code points, not UTF-16 units: "😀" is one character to
 * the person typing it, and counting it as two would make a passphrase of
 * emoji pass a length check it should not, or fail one it should.
 */
export function checkPassword(password: string, context: PasswordContext): PasswordCheck {
  const codePoints = [...password].length;

  if (codePoints < MIN_PASSWORD_LENGTH) return { ok: false, reason: "too_short" };
  if (codePoints > MAX_PASSWORD_LENGTH) return { ok: false, reason: "too_long" };
  if (context.knownBreached === true) return { ok: false, reason: "too_common" };

  // An account whose password contains its own email local part is one
  // credential-stuffing list away from open.
  const lowered = password.toLowerCase();
  for (const identifier of context.identifiers) {
    const trimmed = identifier.trim().toLowerCase();
    // Short fragments match by accident; "ha" is in half the dictionary.
    if (trimmed.length >= 4 && lowered.includes(trimmed)) {
      return { ok: false, reason: "contains_identifier" };
    }
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Lockout
// ---------------------------------------------------------------------------

/** Attempts before an account stops accepting passwords at all. */
export const MAX_FAILED_ATTEMPTS = 10;

/** How long a locked account stays locked. */
export const LOCKOUT_MINUTES = 15;

export interface LockoutState {
  readonly failedAttempts: number;
  /** When the counter last moved. `null` for an account that has never failed. */
  readonly lastFailureAt: Date | null;
}

export type LockoutVerdict =
  | { readonly locked: false; readonly attemptsRemaining: number }
  | { readonly locked: true; readonly until: Date };

/**
 * Whether this account may be offered a password check right now.
 *
 * Time-based expiry rather than an administrator having to unlock: a lockout
 * that needs a human to clear it turns a forgotten password into a support
 * ticket, and turns a trivially-mounted attack into a denial of service against
 * the person being attacked.
 *
 * The window is measured from the **last** failure, so a patient attacker
 * cannot drip one attempt every fourteen minutes and never trip it: each
 * failure moves the window forward.
 */
export function lockoutStatus(state: LockoutState, now: Date): LockoutVerdict {
  if (state.failedAttempts < MAX_FAILED_ATTEMPTS || state.lastFailureAt === null) {
    return {
      locked: false,
      attemptsRemaining: Math.max(0, MAX_FAILED_ATTEMPTS - state.failedAttempts),
    };
  }

  const until = new Date(state.lastFailureAt.getTime() + LOCKOUT_MINUTES * 60_000);
  if (now.getTime() >= until.getTime()) {
    // The window has passed. The counter is not reset here — that is the
    // caller's write — but the account is answerable again.
    return { locked: false, attemptsRemaining: 1 };
  }

  return { locked: true, until };
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

/**
 * A session dies twelve hours after it was created, whatever happens.
 *
 * Long enough for a working day so an author does not lose a half-built course
 * to a re-login; short enough that a session cookie taken from a machine
 * someone walked away from is not usable the next morning.
 */
export const SESSION_ABSOLUTE_HOURS = 12;

/** …and thirty minutes after the last request, whichever comes first. */
export const SESSION_IDLE_MINUTES = 30;

export interface SessionState {
  readonly createdAt: Date;
  readonly lastSeenAt: Date;
  /** Set when the session was explicitly ended or the account disabled. */
  readonly revokedAt: Date | null;
}

export type SessionVerdict =
  | { readonly valid: true; readonly expiresAt: Date }
  | { readonly valid: false; readonly reason: SessionInvalidReason };

export type SessionInvalidReason = "revoked" | "idle_timeout" | "absolute_timeout";

/**
 * Whether a presented session is still good, and when it next expires.
 *
 * Both limits, not one. An idle timeout alone lets a session live for ever
 * under a script that pings it; an absolute timeout alone leaves an abandoned
 * browser signed in all day. The reason is returned rather than a bare `false`
 * because "your session timed out" and "your access was withdrawn" are
 * different things to tell somebody, and only one of them means try again.
 */
export function sessionStatus(state: SessionState, now: Date): SessionVerdict {
  if (state.revokedAt !== null && state.revokedAt.getTime() <= now.getTime()) {
    return { valid: false, reason: "revoked" };
  }

  const absolute = state.createdAt.getTime() + SESSION_ABSOLUTE_HOURS * 3_600_000;
  const idle = state.lastSeenAt.getTime() + SESSION_IDLE_MINUTES * 60_000;

  if (now.getTime() >= absolute) return { valid: false, reason: "absolute_timeout" };
  if (now.getTime() >= idle) return { valid: false, reason: "idle_timeout" };

  return { valid: true, expiresAt: new Date(Math.min(absolute, idle)) };
}

// ---------------------------------------------------------------------------
// Second factor
// ---------------------------------------------------------------------------

/**
 * Whether this role must present a second factor.
 *
 * Required for `super_admin` and optional below (ADR-0012). A super
 * administrator can act inside any customer, so their credential is the one
 * whose theft is worth the most — and unlike a customer administrator's, there
 * is nobody above them to notice.
 */
export function requiresSecondFactor(role: StaffRole): boolean {
  return role === "super_admin";
}

/**
 * Whether sign-in may complete.
 *
 * `enrolled` and `required` are separate on purpose. An account that must have
 * a second factor but has not set one up yet cannot simply be let in, and
 * cannot simply be refused either — it would be unrecoverable. It is sent to
 * enrolment, which is a third outcome and needs its own name.
 */
export type SecondFactorOutcome = "not_required" | "required" | "must_enrol";

export function secondFactorStep(
  role: StaffRole,
  enrolled: boolean,
): SecondFactorOutcome {
  if (enrolled) return "required";
  return requiresSecondFactor(role) ? "must_enrol" : "not_required";
}

// ---------------------------------------------------------------------------
// Who may create or change whom
// ---------------------------------------------------------------------------

export interface StaffScope {
  readonly role: StaffRole;
  /** `null` for a super admin, who is not confined to one customer. */
  readonly customerId: string | null;
  readonly departmentId: string | null;
}

export type GrantDenial =
  "outside_customer" | "outside_department" | "role_too_broad" | "self_escalation";

export type GrantCheck =
  { readonly ok: true } | { readonly ok: false; readonly reason: GrantDenial };

/**
 * Whether `actor` may create or modify an account with `target`'s scope.
 *
 * Three rules, and the third is the one that is easy to leave out:
 *
 * 1. You cannot reach outside your own customer (or department).
 * 2. You cannot grant a role broader than your own — otherwise a customer
 *    administrator mints a super administrator and the hierarchy is decoration.
 * 3. You cannot grant a role **equal** to your own to yourself, which is the
 *    same rule stated for the case people forget: privilege escalation by
 *    self-edit. Editing one's own account is allowed; changing one's own scope
 *    is not.
 */
export function canGrant(
  actor: StaffScope,
  target: StaffScope,
  options: { readonly targetIsSelf: boolean } = { targetIsSelf: false },
): GrantCheck {
  if (rank(target.role) > rank(actor.role)) {
    return { ok: false, reason: "role_too_broad" };
  }

  if (options.targetIsSelf && rank(target.role) >= rank(actor.role)) {
    // Not "no change" — an unchanged self-edit never reaches here, because the
    // caller only asks about a scope that differs.
    return { ok: false, reason: "self_escalation" };
  }

  // A super admin has no customer of their own and is confined by nothing.
  if (actor.role === "super_admin") return { ok: true };

  if (actor.customerId === null || target.customerId !== actor.customerId) {
    return { ok: false, reason: "outside_customer" };
  }

  if (actor.role === "department_admin") {
    if (actor.departmentId === null || target.departmentId !== actor.departmentId) {
      return { ok: false, reason: "outside_department" };
    }
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------

/**
 * How long an invitation stays open.
 *
 * Seven days: long enough to survive a holiday, short enough that an invitation
 * forwarded to the wrong address is not a standing offer.
 */
export const INVITE_VALID_DAYS = 7;

export interface InviteState {
  readonly createdAt: Date;
  readonly acceptedAt: Date | null;
  readonly revokedAt: Date | null;
}

export type InviteVerdict = "valid" | "expired" | "already_accepted" | "revoked";

export function inviteStatus(state: InviteState, now: Date): InviteVerdict {
  if (state.acceptedAt !== null) return "already_accepted";
  if (state.revokedAt !== null && state.revokedAt.getTime() <= now.getTime()) {
    return "revoked";
  }

  const expiresAt = state.createdAt.getTime() + INVITE_VALID_DAYS * 86_400_000;
  return now.getTime() >= expiresAt ? "expired" : "valid";
}

/**
 * How long a password-reset link stays usable.
 *
 * Much shorter than an invitation. An invitation is an offer to somebody who
 * does not yet have an account; a reset link is a live bypass of the password
 * on an account that already exists, sitting in an inbox.
 */
export const RESET_VALID_MINUTES = 60;

export function resetStatus(state: InviteState, now: Date): InviteVerdict {
  if (state.acceptedAt !== null) return "already_accepted";
  if (state.revokedAt !== null && state.revokedAt.getTime() <= now.getTime()) {
    return "revoked";
  }

  const expiresAt = state.createdAt.getTime() + RESET_VALID_MINUTES * 60_000;
  return now.getTime() >= expiresAt ? "expired" : "valid";
}
