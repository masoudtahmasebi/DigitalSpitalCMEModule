import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EivClient, EivError } from "./client.js";
import { startMockServer, type MockServer } from "./mock/server.js";
import { redact } from "./redact.js";

const VNR = "2760552025919300018";
const PASSWORD = "test-password";
const EFN = "123456789012345";

let mock: MockServer;

beforeAll(async () => {
  mock = await startMockServer(0, { expectedVnr: VNR, expectedPassword: PASSWORD });
});

afterAll(async () => {
  await mock.close();
});

const client = () =>
  new EivClient({ baseUrl: mock.url, vnr: VNR, vnrPassword: PASSWORD, timeoutMs: 2000 });

describe("the documented flow, end to end", () => {
  it("authenticates and submits a participation", async () => {
    const { auth, push } = await client().submit(EFN);

    expect(auth.token).not.toBe("");
    expect(push.accepted).toBe(true);
    expect(push.reference).toMatch(/^MOCK-/);

    // rolle is always TEILNEHMER: every participant is a regular attendee.
    expect(push.exchange.requestBody).toMatchObject({
      vnr: VNR,
      rolle: "TEILNEHMER",
    });
  });

  it("records the request and response verbatim for inspection", async () => {
    const { push } = await client().submit("999888777666555");

    expect(push.exchange.method).toBe("POST");
    expect(push.exchange.url).toContain("/fobi/veranstalter/push_teilnahme");
    expect(push.exchange.status).toBe(200);
    expect(push.exchange.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("acknowledges a repeat submission idempotently", async () => {
    const efn = "111122223333444";

    const first = await client().submit(efn);
    const second = await client().submit(efn);

    expect(first.push.accepted).toBe(true);
    expect(second.push.accepted).toBe(true);
    expect(second.push.reference).toBe(first.push.reference);
  });
});

describe("failure classification drives the retry queue", () => {
  it("treats bad credentials as non-retryable", async () => {
    const wrong = new EivClient({
      baseUrl: mock.url,
      vnr: VNR,
      vnrPassword: "wrong",
      timeoutMs: 2000,
    });

    const error = await wrong.authenticate().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(EivError);
    expect((error as EivError).kind).toBe("auth");
    expect((error as EivError).retryable).toBe(false);
  });

  it("treats a rejected EFN as non-retryable", async () => {
    // An EFN the Ärztekammer does not recognise will still be unrecognised in
    // an hour. Retrying it hides the problem until the window has closed.
    const error = await client()
      .submit("12345")
      .catch((e: unknown) => e);

    expect((error as EivError).kind).toBe("validation");
    expect((error as EivError).retryable).toBe(false);
    expect((error as EivError).message).toContain("15 Ziffern");
  });

  it("treats a 5xx as retryable", async () => {
    const failing = new EivClient({
      baseUrl: `${mock.url}`,
      vnr: VNR,
      vnrPassword: PASSWORD,
      timeoutMs: 2000,
    });

    const original = globalThis.fetch;
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      headers.set("x-mock-behaviour", "server_error");
      return original(input, { ...init, headers });
    }) as typeof fetch;

    try {
      const error = await failing.authenticate().catch((e: unknown) => e);
      expect((error as EivError).kind).toBe("server");
      expect((error as EivError).retryable).toBe(true);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("treats an unreachable host as a retryable transport failure", async () => {
    const unreachable = new EivClient({
      baseUrl: "http://127.0.0.1:1",
      vnr: VNR,
      vnrPassword: PASSWORD,
      timeoutMs: 1000,
    });

    const error = await unreachable.authenticate().catch((e: unknown) => e);

    expect((error as EivError).kind).toBe("transport");
    expect((error as EivError).retryable).toBe(true);
  });

  it("rejects a submission without a valid bearer token", async () => {
    const error = await client()
      .pushTeilnahme(EFN, "not-a-real-token")
      .catch((e: unknown) => e);

    expect((error as EivError).kind).toBe("auth");
  });

  it("rejects an unknown rolle, proving the mock enforces the documented value", async () => {
    const { token } = await client().authenticate();

    const response = await fetch(new URL("/fobi/veranstalter/push_teilnahme", mock.url), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ vnr: VNR, efn: EFN, rolle: "REFERENT" }),
    });

    expect(response.status).toBe(422);
  });
});

describe("divergence from the documented contract is surfaced, not swallowed", () => {
  it("reports a non-JSON body verbatim", async () => {
    // Exactly the kind of surprise this harness exists to catch: a maintenance
    // page returned with a 200.
    const original = globalThis.fetch;
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      headers.set("x-mock-behaviour", "non_json");
      return original(input, { ...init, headers });
    }) as typeof fetch;

    try {
      const error = await client()
        .authenticate()
        .catch((e: unknown) => e);

      expect((error as EivError).kind).toBe("unknown");
      expect((error as EivError).exchange?.responseBody).toContain("Wartungsarbeiten");
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("redaction", () => {
  it("never exposes the VNR password", () => {
    const output = JSON.stringify(redact({ vnr: VNR, passwort: PASSWORD }));

    expect(output).not.toContain(PASSWORD);
    expect(output).toContain("[redacted]");
    // The VNR itself is not a secret and stays visible for diagnosis.
    expect(output).toContain(VNR);
  });

  it("masks the EFN down to its last four digits", () => {
    const output = redact({ efn: EFN }) as { efn: string };

    expect(output.efn).toBe("***********2345");
    expect(output.efn).not.toContain("12345678");
  });

  it("redacts tokens under any casing or separator", () => {
    const output = JSON.stringify(
      redact({ Token: "abc", vnr_password: "s3cret", JWT: "xyz" }),
    );

    expect(output).not.toContain("abc");
    expect(output).not.toContain("s3cret");
    expect(output).not.toContain("xyz");
  });

  it("redacts nested structures", () => {
    const output = JSON.stringify(redact({ outer: { inner: { passwort: PASSWORD } } }));
    expect(output).not.toContain(PASSWORD);
  });

  it("redacts inside arrays", () => {
    const output = JSON.stringify(redact([{ passwort: PASSWORD }, { efn: EFN }]));
    expect(output).not.toContain(PASSWORD);
    expect(output).not.toContain(EFN);
  });

  it("leaves plain values untouched", () => {
    expect(redact("hello")).toBe("hello");
    expect(redact(42)).toBe(42);
    expect(redact(null)).toBe(null);
  });
});
