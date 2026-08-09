import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EivClient, EivError } from "./client.js";
import { startMockServer, type MockServer } from "./mock/server.js";
import { redact } from "./redact.js";

const VNR = "9999999999999999999";
const PASSWORD = "test-password";
const EFN = "123456789012345";
const DATUM = "2026-06-15";

/** The accredited period the mock enforces, as the real interface does. */
const BEGINN = "2026-01-01";
const ENDE = "2026-12-31";

const meldung = (efn: string, teilnahmedatum = DATUM) => ({
  efn,
  punkteBasis: true,
  punkteLernerfolg: true,
  punkteReferent: 0,
  teilnahmedatum,
});

let mock: MockServer;

beforeAll(async () => {
  mock = await startMockServer(0, {
    expectedVnr: VNR,
    expectedPassword: PASSWORD,
    eventBeginn: BEGINN,
    eventEnde: ENDE,
  });
});

afterAll(async () => {
  await mock.close();
});

const client = () =>
  new EivClient({ baseUrl: mock.url, vnr: VNR, vnrPassword: PASSWORD, timeoutMs: 2000 });

describe("the documented flow, end to end", () => {
  it("authenticates with Basic on a GET and reads the jwt", async () => {
    /*
     * The shape, not just the outcome. The previous client POSTed a JSON body
     * to `/auth/login` and read a `token` field — and every test passed,
     * because the mock had been built from the same guess (P31-01).
     */
    const auth = await client().authenticate();

    expect(auth.token).not.toBe("");
    expect(auth.exchange.method).toBe("GET");
    expect(auth.exchange.url).toContain("/fobi/veranstalter-auth/jwt");
    // The credential travels in a header, so it can never reach the audit log
    // through the recorded body.
    expect(auth.exchange.requestBody).toBeNull();
  });

  it("submits a Meldung carrying the point flags and the date", async () => {
    const { push } = await client().submit(meldung(EFN));

    expect(push.accepted).toBe(true);
    expect(push.exchange.requestBody).toMatchObject({
      punkte_basis_flag: true,
      punkte_lernerfolg_flag: true,
      punkte_referent: 0,
      teilnahmedatum: DATUM,
    });
  });

  it("sends neither vnr nor rolle — the token carries the VNR", async () => {
    const { push } = await client().submit(meldung("999888777666555"));
    const body = push.exchange.requestBody as Record<string, unknown>;

    expect(body["vnr"]).toBeUndefined();
    expect(body["rolle"]).toBeUndefined();
  });

  it("records the request and response verbatim for inspection", async () => {
    const { push } = await client().submit(meldung("999888777666556"));

    expect(push.exchange.method).toBe("POST");
    expect(push.exchange.url).toContain("/fobi/veranstalter/push_teilnahme");
    expect(push.exchange.status).toBe(200);
    expect(push.exchange.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("updates the same record on a repeat rather than filing a second", async () => {
    // The specification's own guarantee: the key is (EFN, VNR), a repeat
    // updates, and a repeat after an unclear 5xx is explicitly safe. That is
    // the property the whole retry queue rests on.
    const efn = "111122223333444";

    const first = await client().submit(meldung(efn));
    const before = mock.submissions.length;
    const second = await client().submit(meldung(efn, "2026-06-16"));

    expect(first.push.accepted).toBe(true);
    expect(second.push.accepted).toBe(true);
    expect(mock.submissions.length).toBe(before);
    expect(mock.submissions.find((r) => r.efn === efn)?.teilnahmedatum).toBe(
      "2026-06-16",
    );
  });

  it("decides on the status code, never on affectedRows", async () => {
    /*
     * *"Maßgeblich für die technische Bewertung einer Antwort ist immer der
     * HTTP-Statuscode, nicht einzelne interne Response-Felder wie affectedRows
     * oder messages."* The mock returns those fields precisely so a client that
     * started reading them would still pass here — this asserts we do not.
     */
    const { push } = await client().submit(meldung("222233334444555"));

    expect(push.exchange.responseBody).toMatchObject({ affectedRows: 1 });
    expect(Object.keys(push)).toEqual(["accepted", "exchange"]);
  });

  it("withdraws a Meldung by zeroing the points, keeping the record", async () => {
    const efn = "555566667777888";
    const auth = await client().authenticate();
    await client().pushTeilnahme(meldung(efn), auth.token);

    const before = mock.submissions.length;
    const withdrawal = await client().retractTeilnahme(efn, DATUM, auth.token);

    expect(withdrawal.accepted).toBe(true);
    // Not a delete: "der Vorgang bleibt nachvollziehbar".
    expect(mock.submissions.length).toBe(before);
    const record = mock.submissions.find((r) => r.efn === efn);
    expect(record?.punkteBasisFlag).toBe(0);
    expect(record?.punkteLernerfolgFlag).toBe(0);
    expect(record?.punkteReferent).toBe(0);
  });
});

describe("what EIV holds, which our own log cannot tell us", () => {
  it("reads the accredited period and the point values", async () => {
    // The two facts that answer S11 and S25 without writing to anybody.
    const auth = await client().authenticate();
    const { info } = await client().getVeranstaltung(auth.token);

    expect(info.beginn).toContain(BEGINN);
    expect(info.ende).toContain(ENDE);
    expect(info.punkteBasis).toBe(4);
    expect(info.gesperrtFuerVeranstalter).toBe(false);
  });

  it("lists what EIV believes it was told", async () => {
    const auth = await client().authenticate();
    await client().pushTeilnahme(meldung("777788889999000"), auth.token);

    const { rows } = await client().getGemeldetePunkte(auth.token);

    expect(rows.some((row) => row.efn === "777788889999000")).toBe(true);
  });
});

/**
 * The mock's behaviours have to be reachable from outside a unit test (P30-01).
 *
 * The mock implements seven, selected by the `x-mock-behaviour` header, and the
 * harness CLI could send no headers at all — so every failure path the retry
 * queue exists for could be exercised here and from nowhere a human could run
 * against a live process. The whole point of the harness (ADR-0005) is to
 * answer "does it behave as documented?" in minutes, and the interesting half
 * of that question is what happens when it does not.
 */
describe("extraHeaders", () => {
  it("carries a header the caller supplied", async () => {
    const forced = new EivClient({
      baseUrl: mock.url,
      vnr: VNR,
      vnrPassword: PASSWORD,
      timeoutMs: 2000,
      extraHeaders: { "x-mock-behaviour": "server_error" },
    });

    await expect(forced.authenticate()).rejects.toMatchObject({ kind: "server" });
  });

  it("cannot be used to forge the bearer token", async () => {
    // The token is applied after the spread, so a caller cannot present an
    // `authorization` header of their own choosing on the push.
    const forged = new EivClient({
      baseUrl: mock.url,
      vnr: VNR,
      vnrPassword: PASSWORD,
      timeoutMs: 2000,
      extraHeaders: { authorization: "Bearer forged" },
    });

    const { push } = await forged.submit(meldung("802769999000015"));
    expect(push.accepted).toBe(true);
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

  it("treats a malformed EFN as a non-retryable 422", async () => {
    // A format error will still be a format error in an hour. Retrying hides
    // the problem until the window has closed.
    const error = await client()
      .submit(meldung("12345"))
      .catch((e: unknown) => e);

    expect((error as EivError).kind).toBe("validation");
    expect((error as EivError).retryable).toBe(false);
    expect((error as EivError).message).toContain("15 Ziffern");
  });

  it("treats a date outside the accredited period as a non-retryable 406", async () => {
    /*
     * The failure most likely to bite an on-demand Fortbildung, and one the old
     * mock could not produce at all. It is *permanent* but its remedy is an
     * operator's or the Kammer's — not the physician's EFN — which is why it is
     * `business` and not `validation`.
     */
    const error = await client()
      .submit(meldung(EFN, "2027-01-01"))
      .catch((e: unknown) => e);

    expect((error as EivError).kind).toBe("business");
    expect((error as EivError).retryable).toBe(false);
    expect((error as EivError).exchange?.status).toBe(406);
  });

  it("treats a 429 as retryable, because the interface asks for backoff", async () => {
    const limited = new EivClient({
      baseUrl: mock.url,
      vnr: VNR,
      vnrPassword: PASSWORD,
      timeoutMs: 2000,
      extraHeaders: { "x-mock-behaviour": "rate_limited" },
    });

    const error = await limited.authenticate().catch((e: unknown) => e);

    expect((error as EivError).kind).toBe("rate_limited");
    // Abandoning here would drop a Meldung EIV was willing to accept.
    expect((error as EivError).retryable).toBe(true);
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
      .pushTeilnahme(meldung(EFN), "not-a-real-token")
      .catch((e: unknown) => e);

    expect((error as EivError).kind).toBe("auth");
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
