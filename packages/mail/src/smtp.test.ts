/**
 * Failure classification.
 *
 * This is the part of the SMTP channel with judgement in it, and getting it
 * wrong is asymmetric: a permanent failure classified as transient wastes six
 * attempts and then stops, while a transient one classified as permanent loses
 * a physician's Teilnahmebescheinigung silently.
 */

import { describe, expect, it } from "vitest";
import { classify } from "./smtp.js";

function smtpError(responseCode: number, message = "rejected"): Error {
  return Object.assign(new Error(message), { responseCode });
}

describe("classify", () => {
  it("treats an unknown recipient as permanent", () => {
    expect(classify(smtpError(550))).toEqual({
      status: "permanent",
      reason: "SMTP 550",
    });
  });

  it("treats a full mailbox as transient despite the 5xx", () => {
    // RFC-permanent, operationally a quota somebody clears.
    expect(classify(smtpError(552)).status).toBe("transient");
  });

  it("treats 554 as transient, because servers use it for greylisting", () => {
    expect(classify(smtpError(554)).status).toBe("transient");
  });

  it("treats 4xx as transient", () => {
    expect(classify(smtpError(450)).status).toBe("transient");
    expect(classify(smtpError(421)).status).toBe("transient");
  });

  it("treats a connection failure as transient, not a statement about the address", () => {
    const error = Object.assign(new Error("connect ECONNREFUSED"), {
      code: "ECONNREFUSED",
    });
    expect(classify(error)).toEqual({ status: "transient", reason: "ECONNREFUSED" });
  });

  it("reports the error code, never the server's message", () => {
    // A misconfigured server's greeting has been known to echo the username
    // back, and this string is written to `delivery_error`, which an admin
    // reads in the console.
    const error = Object.assign(new Error("535 auth failed for user hans@example.de"), {
      code: "EAUTH",
    });
    const outcome = classify(error);
    expect(outcome.status).toBe("transient");
    expect(JSON.stringify(outcome)).not.toContain("hans@example.de");
  });

  it("survives being handed something that is not an Error", () => {
    expect(classify(undefined).status).toBe("transient");
    expect(classify("boom").status).toBe("transient");
    expect(classify(null)).toEqual({
      status: "transient",
      reason: "unknown transport error",
    });
  });
});
