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

export type StaffRole =
  "super_admin" | "customer_admin" | "department_admin" | "course_editor";

/** Ordered by breadth of access. The index is the comparison, nothing else. */
const ROLE_RANK: readonly StaffRole[] = [
  "course_editor",
  "department_admin",
  "customer_admin",
  "super_admin",
];

/**
 * What a role may *do*, as distinct from where it may do it.
 *
 * Scope and capability are different axes and conflating them is what made the
 * first cut of this model wrong. A `course_editor` and a `department_admin` can
 * both be confined to one department — same scope — but only one of them may
 * create a project inside it. Ranking alone cannot express that: it says who
 * outranks whom, not who may create what.
 *
 * So capability is a table, and it is exhaustive by construction — a new role
 * without an entry here fails to compile rather than silently inheriting
 * somebody else's permissions.
 */
export type ManagedEntity =
  | "customer"
  | "department"
  | "project"
  | "course"
  | "content"
  | "staff_user"
  | "learner_record"
  | "certificate";

const CAPABILITIES: Readonly<Record<StaffRole, readonly ManagedEntity[]>> = {
  // Everything, everywhere. The only role that may create a customer, because
  // a customer is the tenant boundary itself — nobody inside one may mint
  // another.
  super_admin: [
    "customer",
    "department",
    "project",
    "course",
    "content",
    "staff_user",
    "learner_record",
    "certificate",
  ],

  // The customer's own administrator: builds out their organisation and
  // everything under it, and manages their own staff. Cannot create customers.
  customer_admin: [
    "department",
    "project",
    "course",
    "content",
    "staff_user",
    "learner_record",
    "certificate",
  ],

  // Runs one department: projects and courses within it, and the people who
  // take them. Not staff management — inviting colleagues is the customer
  // administrator's job, and a department admin who could invite could invite
  // themselves into a second department.
  department_admin: ["project", "course", "content", "learner_record", "certificate"],

  // Authors. The role the specification asks for in as many words: "customer
  // users who can create only courses, so they have limited access". They make
  // courses and the content inside them and nothing else — no structure above,
  // no people, no certificates. An agency writing content for a customer gets
  // this and cannot reorganise the customer around it.
  course_editor: ["course", "content"],
};

/** Whether this role may create, edit or delete entities of this kind at all. */
export function canManage(role: StaffRole, entity: ManagedEntity): boolean {
  return CAPABILITIES[role].includes(entity);
}

/** Every entity this role may manage — what the console builds its menu from. */
export function capabilitiesOf(role: StaffRole): readonly ManagedEntity[] {
  return CAPABILITIES[role];
}

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
  for (const identifier of expandIdentifiers(context.identifiers)) {
    // Short fragments match by accident; "ha" is in half the dictionary.
    if (identifier.length >= 4 && lowered.includes(identifier)) {
      return { ok: false, reason: "contains_identifier" };
    }
  }

  return { ok: true };
}

/**
 * Each identifier, plus the part of an address before the `@`.
 *
 * The comment above has always said this function catches "its own email local
 * part", and until P21-04 it did not: it compared against the *whole* address,
 * so `anna.schmidt@praxis.de` as an identifier rejected a password containing
 * `anna.schmidt@praxis.de` and accepted one containing `anna.schmidt`. Nobody
 * puts their full address in a password. Everybody puts their name in one.
 *
 * Found by an integration test on the participant path, and it was never a
 * learner-only weakness — `checkPassword` is the platform's single password
 * policy, so the staff plane, whose accounts can read every physician's record
 * for a customer, had exactly the same hole.
 *
 * The domain is a set, so a name that happens to equal a local part costs one
 * comparison rather than two.
 */
