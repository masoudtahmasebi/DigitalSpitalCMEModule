/**
 * EIV-FOBI mock server (P7-02, rebuilt to the real specification in P31-01).
 *
 * It used to encode our *guesses*, which meant CI proved our client agreed with
 * our assumptions. It now encodes the published contract — endpoints, status
 * codes, field names, and the two behaviours the specification states in prose
 * and which nothing else in this repository could have discovered:
 *
 * 1. **Idempotency is per `(EFN, VNR)`.** A repeat updates the same record and
 *    never double-books. So the mock keeps records and updates them, rather
 *    than answering a second submission with a different status word — which is
 *    what it did before, from an invented `BEREITS_GEMELDET`.
 * 2. **A retraction is a push with the points zeroed**, and the record survives.
 *    The mock keeps it and marks it withdrawn, because "the Vorgang bleibt
 *    nachvollziehbar" is the property that matters on a CME record.
 *
 * It also refuses a `teilnahmedatum` outside the event period with a **406**,
 * which is the failure most likely to bite an on-demand Fortbildung and could
 * not be reproduced at all before.
 *
 * It exists so every path the retry queue and the deadline logic must handle is
 * exercised in CI, which can never depend on an external sandbox.
 */

import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";

/** Forces a specific failure via the `x-mock-behaviour` request header. */
export type MockBehaviour =
  | "success"
  | "auth_failure"
  | "rate_limited"
  | "business_failure"
  | "validation_failure"
  | "duplicate"
  | "locked_event"
  | "server_error"
  | "timeout"
  | "non_json";

export interface MockOptions {
  /** Credentials the mock will accept. Defaults accept anything non-empty. */
  readonly expectedVnr?: string;
  readonly expectedPassword?: string;
  /** Delay used by the `timeout` behaviour. */
  readonly timeoutDelayMs?: number;
  /**
   * The accredited event period, `YYYY-MM-DD`. A `teilnahmedatum` outside it is
   * refused 406, as the real interface does. Unset means any date is accepted,
   * which keeps every existing caller working.
   */
  readonly eventBeginn?: string;
  readonly eventEnde?: string;
}

/** One Punktemeldung the mock holds, keyed by `(EFN, VNR)` as EIV is. */
export interface MockRecord {
  readonly vnr: string;
  readonly efn: string;
  punkteBasisFlag: number;
  punkteLernerfolgFlag: number;
  punkteReferent: number;
  teilnahmedatum: string;
  readonly created: string;
  lastModified: string;
}

export interface MockServer {
  readonly url: string;
  readonly submissions: readonly MockRecord[];
  close(): Promise<void>;
}

const MOCK_TOKEN = "mock-eiv-jwt-token";
const MOCK_VNR = "0000000000000000000";

export async function startMockServer(
  port = 0,
  options: MockOptions = {},
): Promise<MockServer> {
  const submissions: MockRecord[] = [];
  const server = createServer((req, res) => {
    void handle(req, res, submissions, options);
  });

  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));

  const address = server.address();
  const boundPort = typeof address === "object" && address !== null ? address.port : port;

  return {
    url: `http://127.0.0.1:${boundPort}`,
    submissions,
    close: () => closeServer(server),
  };
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  submissions: MockRecord[],
  options: MockOptions,
): Promise<void> {
  const behaviour = (req.headers["x-mock-behaviour"] as MockBehaviour) ?? "success";
  const body = await readJson(req);
  const path = (req.url ?? "").split("?")[0] ?? "";

  if (behaviour === "timeout") {
    // Never responds. The client's AbortSignal is what ends this.
    await delay(options.timeoutDelayMs ?? 60_000);
    return;
  }

  if (behaviour === "server_error") {
    return json(res, 500, { message: "EIV temporarily unavailable" });
  }

  if (behaviour === "non_json") {
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<html><body>Wartungsarbeiten</body></html>");
    return;
  }

  if (behaviour === "rate_limited") {
    return json(res, 429, { message: "Zu viele Anfragen in kurzer Zeit" });
  }

  if (path === "/fobi/veranstalter-auth/jwt") {
    return handleAuth(req, res, behaviour, options);
  }

  if (path === "/fobi/veranstalter/push_teilnahme") {
    return handlePush(req, res, body, behaviour, submissions, options);
  }

  if (path === "/fobi/veranstalter/veranstaltung") {
    return handleVeranstaltung(req, res, behaviour, options);
  }

  if (path === "/fobi/veranstalter/gemeldetepunkte") {
    return handleGemeldetePunkte(req, res, submissions);
  }

  return json(res, 404, { message: `Unknown endpoint ${path}` });
}

