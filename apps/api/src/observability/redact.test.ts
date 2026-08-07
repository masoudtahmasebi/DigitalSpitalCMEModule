/**
 * Redaction, exhaustively — because `docs/gdpr.md` §7 makes a claim about logs
 * and this is the only thing that can keep it true.
 *
 * The cases that matter are not the ones somebody labelled. They are the values
 * that arrive unlabelled: an EFN inside a constraint violation, an e-mail in a
 * URL, a presigned URL inside a `fetch` failure. Each one below has happened
 * somewhere, to somebody.
 */

import { describe, expect, it } from "vitest";
import { redact, redactText } from "./redact.js";

/** A 15-digit EFN, and never a real one. */
const EFN = "123456789012345";

describe("the EFN — the value it would be worst to lose", () => {
  it("removes it from a bare string", () => {
    expect(redactText(EFN)).toBe("[redacted:efn]");
  });

  it("removes it from a message that merely quoted it", () => {
    // The realistic shape: a constraint violation echoing the failing value.
    const message = `duplicate key value violates unique constraint "efn_profiles_efn_key": Key (efn)=(${EFN}) already exists.`;
    expect(redactText(message)).not.toContain(EFN);
  });

  it("removes it from a number, not only a string", () => {
    expect(redact(Number(EFN))).toBe("[redacted:efn]");
  });

  it("removes it from a nested object under any key name", () => {
    // `fortbildungsnummer` is not in the key list. The shape is what catches it.
    const redacted = JSON.stringify(
      redact({ profile: { fortbildungsnummer: EFN, other: "fine" } }),
    );
    expect(redacted).not.toContain(EFN);
    expect(redacted).toContain("fine");
  });

  it("leaves a 13-digit millisecond timestamp alone", () => {
    // Bounded on both sides, or every log line's own timestamp is redacted.
    expect(redactText("1786100411995")).toBe("1786100411995");
  });

  it("leaves a 16-digit number alone", () => {
    expect(redactText("1234567890123456")).toBe("1234567890123456");
  });

  it("redacts a VNR too, and that is the right trade", () => {
    // A VNR is 19 digits so it survives; but any 15-digit identifier is
    // redacted. A VNR in a log is unhelpful; an EFN in a log is reportable.
    expect(redactText("2760552025919300018")).toBe("2760552025919300018");
  });
});

describe("credentials, which are not personal data and are worse in a log", () => {
  it("removes a presigned URL entirely, query string and all", () => {
    // Possession is permission until it expires. The access key id is in
    // `X-Amz-Credential`, so the whole query string goes.
    const url =
      "https://fsn1.your-objectstorage.com/bucket/key.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIA123%2F20260807%2Feu%2Fs3%2Faws4_request&X-Amz-Signature=deadbeef";
    const out = redactText(`fetch failed for ${url}`);

    expect(out).not.toContain("X-Amz-Signature");
    expect(out).not.toContain("AKIA123");
    expect(out).toContain("[redacted:presigned-url]");
  });

  it("removes a bearer token from an Authorization header", () => {
    const token = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJhYmMifQ.c2ln";
    expect(redactText(`Authorization: Bearer ${token}`)).not.toContain(token);
  });

  it("leaves the words after 'Bearer' alone when they are not a token", () => {
    // Found by running it: the auth guard writes "no Bearer token presented",
    // and an earlier version turned that into "no Bearer [redacted:bearer]" —
    // destroying the one message that explains a 401. A redactor that mangles
    // prose is one people stop reading the logs because of.
    expect(redactText("no Bearer token presented")).toBe("no Bearer token presented");
  });

  it("removes a JWT that nobody labelled as one", () => {
    const jwt =
      "eyJhbGciOiJSUzI1NiIsImtpZCI6ImsxIn0.eyJzdWIiOiJhYmMiLCJhdWQiOiJ4In0.c2lnbmF0dXJl";
    expect(redactText(`token verification failed for ${jwt}`)).toContain(
      "[redacted:jwt]",
    );
  });

  it("removes the password out of a connection string", () => {
    // The exact shape a `pg` connection error prints.
    const out = redactText(
      "connection to postgres://ds_app:s3cr3t+pass/word@postgres:5432/ds_education failed",
    );
    expect(out).not.toContain("s3cr3t");
    expect(out).toContain("ds_app");
  });

  for (const assignment of [
    'password="hunter2"',
    "password: hunter2",
    "SECRETS_KMS_KEY=aGVsbG8=",
    "apiKey: 'abc123'",
    "access_key = AKIAEXAMPLE",
  ]) {
    it(`removes the value from ${assignment.split(/[=:]/)[0]?.trim()}`, () => {
      const out = redactText(assignment);
      expect(out).toContain("[redacted:credential]");
      expect(out).not.toMatch(/hunter2|aGVsbG8|abc123|AKIAEXAMPLE/);
    });
  }
});

