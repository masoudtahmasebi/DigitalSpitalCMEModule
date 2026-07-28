/**
 * EIV-FOBI mock server (P7-02), implementing ADR-0005.
 *
 * Built to the DOCUMENTED contract. It encodes our assumptions about an
 * interface whose behaviour we have not yet observed — see `README.md` in this
 * directory for the field-by-field list, so that a real divergence is a diff
 * rather than an investigation.
 *
 * It exists so that every code path the retry queue and deadline logic must
 * handle — success, validation rejection, auth failure, duplicate, timeout,
 * 5xx — is exercised in CI, which can never depend on an external sandbox.
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
  | "validation_failure"
  | "duplicate"
  | "server_error"
  | "timeout"
  | "non_json";

export interface MockOptions {
  /** Credentials the mock will accept. Defaults accept anything non-empty. */
  readonly expectedVnr?: string;
  readonly expectedPassword?: string;
  /** Delay used by the `timeout` behaviour. */
  readonly timeoutDelayMs?: number;
}

export interface MockRecord {
  readonly vnr: string;
  readonly efn: string;
  readonly rolle: string;
  readonly reference: string;
}

export interface MockServer {
  readonly url: string;
  readonly submissions: readonly MockRecord[];
  close(): Promise<void>;
}

const MOCK_TOKEN = "mock-eiv-jwt-token";

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

  if (behaviour === "timeout") {
    // Never responds. The client's AbortSignal is what ends this.
    await delay(options.timeoutDelayMs ?? 60_000);
    return;
  }

  if (behaviour === "server_error") {
    return json(res, 503, { message: "EIV temporarily unavailable" });
  }

  if (behaviour === "non_json") {
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<html><body>Wartungsarbeiten</body></html>");
    return;
  }

  if (req.url === "/auth/login") {
    return handleAuth(res, body, behaviour, options);
  }

  if (req.url === "/fobi/veranstalter/push_teilnahme") {
    return handlePush(req, res, body, behaviour, submissions);
  }

  return json(res, 404, { message: `Unknown endpoint ${req.url ?? ""}` });
}

function handleAuth(
  res: ServerResponse,
  body: Record<string, unknown>,
  behaviour: MockBehaviour,
  options: MockOptions,
): void {
  if (behaviour === "auth_failure") {
    return json(res, 401, { message: "Ungültige VNR oder Passwort" });
  }

  const vnr = typeof body["vnr"] === "string" ? body["vnr"] : "";
  const passwort = typeof body["passwort"] === "string" ? body["passwort"] : "";

  if (vnr === "" || passwort === "") {
    return json(res, 401, { message: "VNR und Passwort sind erforderlich" });
  }

  if (options.expectedVnr !== undefined && vnr !== options.expectedVnr) {
    return json(res, 401, { message: "Ungültige VNR oder Passwort" });
  }

  if (options.expectedPassword !== undefined && passwort !== options.expectedPassword) {
    return json(res, 401, { message: "Ungültige VNR oder Passwort" });
  }

  return json(res, 200, { token: MOCK_TOKEN, expiresIn: 3600 });
}

function handlePush(
  req: IncomingMessage,
  res: ServerResponse,
  body: Record<string, unknown>,
  behaviour: MockBehaviour,
  submissions: MockRecord[],
): void {
  const authorization = req.headers["authorization"];

  if (authorization !== `Bearer ${MOCK_TOKEN}`) {
    return json(res, 401, { message: "Bearer-Token fehlt oder ist ungültig" });
  }

  if (behaviour === "validation_failure") {
    return json(res, 422, { message: "EFN ist der Ärztekammer nicht bekannt" });
  }

  const vnr = typeof body["vnr"] === "string" ? body["vnr"] : "";
  const efn = typeof body["efn"] === "string" ? body["efn"] : "";
  const rolle = typeof body["rolle"] === "string" ? body["rolle"] : "";

  if (!/^[0-9]{15}$/.test(efn)) {
    return json(res, 422, { message: "EFN muss aus genau 15 Ziffern bestehen" });
  }

  if (rolle !== "TEILNEHMER") {
    return json(res, 422, { message: `Unbekannte Rolle: ${rolle}` });
  }

  const existing = submissions.find((record) => record.efn === efn && record.vnr === vnr);

  // Assumed behaviour: a repeat submission is acknowledged idempotently rather
  // than rejected. Flagged in README.md as unverified.
  if (existing !== undefined || behaviour === "duplicate") {
    return json(res, 200, {
      referenz: existing?.reference ?? "MOCK-DUPLICATE",
      status: "BEREITS_GEMELDET",
    });
  }

  const reference = `MOCK-${(submissions.length + 1).toString().padStart(6, "0")}`;
  submissions.push({ vnr, efn, rolle, reference });

  return json(res, 200, { referenz: reference, status: "ANGENOMMEN" });
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