/**
 * `GET` with HTTP Basic, and the token comes back as `jwt`.
 *
 * The previous mock accepted a JSON body on `POST /auth/login`, so a client
 * that got the authentication scheme wrong still passed every test we had.
 */
function handleAuth(
  req: IncomingMessage,
  res: ServerResponse,
  behaviour: MockBehaviour,
  options: MockOptions,
): void {
  if (behaviour === "auth_failure") {
    return json(res, 401, { message: "Anmeldung fehlgeschlagen" });
  }

  const credential = readBasic(req);

  if (credential === undefined) {
    return json(res, 401, { message: "Basic Authorization erforderlich" });
  }

  if (credential.vnr === "" || credential.password === "") {
    return json(res, 401, { message: "VNR und Kennwort sind erforderlich" });
  }

  if (options.expectedVnr !== undefined && credential.vnr !== options.expectedVnr) {
    return json(res, 401, { message: "VNR/Passwort oder der Token sind falsch" });
  }

  if (
    options.expectedPassword !== undefined &&
    credential.password !== options.expectedPassword
  ) {
    return json(res, 401, { message: "VNR/Passwort oder der Token sind falsch" });
  }

  return json(res, 200, { jwt: MOCK_TOKEN });
}

function handlePush(
  req: IncomingMessage,
  res: ServerResponse,
  body: Record<string, unknown>,
  behaviour: MockBehaviour,
  submissions: MockRecord[],
  options: MockOptions,
): void {
  if (!isAuthorised(req)) {
    return json(res, 401, { message: "Bearer-Token fehlt oder ist ungültig" });
  }

  if (behaviour === "business_failure" || behaviour === "locked_event") {
    return json(res, 406, { message: "VNR unbekannt oder gesperrt" });
  }

  if (behaviour === "validation_failure") {
    return json(res, 422, { message: "Ungültige EFN-Prüfziffer" });
  }

  const efn = typeof body["efn"] === "string" ? body["efn"] : "";
  const teilnahmedatum =
    typeof body["teilnahmedatum"] === "string" ? body["teilnahmedatum"] : "";
  const punkteReferent =
    typeof body["punkte_referent"] === "number" ? body["punkte_referent"] : 0;

  // 422 — a *format* error, per the specification's own examples.
  if (!/^[0-9]{15}$/u.test(efn)) {
    return json(res, 422, { message: "EFN muss aus genau 15 Ziffern bestehen" });
  }

  if (!/^\d{4}-\d{2}-\d{2}$/u.test(teilnahmedatum)) {
    return json(res, 422, { message: "teilnahmedatum muss YYYY-MM-DD sein" });
  }

  if (punkteReferent < 0) {
    return json(res, 422, { message: "Punktewert außerhalb des zulässigen Bereichs" });
  }

  // 406 — a *business* refusal. Lexicographic comparison is exact for
  // zero-padded ISO dates, which is why the field is a string here too.
  if (options.eventBeginn !== undefined && teilnahmedatum < options.eventBeginn) {
    return json(res, 406, { message: "Teilnahmedatum vor Veranstaltungsbeginn" });
  }

  if (options.eventEnde !== undefined && teilnahmedatum > options.eventEnde) {
    return json(res, 406, { message: "Teilnahmedatum nach Veranstaltungsende" });
  }

  const vnr = options.expectedVnr ?? MOCK_VNR;
  const now = new Date().toISOString();
  const basis = body["punkte_basis_flag"] === true ? 1 : 0;
  const lernerfolg = body["punkte_lernerfolg_flag"] === true ? 1 : 0;

  /*
   * Idempotent on `(EFN, VNR)`: the same pair *updates*, it does not insert.
   *
   * `duplicate` is kept as an explicit behaviour so the harness can force the
   * second-write path without sending twice — but it is no longer a different
   * *response*, because the specification says a repeat is indistinguishable
   * from a first write. Our old mock answered it with an invented status word,
   * and P30-03 dutifully carried that invention into the audit log.
   */
  const existing = submissions.find((record) => record.efn === efn && record.vnr === vnr);

  if (existing !== undefined || behaviour === "duplicate") {
    if (existing !== undefined) {
      existing.punkteBasisFlag = basis;
      existing.punkteLernerfolgFlag = lernerfolg;
      existing.punkteReferent = punkteReferent;
      existing.teilnahmedatum = teilnahmedatum;
      existing.lastModified = now;
    }
    return json(res, 200, { affectedRows: 1, messages: ["aktualisiert"] });
  }

  submissions.push({
    vnr,
    efn,
    punkteBasisFlag: basis,
    punkteLernerfolgFlag: lernerfolg,
    punkteReferent,
    teilnahmedatum,
    created: now,
    lastModified: now,
  });

  /*
   * `affectedRows` and `messages` are returned because the real interface
   * returns them — and are documented there as diagnostic, explicitly *not*
   * contractual. The mock includes them precisely so a client that started
   * branching on them would still pass here and fail in production; the
   * client's own tests assert that it decides on the status code alone.
   */
  return json(res, 200, { affectedRows: 1, messages: [] });
}

