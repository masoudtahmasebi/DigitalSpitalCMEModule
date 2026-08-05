/**
 * Exhaustive, because this is the file that decides who gets in.
 *
 * The cases worth the most are the boundaries — the attempt that trips the
 * lockout and the one before it, the second the session expires — and the
 * escalation cases, where a wrong answer is not a bug but a customer
 * administrator reading another customer's physicians.
 */

import { describe, expect, it } from "vitest";
import {
  canGrant,
  checkPassword,
  inviteStatus,
  INVITE_VALID_DAYS,
  LOCKOUT_MINUTES,
  lockoutStatus,
  MAX_FAILED_ATTEMPTS,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  requiresSecondFactor,
  RESET_VALID_MINUTES,
  resetStatus,
  secondFactorStep,
  SESSION_ABSOLUTE_HOURS,
  SESSION_IDLE_MINUTES,
  sessionStatus,
  type StaffRole,
  type StaffScope,
} from "./staff-identity.js";

const T0 = new Date("2026-09-01T09:00:00.000Z");
const at = (ms: number): Date => new Date(T0.getTime() + ms);
const minutes = (n: number): number => n * 60_000;
const hours = (n: number): number => n * 3_600_000;
const days = (n: number): number => n * 86_400_000;

describe("checkPassword", () => {
  const context = { identifiers: ["anna.mueller@medice.de", "Müller"] };

  it("accepts a passphrase at the floor", () => {
    expect(checkPassword("x".repeat(MIN_PASSWORD_LENGTH), context)).toEqual({ ok: true });
  });

  it("refuses one character below the floor", () => {
    expect(checkPassword("x".repeat(MIN_PASSWORD_LENGTH - 1), context)).toEqual({
      ok: false,
      reason: "too_short",
    });
  });

  it("refuses a password long enough to be a hashing denial of service", () => {
    expect(checkPassword("x".repeat(MAX_PASSWORD_LENGTH + 1), context)).toEqual({
      ok: false,
      reason: "too_long",
    });
  });

  it("accepts exactly the maximum", () => {
    expect(checkPassword("x".repeat(MAX_PASSWORD_LENGTH), context)).toEqual({ ok: true });
  });

  it("counts code points, not UTF-16 units", () => {
    // Twelve emoji are twelve characters to the person typing them; counting
    // surrogate pairs would call this 24 and pass a shorter secret.
    const eleven = "😀".repeat(11);
    expect(checkPassword(eleven, context)).toEqual({ ok: false, reason: "too_short" });
    expect(checkPassword("😀".repeat(12), context)).toEqual({ ok: true });
  });

  it("refuses a password known to be breached", () => {
    expect(
      checkPassword("correct horse battery staple", { ...context, knownBreached: true }),
    ).toEqual({ ok: false, reason: "too_common" });
  });

  it("refuses a password containing the account's own identifiers", () => {
    expect(checkPassword("anna.mueller@medice.de!!", context)).toEqual({
      ok: false,
      reason: "contains_identifier",
    });
    expect(checkPassword("xxxxMÜLLERxxxxxx", context)).toEqual({
      ok: false,
      reason: "contains_identifier",
    });
  });

  it("ignores identifier fragments too short to mean anything", () => {
    // A two-letter name would otherwise ban every password containing those
    // two letters in sequence, which is most of them.
    expect(checkPassword("thequickbrownfox", { identifiers: ["Bo", "ox"] })).toEqual({
      ok: true,
    });
  });

  it("has no composition rules", () => {
    // Deliberate: a long lowercase passphrase is stronger than "Passwort1!".
    expect(checkPassword("dreiweissekatzenimgarten", context)).toEqual({ ok: true });
  });
});

describe("lockoutStatus", () => {
  it("counts down while attempts remain", () => {
    expect(lockoutStatus({ failedAttempts: 3, lastFailureAt: T0 }, T0)).toEqual({
      locked: false,
      attemptsRemaining: MAX_FAILED_ATTEMPTS - 3,
    });
  });

  it("is not locked on the attempt before the limit", () => {
    const state = { failedAttempts: MAX_FAILED_ATTEMPTS - 1, lastFailureAt: T0 };
    expect(lockoutStatus(state, T0).locked).toBe(false);
  });

  it("locks exactly at the limit", () => {
    const state = { failedAttempts: MAX_FAILED_ATTEMPTS, lastFailureAt: T0 };
    expect(lockoutStatus(state, T0)).toEqual({
      locked: true,
      until: at(minutes(LOCKOUT_MINUTES)),
    });
  });

  it("is still locked one millisecond before the window closes", () => {
    const state = { failedAttempts: MAX_FAILED_ATTEMPTS, lastFailureAt: T0 };
    expect(lockoutStatus(state, at(minutes(LOCKOUT_MINUTES) - 1)).locked).toBe(true);
  });

  it("clears the instant the window closes, with no administrator needed", () => {
    const state = { failedAttempts: MAX_FAILED_ATTEMPTS, lastFailureAt: T0 };
    expect(lockoutStatus(state, at(minutes(LOCKOUT_MINUTES))).locked).toBe(false);
  });

  it("measures from the last failure, so a patient attacker still trips it", () => {
    // Twenty failures, the most recent one a minute ago: locked, even though
    // the first was hours back.
    const state = { failedAttempts: 20, lastFailureAt: at(minutes(-1)) };
    expect(lockoutStatus(state, T0).locked).toBe(true);
  });

  it("treats an account that has never failed as open", () => {
    expect(lockoutStatus({ failedAttempts: 0, lastFailureAt: null }, T0)).toEqual({
      locked: false,
      attemptsRemaining: MAX_FAILED_ATTEMPTS,
    });
  });
});