function expandIdentifiers(identifiers: readonly string[]): ReadonlySet<string> {
  const expanded = new Set<string>();

  for (const identifier of identifiers) {
    const trimmed = identifier.trim().toLowerCase();
    if (trimmed === "") continue;
    expanded.add(trimmed);

    const at = trimmed.indexOf("@");
    if (at > 0) expanded.add(trimmed.slice(0, at));
  }

  return expanded;
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
 * What an operator's scope says about the second factor (P22-02).
 *
 * Configurable, where it used to be `role === "super_admin"` and nothing else.
 * The three values are genuinely three, not a boolean with a maybe:
 *
 * | `disabled` | Not offered, and an already-enrolled secret is not asked for. |
 * | `optional` | Enrol if you want to; if you have, you must use it.          |
 * | `required` | Everyone enrols, and is sent to enrolment if they have not.  |
 *
 * `optional` is not "off". An account that *has* a factor is always asked for
 * it, because a policy change must never make a stolen password sufficient for
 * somebody who had already protected themselves. Turning it off for such an
 * account is `disabled`, which is a deliberate, audited, different choice.
 */
export type SecondFactorPolicy = "disabled" | "optional" | "required";

/**
 * The policy a `super_admin` gets unless somebody deliberately changes it.
 *
 * ADR-0012's reasoning has not stopped being true: a super administrator can
 * act inside any customer, so their credential is the one whose theft is worth
 * the most, and unlike a customer administrator's there is nobody above them to
 * notice. What changed is that this is now a *default* rather than a law —
 * the request was for it to be configurable, and a policy nobody can change is
 * not a policy.
 *
 * It is still the strictest default in the platform, and weakening it is a
 * super administrator's own decision, recorded in `admin_audit_log`.
 */
export const DEFAULT_PLATFORM_SECOND_FACTOR: SecondFactorPolicy = "required";

/** What a customer's operators get until that customer's policy is set. */
export const DEFAULT_CUSTOMER_SECOND_FACTOR: SecondFactorPolicy = "optional";

const STRICTNESS: Record<SecondFactorPolicy, number> = {
  disabled: 0,
  optional: 1,
  required: 2,
};

/**
 * The policy that applies to an account holding these grants.
 *
 * **The strictest of the scopes they can reach**, and that direction is the
 * whole point. An operator who can act inside a customer that requires a second
 * factor must present one — otherwise the customer's policy would be worth
 * nothing the moment somebody held a grant somewhere more relaxed as well, and
 * an attacker's first move would be to find that somewhere.
 *
 * A grant with no customer is a `super_admin`: they belong to no customer, so
 * the *platform* policy is their scope. It is passed separately rather than
 * looked up under a null key, because "the platform's own setting" and "some
 * customer's setting" are different things that happen to be the same shape.
 *
 * An account with no grants at all gets the platform policy. They can reach
 * nothing, so the value hardly matters — but defaulting to the strictest thing
 * available is the right way to be wrong.
 */
export function applicableSecondFactorPolicy(
  grants: readonly { readonly customerId: string | null }[],
  platform: SecondFactorPolicy,
  perCustomer: ReadonlyMap<string, SecondFactorPolicy>,
): SecondFactorPolicy {
  if (grants.length === 0) return platform;

  let strictest: SecondFactorPolicy = "disabled";
  for (const grant of grants) {
    const policy =
      grant.customerId === null
        ? platform
        : (perCustomer.get(grant.customerId) ?? DEFAULT_CUSTOMER_SECOND_FACTOR);
    if (STRICTNESS[policy] > STRICTNESS[strictest]) strictest = policy;
  }
  return strictest;
}

/**
 * *Which* scopes produced that answer (P74-01).
 *
 * `applicableSecondFactorPolicy` says what the rule is. This says where it
 * comes from, and the difference is the difference between a screen that tells
 * somebody to change a rule and a screen that tells them **which** rule to
 * change.
 *
 * The reported version: the Sicherheit screen draws a platform row and a
 * customer row, says "stellen Sie zuerst oben die Regel auf „Freigestellt“",
 * and names neither. An operator whose account is governed by the platform row
 * relaxes the customer row, nothing changes, and the screen has no more to say.
 * That is CLAUDE.md §9.4 — the action is possible and the screen does not say
 * where.
 *
 * Every scope at the strictest level is returned, not the first one: two
 * customers can both say `required`, and relaxing one of them leaves the
 * account exactly where it was. A caller that showed only the first would send
 * somebody round the loop a second time.
 *
 * `null` is the platform scope, the same encoding `applicable…` takes and the
 * same one the policy table uses for its own row.
 */
export function governingSecondFactorScopes(
  grants: readonly { readonly customerId: string | null }[],
  platform: SecondFactorPolicy,
  perCustomer: ReadonlyMap<string, SecondFactorPolicy>,
): readonly (string | null)[] {
  const applicable = applicableSecondFactorPolicy(grants, platform, perCustomer);
  // No grants: `applicable…` answers with the platform policy, so the platform
  // is where it came from. Deriving it here rather than special-casing above
  // keeps the two functions answering about the same thing.
  if (grants.length === 0) return [null];

  const scopes: (string | null)[] = [];
  for (const grant of grants) {
    const policy =
      grant.customerId === null
        ? platform
        : (perCustomer.get(grant.customerId) ?? DEFAULT_CUSTOMER_SECOND_FACTOR);
    // Two grants can name the same customer — one per department — and the
    // scope is the customer, so it is listed once.
    if (policy === applicable && !scopes.includes(grant.customerId)) {
      scopes.push(grant.customerId);
    }
  }
  return scopes;
}

/**
 * Whether sign-in may complete.
 *
 * `enrolled` and `required` are separate on purpose. An account that must have
 * a second factor but has not set one up yet cannot simply be let in, and
 * cannot simply be refused either — it would be unrecoverable. It is sent to
 * enrolment, which is a third outcome and needs its own name.
 *
 * Note the order of the two checks. Under `optional`, being enrolled wins:
 * having a factor means being asked for it. Under `disabled` it does not, and
 * that asymmetry is deliberate — `disabled` is how an operator whose device is
 * gone is let back in, so it has to override an enrolment that still exists in
 * the row.
 */
export type SecondFactorOutcome = "not_required" | "required" | "must_enrol";

export function secondFactorStep(
  policy: SecondFactorPolicy,
  enrolled: boolean,
): SecondFactorOutcome {
  if (policy === "disabled") return "not_required";
  if (enrolled) return "required";
  return policy === "required" ? "must_enrol" : "not_required";
}

/**
 * Whether an operator may take their own second factor off.
 *
 * Not under `required`, for the obvious reason: it would make the policy
 * advisory. Under `optional` it is their own call — they chose to enrol and may
 * choose otherwise — and under `disabled` the factor is already not being used,
 * so removing the stored secret is tidying up rather than a security decision.
 *
 * ## The exception, and why it is not a hole (P66-02)
 *
 * A **super administrator is not bound by `required`**, because they are the
 * role that sets it. The platform policy is theirs to change: they can move it
 * to `optional`, remove the factor, and move it back, and the audit log records
 * all three. So the refusal never prevented the outcome — it made it a
 * three-step dance through a screen that does not say the dance exists, which
 * is P38-07's finding repeating (*"true, and left the one person able to change
 * that rule with no idea they could"*).
 *
 * The security question is whether this helps an attacker holding a stolen
 * super-administrator session. It does not: that session can already relax the
 * policy and then remove the factor. The guard cost the legitimate owner their
 * access and cost an attacker two requests.
 *
 * Everybody else stays bound. A `customer_admin` under a `required` customer
 * policy cannot remove their own — they do not own that policy, and for them
 * the refusal is the whole point.
 *
 * An *administrator* resetting somebody else's factor is a different question
 * with a different answer, because the case it exists for is a lost device: see
 * `canResetSecondFactorOf`.
 */
export function canRemoveOwnSecondFactor(
  policy: SecondFactorPolicy,
  role?: StaffRole,
): boolean {
  if (role === "super_admin") return true;
  return policy !== "required";
}

/**
 * Whether `actor` may clear the second factor on `target`'s account.
 *
 * This is the lost-device path, and before P22-02 the platform had none: an
 * enrolled operator who lost their phone was locked out permanently, with no
 * recovery anywhere in the product. That is a worse failure than the one strict
 * 2FA prevents, because it has no workaround at all.
 *
 * The rules are `canGrant`'s, not new ones — whoever may create and re-scope an
 * account may restore its access, and nobody who may not. Two additions:
 *
 * 1. **Not yourself.** Self-reset would let anyone holding a live session strip
 *    their own second factor, which turns a stolen *session* into a permanently
 *    weakened account. Removing your own is `canRemoveOwnSecondFactor`, which
 *    refuses under `required`; this path does not, so it must not be reachable
 *    for oneself.
 * 2. It leaves the account **unenrolled**, not signed in. Under a `required`
 *    policy their next sign-in goes to enrolment, so a reset restores access
 *    without lowering the bar.
 */
export function canResetSecondFactorOf(
  actor: StaffScope & { readonly accountId: string },
  target: StaffScope & { readonly accountId: string },
): GrantCheck {
  if (actor.accountId === target.accountId) {
    return { ok: false, reason: "self_escalation" };
  }
  return canGrant(actor, target);
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
  /** The actor's role does not manage staff accounts at all. */
  | "not_permitted"
  | "outside_customer"
  | "outside_department"
  | "role_too_broad"
  | "self_escalation";

export type GrantCheck =
  { readonly ok: true } | { readonly ok: false; readonly reason: GrantDenial };

/**
 * Whether `actor` may create or modify an account with `target`'s scope.
 *
 * Four rules, checked in this order, because the earlier ones are more
 * fundamental and a caller reading the reason should get the most basic one:
 *
 * 1. Your role manages staff accounts at all. A `department_admin` and a
 *    `course_editor` do not — inviting colleagues is the customer
 *    administrator's job, and a department admin who could invite could invite
 *    themselves into a second department.
 * 2. You cannot grant a role broader than your own — otherwise a customer
 *    administrator mints a super administrator and the hierarchy is decoration.
 * 3. You cannot grant a role **equal** to your own to yourself, which is the
 *    same rule stated for the case people forget: privilege escalation by
 *    self-edit. Editing one's own account is allowed; changing one's own scope
 *    is not.
 * 4. You cannot reach outside your own customer (or department).
 */
export function canGrant(
  actor: StaffScope,
  target: StaffScope,
  options: { readonly targetIsSelf: boolean } = { targetIsSelf: false },
): GrantCheck {
  if (!canManage(actor.role, "staff_user")) {
    return { ok: false, reason: "not_permitted" };
  }

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