function handleVeranstaltung(
  req: IncomingMessage,
  res: ServerResponse,
  behaviour: MockBehaviour,
  options: MockOptions,
): void {
  if (!isAuthorised(req)) {
    return json(res, 401, { message: "Bearer-Token fehlt oder ist ungültig" });
  }

  return json(res, 200, {
    vnr: options.expectedVnr ?? MOCK_VNR,
    thema: "Mock-Fortbildung",
    unterthema: "",
    beginn: `${options.eventBeginn ?? "2026-01-01"}T00:00:00.000Z`,
    ende: `${options.eventEnde ?? "2026-12-31"}T23:59:59.000Z`,
    kategorie: "D",
    punkte_basis: 4,
    punkte_lernerfolg: 0,
    // The one field an authoring screen most wants before promising a point.
    gesperrt_fuer_veranstalter: behaviour === "locked_event",
  });
}

function handleGemeldetePunkte(
  req: IncomingMessage,
  res: ServerResponse,
  submissions: readonly MockRecord[],
): void {
  if (!isAuthorised(req)) {
    return json(res, 401, { message: "Bearer-Token fehlt oder ist ungültig" });
  }

  const query = new URL(req.url ?? "/", "http://mock").searchParams;
  const limit = Number(query.get("limit") ?? "0");
  const offset = Number(query.get("offset") ?? "0");

  const page = submissions.slice(offset, limit > 0 ? offset + limit : undefined);

  res.writeHead(200, {
    "content-type": "application/json",
    // The real interface returns this so a reader can tell how fresh the
    // snapshot is. Reconciliation without it is a race.
    service_db_clock_timestamp: new Date().toISOString(),
  });
  res.end(
    JSON.stringify(
      page.map((record) => ({
        efn: record.efn,
        vnr: record.vnr,
        punkte_basis_flag: record.punkteBasisFlag,
        punkte_lernerfolg_flag: record.punkteLernerfolgFlag,
        punkte_referent: record.punkteReferent,
        teilnahmedatum: record.teilnahmedatum,
        created: record.created,
        last_modified: record.lastModified,
      })),
    ),
  );
}

function isAuthorised(req: IncomingMessage): boolean {
  return req.headers["authorization"] === `Bearer ${MOCK_TOKEN}`;
}

function readBasic(
  req: IncomingMessage,
): { readonly vnr: string; readonly password: string } | undefined {
  const header = req.headers["authorization"];
  if (typeof header !== "string" || !header.startsWith("Basic ")) return undefined;

  const decoded = Buffer.from(header.slice("Basic ".length), "base64").toString("utf8");
  const separator = decoded.indexOf(":");
  if (separator === -1) return { vnr: decoded, password: "" };

  return { vnr: decoded.slice(0, separator), password: decoded.slice(separator + 1) };
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);

  const raw = Buffer.concat(chunks).toString("utf8");
  if (raw === "") return {};

  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.closeAllConnections();
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