describe("e-mail and name", () => {
  it("removes an address from free text", () => {
    expect(redactText("no user for arzt@praxis-mueller.de")).not.toContain(
      "praxis-mueller",
    );
  });

  it("removes an address hidden in a URL", () => {
    // The shape that a field-name allow-list cannot see.
    const out = redactText("GET /admin/users?email=arzt%40praxis.de&sort=name");
    expect(out).toContain("[redacted:credential]");
  });

  it("removes an address with a plus tag and an apostrophe", () => {
    expect(redactText("o'brien+cme@example.org")).toBe("[redacted:email]");
  });

  it("drops the attested name by key, because a name has no shape to match", () => {
    const out = redact({
      attestedName: "Dr. med. Anna Schmidt",
      courseId: "abc",
    }) as Record<string, unknown>;

    expect(out["attestedName"]).toBe("[redacted:attestedname]");
    expect(out["courseId"]).toBe("abc");
  });

  it("drops free-text evaluation answers, where a patient may be described", () => {
    const out = redact({ answers: ["Ein Patient mit …"] }) as Record<string, unknown>;
    expect(out["answers"]).toBe("[redacted:answers]");
  });

  it("matches a sensitive key regardless of case or hyphens", () => {
    const out = redact({ "Set-Cookie": "x", SESSION_TOKEN: "y" }) as Record<
      string,
      unknown
    >;
    expect(out["Set-Cookie"]).toContain("redacted");
    expect(out["SESSION_TOKEN"]).toContain("redacted");
  });
});

describe("shapes it has to survive", () => {
  it("does not mutate what it was given", () => {
    // A redactor that edited the caller's object would change what the
    // application then did with it.
    const original = { email: "a@b.de", nested: { efn: EFN } };
    redact(original);

    expect(original.email).toBe("a@b.de");
    expect(original.nested.efn).toBe(EFN);
  });

  it("summarises a Buffer rather than printing it", () => {
    expect(redact(Buffer.alloc(40_000))).toBe("[buffer:40000]");
  });

  it("keeps an Error's message and drops its stack", () => {
    // A stack quotes source lines, and in this codebase those include SQL.
    const out = redact(new Error(`no profile for ${EFN}`)) as Record<string, unknown>;

    expect(out["message"]).toBe("no profile for [redacted:efn]");
    expect(out["stack"]).toBeUndefined();
  });

  it("stops at a depth bound rather than following a cycle for ever", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic["self"] = cyclic;

    expect(() => JSON.stringify(redact(cyclic))).not.toThrow();
    expect(JSON.stringify(redact(cyclic))).toContain("redacted:depth");
  });

  it("truncates a string long enough to be a payload", () => {
    const out = redactText("x".repeat(5000));
    expect(out.length).toBeLessThan(2100);
    expect(out).toContain("[truncated]");
  });

  it("caps an array rather than logging ten thousand rows", () => {
    expect(
      (redact(Array.from({ length: 10_000 }, (_, i) => i)) as unknown[]).length,
    ).toBe(100);
  });

  it("leaves an ordinary log line completely alone", () => {
    // The check that this is a redactor and not a shredder: if normal messages
    // come out mangled, people stop reading the logs.
    const line = "GET /courses/adhs-akademie-adult 200 in 34ms";
    expect(redactText(line)).toBe(line);
  });

  it("keeps ids, which are what an operator actually needs", () => {
    const out = redact({
      customerId: "0198f4c1-7a2e-7000-8000-000000000001",
      courseSlug: "adhs-akademie-adult",
      status: 200,
    }) as Record<string, unknown>;

    expect(out["customerId"]).toBe("0198f4c1-7a2e-7000-8000-000000000001");
    expect(out["courseSlug"]).toBe("adhs-akademie-adult");
    expect(out["status"]).toBe(200);
  });
});
