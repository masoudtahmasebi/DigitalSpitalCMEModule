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
  canManage,
  capabilitiesOf,
  checkPassword,
  inviteStatus,
  INVITE_VALID_DAYS,
  LOCKOUT_MINUTES,
  lockoutStatus,
  MAX_FAILED_ATTEMPTS,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  RESET_VALID_MINUTES,
  resetStatus,
  secondFactorStep,
  applicableSecondFactorPolicy,
  canRemoveOwnSecondFactor,
  canResetSecondFactorOf,
  DEFAULT_CUSTOMER_SECOND_FACTOR,
  DEFAULT_PLATFORM_SECOND_FACTOR,
  type SecondFactorPolicy,
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

  it("refuses a password containing only the local part of the address", () => {
    // The bug this file did not catch until P21-04. The comment on
    // `checkPassword` has always claimed it rejects "its own email local
    // part", and the implementation compared against the *whole* address — so
    // a password containing `anna.mueller@medice.de` was refused and one
    // containing `anna.mueller` sailed through. Nobody puts their full address
    // in a password; everybody puts their name in one.
    //
    // It was never learner-only. This is the platform's single password
    // policy, so a super admin's account had exactly the same hole.
    expect(
      checkPassword("anna.mueller-2026!", { identifiers: ["anna.mueller@medice.de"] }),
    ).toEqual({
      ok: false,
      reason: "contains_identifier",
    });
  });

  it("still refuses the whole address", () => {
    expect(
      checkPassword("xx-anna.mueller@medice.de-xx", {
        identifiers: ["anna.mueller@medice.de"],
      }),
    ).toEqual({ ok: false, reason: "contains_identifier" });
  });

  it("ignores a local part too short to mean anything", () => {
    // `bo@medice.de` expands to `bo`, which is in half the dictionary. The
    // length floor applies to the expansion, not only to what was passed in.
    expect(checkPassword("thequickbrownfox", { identifiers: ["bo@medice.de"] })).toEqual({
      ok: true,
    });
  });

  it("ignores an address with nothing before the @", () => {
    // `@medice.de` has no local part. Slicing blindly would add an empty
    // string, and `"anything".includes("")` is true — which would refuse every
    // password on the platform.
    expect(checkPassword("thequickbrownfox", { identifiers: ["@medice.de"] })).toEqual({
      ok: true,
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
  // Six combinations, all of them, because this decides whether a password
  // alone opens the console.
  it("covers every policy against every enrolment state", () => {
    expect(secondFactorStep("disabled", false)).toBe("not_required");
    expect(secondFactorStep("disabled", true)).toBe("not_required");
    expect(secondFactorStep("optional", false)).toBe("not_required");
    expect(secondFactorStep("optional", true)).toBe("required");
    expect(secondFactorStep("required", false)).toBe("must_enrol");
    expect(secondFactorStep("required", true)).toBe("required");
  });

  it("asks an enrolled account for its code even when the policy is only optional", () => {
    // Relaxing the policy must never make a stolen password sufficient for
    // somebody who had already protected themselves. Turning it off for such an
    // account is `disabled`, which is a different and deliberate choice.
    expect(secondFactorStep("optional", true)).toBe("required");
  });

  it("lets `disabled` override an enrolment that is still on the row", () => {
    // This asymmetry is the lost-device path: the stored secret survives, and
    // the policy is what stops it being demanded.
    expect(secondFactorStep("disabled", true)).toBe("not_required");
  });

  it("sends an unenrolled account under `required` to enrolment, not to a refusal", () => {
    // Refusing would make the account unrecoverable; letting them in would make
    // the requirement decorative.
    expect(secondFactorStep("required", false)).toBe("must_enrol");
  });

  it("still requires one of a super admin by default", () => {
    // ADR-0012's reasoning is unchanged; what changed is that it is now a
    // default rather than a law.
    expect(DEFAULT_PLATFORM_SECOND_FACTOR).toBe("required");
    expect(secondFactorStep(DEFAULT_PLATFORM_SECOND_FACTOR, false)).toBe("must_enrol");
  });
});

describe("applicableSecondFactorPolicy", () => {
  const platform: SecondFactorPolicy = "optional";

  it("uses the platform policy for a grant with no customer", () => {
    expect(
      applicableSecondFactorPolicy([{ customerId: null }], "required", new Map()),
    ).toBe("required");
  });

  it("uses a customer's own policy for a grant inside it", () => {
    const per = new Map<string, SecondFactorPolicy>([["c1", "required"]]);
    expect(applicableSecondFactorPolicy([{ customerId: "c1" }], platform, per)).toBe(
      "required",
    );
  });

  it("falls back to the customer default for a customer that has set none", () => {
    expect(
      applicableSecondFactorPolicy([{ customerId: "c9" }], "disabled", new Map()),
    ).toBe(DEFAULT_CUSTOMER_SECOND_FACTOR);
  });

  it("takes the strictest of several scopes, never the most convenient", () => {
    // The direction is the whole point. If the loosest won, a customer's
    // `required` would be worth nothing the moment somebody also held a grant
    // somewhere relaxed — and finding that somewhere would be an attacker's
    // first move.
    const per = new Map<string, SecondFactorPolicy>([
      ["strict", "required"],
      ["loose", "disabled"],
    ]);
    expect(
      applicableSecondFactorPolicy(
        [{ customerId: "loose" }, { customerId: "strict" }],
        "disabled",
        per,
      ),
    ).toBe("required");
  });

  it("does not depend on the order the grants arrive in", () => {
    const per = new Map<string, SecondFactorPolicy>([
      ["strict", "required"],
      ["loose", "disabled"],
    ]);
    const forwards = applicableSecondFactorPolicy(
      [{ customerId: "loose" }, { customerId: "strict" }],
      "disabled",
      per,
    );
    const backwards = applicableSecondFactorPolicy(
      [{ customerId: "strict" }, { customerId: "loose" }],
      "disabled",
      per,
    );
    expect(forwards).toBe(backwards);
  });

  it("lets the platform policy win when it is the strictest scope reached", () => {
    const per = new Map<string, SecondFactorPolicy>([["c1", "disabled"]]);
    expect(
      applicableSecondFactorPolicy(
        [{ customerId: null }, { customerId: "c1" }],
        "required",
        per,
      ),
    ).toBe("required");
  });

  it("gives an account with no grants the platform policy", () => {
    // They can reach nothing, so the value hardly matters — but the strictest
    // thing available is the right way to be wrong.
    expect(applicableSecondFactorPolicy([], "required", new Map())).toBe("required");
  });

  it("returns `disabled` only when every scope reached is disabled", () => {
    const per = new Map<string, SecondFactorPolicy>([
      ["a", "disabled"],
      ["b", "disabled"],
    ]);
    expect(
      applicableSecondFactorPolicy(
        [{ customerId: "a" }, { customerId: "b" }],
        "optional",
        per,
      ),
    ).toBe("disabled");
  });
});

describe("removing and resetting a second factor", () => {
  it("refuses an operator removing their own under a required policy", () => {
    // Otherwise the policy is advisory.
    expect(canRemoveOwnSecondFactor("required")).toBe(false);
  });

  it("allows it under optional and disabled", () => {
    expect(canRemoveOwnSecondFactor("optional")).toBe(true);
    expect(canRemoveOwnSecondFactor("disabled")).toBe(true);
  });

  it("lets a customer admin reset one of their own operators", () => {
    // The lost-device path. Before P22-02 there was none at all, and an
    // enrolled operator whose phone was gone was locked out permanently.
    const actor = {
      accountId: "a",
      role: "customer_admin",
      customerId: "c1",
      departmentId: null,
    } as const;
    const target = {
      accountId: "b",
      role: "department_admin",
      customerId: "c1",
      departmentId: null,
    } as const;
    expect(canResetSecondFactorOf(actor, target)).toEqual({ ok: true });
  });

  it("refuses across customers, exactly as canGrant does", () => {
    const actor = {
      accountId: "a",
      role: "customer_admin",
      customerId: "c1",
      departmentId: null,
    } as const;
    const target = {
      accountId: "b",
      role: "customer_admin",
      customerId: "c2",
      departmentId: null,
    } as const;
    expect(canResetSecondFactorOf(actor, target).ok).toBe(false);
  });

  it("refuses a role broader than the actor's, exactly as canGrant does", () => {
    const actor = {
      accountId: "a",
      role: "customer_admin",
      customerId: "c1",
      departmentId: null,
    } as const;
    const target = {
      accountId: "b",
      role: "super_admin",
      customerId: null,
      departmentId: null,
    } as const;
    expect(canResetSecondFactorOf(actor, target).ok).toBe(false);
  });

  it("refuses resetting oneself, whatever the role", () => {
    // Self-reset would turn a stolen *session* into a permanently weakened
    // account, and it would step around the `required` policy that
    // `canRemoveOwnSecondFactor` enforces.
    const self = {
      accountId: "same",
      role: "super_admin",
      customerId: null,
      departmentId: null,
    } as const;
    expect(canResetSecondFactorOf(self, self)).toEqual({
      ok: false,
      reason: "self_escalation",
    });
  });

  it("refuses a role that does not manage staff at all", () => {
    const actor = {
      accountId: "a",
      role: "department_admin",
      customerId: "c1",
      departmentId: "d1",
    } as const;
    const target = {
      accountId: "b",
      role: "course_editor",
      customerId: "c1",
      departmentId: "d1",
    } as const;
    expect(canResetSecondFactorOf(actor, target)).toEqual({
      ok: false,
      reason: "not_permitted",
    });
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
  const editor: StaffScope = {
    role: "course_editor",
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
    // A department admin is refused earlier, on capability: it manages no
    // staff at all, which is the more fundamental reason and the one to report.
    expect(canGrant(adhs, medice)).toEqual({ ok: false, reason: "not_permitted" });
  });

  it("confines a customer admin to their own customer", () => {
    expect(canGrant(medice, adhs)).toEqual({ ok: true });
    expect(canGrant(medice, { ...adhs, customerId: "c-other" })).toEqual({
      ok: false,
      reason: "outside_customer",
    });
    expect(canGrant(medice, other)).toEqual({ ok: false, reason: "outside_customer" });
  });

  it("refuses a role that does not manage staff at all", () => {
    // A department admin who could invite could invite themselves into a
    // second department; a course editor has no business with people.
    expect(canGrant(adhs, adhs)).toEqual({ ok: false, reason: "not_permitted" });
    expect(canGrant(editor, editor)).toEqual({ ok: false, reason: "not_permitted" });
  });

  it("confines a customer admin creating a department admin to their department", () => {
    expect(canGrant(medice, adhs)).toEqual({ ok: true });
    expect(canGrant(medice, { ...adhs, customerId: "c-other" })).toEqual({
      ok: false,
      reason: "outside_customer",
    });
  });

  it("refuses self-escalation, which is the case people forget", () => {
    expect(canGrant(medice, medice, { targetIsSelf: true })).toEqual({
      ok: false,
      reason: "self_escalation",
    });
  });

  it("lets a customer admin create a course editor, the limited-access role", () => {
    expect(canGrant(medice, editor)).toEqual({ ok: true });
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
      "course_editor",
      "department_admin",
      "customer_admin",
      "super_admin",
    ];
    for (const actorRole of roles) {
      for (const targetRole of roles) {
        const scoped = (role: StaffRole): StaffScope => ({
          role,
          customerId: role === "super_admin" ? null : "c-medice",
          departmentId:
            role === "department_admin" || role === "course_editor" ? "d-adhs" : null,
        });
        const actor = scoped(actorRole);
        const target = scoped(targetRole);
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

describe("capabilities", () => {
  it("gives only the super admin the power to create a customer", () => {
    // A customer is the tenant boundary; nobody inside one may mint another.
    expect(canManage("super_admin", "customer")).toBe(true);
    expect(canManage("customer_admin", "customer")).toBe(false);
    expect(canManage("department_admin", "customer")).toBe(false);
    expect(canManage("course_editor", "customer")).toBe(false);
  });

  it("gives the course editor courses and content and nothing else", () => {
    // "customer users who can create only courses, so they have limited
    // access" — the requirement, stated as a test.
    expect([...capabilitiesOf("course_editor")].sort()).toEqual(["content", "course"]);
  });

  it("lets a customer admin build their whole organisation but not another", () => {
    const caps = capabilitiesOf("customer_admin");
    expect(caps).toContain("department");
    expect(caps).toContain("project");
    expect(caps).toContain("staff_user");
    expect(caps).not.toContain("customer");
  });

  it("keeps staff management away from department admins and editors", () => {
    expect(canManage("department_admin", "staff_user")).toBe(false);
    expect(canManage("course_editor", "staff_user")).toBe(false);
  });

  it("never widens as the role narrows", () => {
    // Every capability of a narrower role must be held by every broader one,
    // or the hierarchy means nothing.
    const ordered: readonly StaffRole[] = [
      "course_editor",
      "department_admin",
      "customer_admin",
      "super_admin",
    ];
    for (let i = 0; i < ordered.length - 1; i += 1) {
      const narrower = capabilitiesOf(ordered[i] as StaffRole);
      const broader = capabilitiesOf(ordered[i + 1] as StaffRole);
      for (const entity of narrower) {
        expect(broader, `${String(ordered[i])} → ${String(ordered[i + 1])}`).toContain(
          entity,
        );
      }
    }
  });
});