describe("sessionStatus", () => {
  const fresh = { createdAt: T0, lastSeenAt: T0, revokedAt: null };

  it("is valid immediately, expiring at the idle limit first", () => {
    expect(sessionStatus(fresh, T0)).toEqual({
      valid: true,
      expiresAt: at(minutes(SESSION_IDLE_MINUTES)),
    });
  });

  it("expires on idle at exactly the limit", () => {
    expect(sessionStatus(fresh, at(minutes(SESSION_IDLE_MINUTES)))).toEqual({
      valid: false,
      reason: "idle_timeout",
    });
  });

  it("survives one millisecond before the idle limit", () => {
    expect(sessionStatus(fresh, at(minutes(SESSION_IDLE_MINUTES) - 1)).valid).toBe(true);
  });

  it("expires absolutely even when constantly refreshed", () => {
    // The case an idle timeout alone cannot catch: a tab polling all day.
    const busy = {
      createdAt: T0,
      lastSeenAt: at(hours(SESSION_ABSOLUTE_HOURS)),
      revokedAt: null,
    };
    expect(sessionStatus(busy, at(hours(SESSION_ABSOLUTE_HOURS)))).toEqual({
      valid: false,
      reason: "absolute_timeout",
    });
  });

  it("reports the nearer of the two limits", () => {
    // Eleven hours and fifty minutes in: the absolute limit is now nearer than
    // a fresh idle window would be.
    const late = {
      createdAt: T0,
      lastSeenAt: at(hours(11) + minutes(50)),
      revokedAt: null,
    };
    expect(sessionStatus(late, at(hours(11) + minutes(50)))).toEqual({
      valid: true,
      expiresAt: at(hours(SESSION_ABSOLUTE_HOURS)),
    });
  });

  it("revocation wins over everything, and says so", () => {
    // Distinguishable from a timeout on purpose: "your access was withdrawn"
    // and "you were away too long" mean different things, and only one of them
    // means try again.
    const revoked = { createdAt: T0, lastSeenAt: T0, revokedAt: T0 };
    expect(sessionStatus(revoked, T0)).toEqual({ valid: false, reason: "revoked" });
  });

  it("ignores a revocation scheduled in the future", () => {
    const later = { createdAt: T0, lastSeenAt: T0, revokedAt: at(minutes(5)) };
    expect(sessionStatus(later, T0).valid).toBe(true);
  });
});

describe("second factor", () => {
  it("is required for a super admin and optional below", () => {
    expect(requiresSecondFactor("super_admin")).toBe(true);
    expect(requiresSecondFactor("customer_admin")).toBe(false);
    expect(requiresSecondFactor("department_admin")).toBe(false);
  });

  it("asks an enrolled account for its code whatever the role", () => {
    expect(secondFactorStep("department_admin", true)).toBe("required");
    expect(secondFactorStep("super_admin", true)).toBe("required");
  });

  it("sends an unenrolled super admin to enrolment rather than refusing them", () => {
    // Refusing would make the account unrecoverable; letting them in would make
    // the requirement decorative.
    expect(secondFactorStep("super_admin", false)).toBe("must_enrol");
  });

  it("lets an unenrolled lesser admin straight in", () => {
    expect(secondFactorStep("customer_admin", false)).toBe("not_required");
  });
});

