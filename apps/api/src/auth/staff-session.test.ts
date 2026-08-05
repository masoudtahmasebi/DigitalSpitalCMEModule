/**
 * The CSRF gate and the cookie parser.
 *
 * The cases that matter are the refusals, and one distinction that is easy to
 * collapse: **no cookie is not a rejection.** A request with neither credential
 * has to fall through to the learner path, and returning "rejected" for it
 * would make every learner request fail the moment staff auth was wired in.
 */

import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { authenticateStaff, readCookie, SESSION_COOKIE } from "./staff-session.js";
import type {
  ResolvedStaffSession,
  SessionFailure,
} from "../modules/staff/staff.service.js";

const CSRF = randomBytes(32).toString("base64url");
const CSRF_HASH = createHash("sha256").update(CSRF, "utf8").digest();

const SESSION = {
  sessionId: "s1",
  account: { id: "a1" },
  grants: [],
  csrfTokenHash: CSRF_HASH,
} as unknown as ResolvedStaffSession;

const resolveOk = async (): Promise<ResolvedStaffSession> => SESSION;
const resolveFail =
  (failure: SessionFailure) => async (): Promise<{ failure: SessionFailure }> => ({
    failure,
  });

describe("readCookie", () => {
  it("finds a cookie among others", () => {
    expect(readCookie("a=1; ds_staff_session=abc; b=2", SESSION_COOKIE)).toBe("abc");
  });

  it("tolerates the spacing browsers actually send", () => {
    expect(readCookie("ds_staff_session=abc", SESSION_COOKIE)).toBe("abc");
    expect(readCookie("  ds_staff_session = abc  ", SESSION_COOKIE)).toBe("abc");
  });

  it("percent-decodes, because Express encodes on the way out", () => {
    expect(readCookie("ds_staff_session=a%2Bb", SESSION_COOKIE)).toBe("a+b");
  });

  it("does not match a cookie whose name merely ends with the wanted one", () => {
    // "x_ds_staff_session" must not satisfy a request for "ds_staff_session".
    expect(readCookie("x_ds_staff_session=abc", SESSION_COOKIE)).toBeUndefined();
  });

  it("returns undefined for no header at all", () => {
    expect(readCookie(undefined, SESSION_COOKIE)).toBeUndefined();
  });
});

describe("authenticateStaff", () => {
  it("reports no cookie as `none`, not as a rejection", () => {
    // The distinction the learner path depends on.
    return expect(
      authenticateStaff({
        method: "GET",
        cookieHeader: undefined,
        csrfHeader: undefined,
        resolve: resolveOk,
      }),
    ).resolves.toEqual({ kind: "none" });
  });

  it("accepts a read with no CSRF token", async () => {
    // The console's first call is a GET made before it has a token to echo.
    const result = await authenticateStaff({
      method: "GET",
      cookieHeader: `${SESSION_COOKIE}=tok`,
      csrfHeader: undefined,
      resolve: resolveOk,
    });
    expect(result.kind).toBe("session");
  });

  it("refuses a write with no CSRF token", async () => {
    const result = await authenticateStaff({
      method: "POST",
      cookieHeader: `${SESSION_COOKIE}=tok`,
      csrfHeader: undefined,
      resolve: resolveOk,
    });
    expect(result).toEqual({ kind: "rejected", reason: "csrf" });
  });

  it("refuses a write with the wrong CSRF token", async () => {
    const result = await authenticateStaff({
      method: "POST",
      cookieHeader: `${SESSION_COOKIE}=tok`,
      csrfHeader: randomBytes(32).toString("base64url"),
      resolve: resolveOk,
    });
    expect(result).toEqual({ kind: "rejected", reason: "csrf" });
  });

  it("accepts a write with the right CSRF token", async () => {
    const result = await authenticateStaff({
      method: "POST",
      cookieHeader: `${SESSION_COOKIE}=tok`,
      csrfHeader: CSRF,
      resolve: resolveOk,
    });
    expect(result.kind).toBe("session");
  });

  it("checks every state-changing method, not only POST", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const result = await authenticateStaff({
        method,
        cookieHeader: `${SESSION_COOKIE}=tok`,
        csrfHeader: undefined,
        resolve: resolveOk,
      });
      expect(result, method).toEqual({ kind: "rejected", reason: "csrf" });
    }
  });

  it("is not case-sensitive about the method", async () => {
    const result = await authenticateStaff({
      method: "post",
      cookieHeader: `${SESSION_COOKIE}=tok`,
      csrfHeader: undefined,
      resolve: resolveOk,
    });
    expect(result).toEqual({ kind: "rejected", reason: "csrf" });
  });

  it("passes through the reason a session was refused", async () => {
    // "Your session timed out" and "your access was withdrawn" are different
    // things to tell somebody, and only one means try again.
    for (const failure of [
      "revoked",
      "idle_timeout",
      "absolute_timeout",
      "no_session",
    ] as const) {
      const result = await authenticateStaff({
        method: "GET",
        cookieHeader: `${SESSION_COOKIE}=tok`,
        csrfHeader: undefined,
        resolve: resolveFail(failure),
      });
      expect(result).toEqual({ kind: "rejected", reason: failure });
    }
  });

  it("checks the session before the CSRF token", async () => {
    // A revoked session must not be reported as a CSRF problem — that would
    // send somebody hunting a header bug when their access was withdrawn.
    const result = await authenticateStaff({
      method: "POST",
      cookieHeader: `${SESSION_COOKIE}=tok`,
      csrfHeader: undefined,
      resolve: resolveFail("revoked"),
    });
    expect(result).toEqual({ kind: "rejected", reason: "revoked" });
  });
});