describe("canGrant", () => {
  const superAdmin: StaffScope = {
    role: "super_admin",
    customerId: null,
    departmentId: null,
  };
  const medice: StaffScope = {
    role: "customer_admin",
    customerId: "c-medice",
    departmentId: null,
  };
  const other: StaffScope = {
    role: "customer_admin",
    customerId: "c-other",
    departmentId: null,
  };
  const adhs: StaffScope = {
    role: "department_admin",
    customerId: "c-medice",
    departmentId: "d-adhs",
  };

  it("lets a super admin create anyone", () => {
    expect(canGrant(superAdmin, medice)).toEqual({ ok: true });
    expect(canGrant(superAdmin, adhs)).toEqual({ ok: true });
  });

  it("refuses to mint a role broader than the actor's", () => {
    // The rule that makes the hierarchy real rather than decorative.
    expect(canGrant(medice, superAdmin)).toEqual({ ok: false, reason: "role_too_broad" });
    expect(canGrant(adhs, medice)).toEqual({ ok: false, reason: "role_too_broad" });
  });

  it("confines a customer admin to their own customer", () => {
    expect(canGrant(medice, adhs)).toEqual({ ok: true });
    expect(canGrant(medice, { ...adhs, customerId: "c-other" })).toEqual({
      ok: false,
      reason: "outside_customer",
    });
    expect(canGrant(medice, other)).toEqual({ ok: false, reason: "outside_customer" });
  });

  it("confines a department admin to their own department", () => {
    expect(canGrant(adhs, adhs)).toEqual({ ok: true });
    expect(canGrant(adhs, { ...adhs, departmentId: "d-other" })).toEqual({
      ok: false,
      reason: "outside_department",
    });
  });

  it("refuses self-escalation, which is the case people forget", () => {
    expect(canGrant(medice, medice, { targetIsSelf: true })).toEqual({
      ok: false,
      reason: "self_escalation",
    });
    expect(canGrant(adhs, medice, { targetIsSelf: true })).toEqual({
      ok: false,
      reason: "role_too_broad",
    });
  });

  it("lets somebody narrow their own scope", () => {
    // Downgrading yourself is not escalation and should not be blocked.
    expect(
      canGrant(medice, { ...adhs, departmentId: "d-adhs" }, { targetIsSelf: true }),
    ).toEqual({ ok: true });
  });

  it("refuses a customer admin with no customer of their own", () => {
    // A malformed grant must fail closed rather than matching `null === null`.
    const malformed: StaffScope = {
      role: "customer_admin",
      customerId: null,
      departmentId: null,
    };
    expect(canGrant(malformed, { ...medice, customerId: null })).toEqual({
      ok: false,
      reason: "outside_customer",
    });
  });

  it("covers every role pair", () => {
    // Ascending breadth, matching ROLE_RANK in the source. Listing them the
    // other way round — which reads more naturally — inverts the comparison
    // below and asserts the exact opposite of the rule.
    const roles: readonly StaffRole[] = [
      "department_admin",
      "customer_admin",
      "super_admin",
    ];
    for (const actorRole of roles) {
      for (const targetRole of roles) {
        const actor: StaffScope = {
          role: actorRole,
          customerId: actorRole === "super_admin" ? null : "c-medice",
          departmentId: actorRole === "department_admin" ? "d-adhs" : null,
        };
        const target: StaffScope = {
          role: targetRole,
          customerId: targetRole === "super_admin" ? null : "c-medice",
          departmentId: targetRole === "department_admin" ? "d-adhs" : null,
        };
        const result = canGrant(actor, target);
        // The only universal law: never upward.
        if (roles.indexOf(targetRole) > roles.indexOf(actorRole)) {
          expect(result.ok, `${actorRole} → ${targetRole}`).toBe(false);
        }
      }
    }
  });
});

describe("inviteStatus", () => {
  const open = { createdAt: T0, acceptedAt: null, revokedAt: null };

  it("is valid within the window", () => {
    expect(inviteStatus(open, at(days(INVITE_VALID_DAYS) - 1))).toBe("valid");
  });

  it("expires exactly at the window", () => {
    expect(inviteStatus(open, at(days(INVITE_VALID_DAYS)))).toBe("expired");
  });

  it("cannot be accepted twice", () => {
    expect(inviteStatus({ ...open, acceptedAt: T0 }, T0)).toBe("already_accepted");
  });

  it("reports acceptance even after expiry, because that is what happened", () => {
    expect(inviteStatus({ ...open, acceptedAt: T0 }, at(days(30)))).toBe(
      "already_accepted",
    );
  });

  it("honours revocation", () => {
    expect(inviteStatus({ ...open, revokedAt: T0 }, T0)).toBe("revoked");
  });
});

describe("resetStatus", () => {
  const open = { createdAt: T0, acceptedAt: null, revokedAt: null };

  it("lives an hour, not a week", () => {
    // A reset link is a live bypass of an existing account's password sitting
    // in an inbox; an invitation is an offer to somebody with no account yet.
    expect(resetStatus(open, at(minutes(RESET_VALID_MINUTES) - 1))).toBe("valid");
    expect(resetStatus(open, at(minutes(RESET_VALID_MINUTES)))).toBe("expired");
  });

  it("is single use", () => {
    expect(resetStatus({ ...open, acceptedAt: T0 }, T0)).toBe("already_accepted");
  });
});
