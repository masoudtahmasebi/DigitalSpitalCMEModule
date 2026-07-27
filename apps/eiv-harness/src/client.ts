/**
 * EIV-FOBI client (P7-01), implementing ADR-0005.
 *
 * The real sequence, exactly as documented:
 *
 *   authenticate (VNR + password) -> JWT
 *   POST /fobi/veranstalter/push_teilnahme { vnr, efn, rolle: "TEILNEHMER" }
 *
 * `baseUrl` is the only difference between mock, sandbox and live. Nothing else
 * changes when credentials arrive, which is the entire point of building this
 * in week 1 rather than week 5.
 */

import { redact } from "./redact.js";

export const ROLE_TEILNEHMER = "TEILNEHMER";

export interface EivClientOptions {
  readonly baseUrl: string;
  readonly vnr: string;
  readonly vnrPassword: string;
  readonly timeoutMs?: number;
}

export interface EivExchange {
  readonly method: string;
  readonly url: string;
  readonly requestBody: unknown;
  readonly status: number;
  readonly responseBody: unknown;
  readonly durationMs: number;
}

/**
 * How a failure should be treated by the retry queue (P7-06).
 *
 * The distinction is load-bearing: a transport failure deserves backoff, and a
 * validation rejection must never be retried — an EFN the Ärztekammer does not
 * recognise will still be unrecognised in an hour, and retrying it forever
 * hides the problem until the correction window has closed.
 */
export type EivFailureKind = "transport" | "auth" | "validation" | "server" | "unknown";

export class EivError extends Error {
  constructor(
    readonly kind: EivFailureKind,
    message: string,
    readonly exchange?: EivExchange,
  ) {
    super(message);
    this.name = "EivError";
  }

  get retryable(): boolean {
    return this.kind === "transport" || this.kind === "server";
  }
}

export interface AuthenticateResult {
  readonly token: string;
  readonly exchange: EivExchange;
}

export interface PushTeilnahmeResult {
  readonly accepted: boolean;
  /** Reference returned by EIV, persisted for later correction (P7-05). */
  readonly reference?: string;
  readonly exchange: EivExchange;
}

export class EivClient {
  private readonly timeoutMs: number;

  constructor(private readonly options: EivClientOptions) {
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  async authenticate(): Promise<AuthenticateResult> {
    const exchange = await this.send("/auth/login", {
      vnr: this.options.vnr,
      passwort: this.options.vnrPassword,
    });

    if (exchange.status === 401 || exchange.status === 403) {
      throw new EivError("auth", "EIV rejected the VNR credentials", exchange);
    }

    if (exchange.status >= 500) {
      throw new EivError("server", `EIV returned ${exchange.status}`, exchange);
    }

    const token = readString(exchange.responseBody, "token");

    if (token === undefined) {
      throw new EivError(
        "unknown",
        "EIV returned no token on a successful authenticate",
        exchange,
      );
    }

    return { token, exchange };
  }

  async pushTeilnahme(efn: string, token: string): Promise<PushTeilnahmeResult> {
    const exchange = await this.send(
      "/fobi/veranstalter/push_teilnahme",
      { vnr: this.options.vnr, efn, rolle: ROLE_TEILNEHMER },
      token,
    );

    if (exchange.status === 401 || exchange.status === 403) {
      throw new EivError("auth", "EIV rejected the bearer token", exchange);
    }

    if (exchange.status === 400 || exchange.status === 422) {
      throw new EivError(
        "validation",
        `EIV rejected the submission: ${readString(exchange.responseBody, "message") ?? "no reason given"}`,
        exchange,
      );
    }

    if (exchange.status >= 500) {
      throw new EivError("server", `EIV returned ${exchange.status}`, exchange);
    }

    const reference = readString(exchange.responseBody, "referenz");

    return {
      accepted: exchange.status >= 200 && exchange.status < 300,
      ...(reference === undefined ? {} : { reference }),
      exchange,
    };
  }

  /** Authenticate and submit in one call — the whole documented flow. */
  async submit(efn: string): Promise<{
    readonly auth: AuthenticateResult;
    readonly push: PushTeilnahmeResult;
  }> {
    const auth = await this.authenticate();
    const push = await this.pushTeilnahme(efn, auth.token);
    return { auth, push };
  }

  private async send(path: string, body: unknown, token?: string): Promise<EivExchange> {
    const url = new URL(path, this.options.baseUrl).toString();
    const startedAt = performance.now();

    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json",
    };
    if (token !== undefined) headers["authorization"] = `Bearer ${token}`;

    let response: Response;

    try {
      response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (cause) {
      // Never surfaces the request body: it holds the VNR password.
      throw new EivError(
        "transport",
        `Could not reach EIV at ${url}: ${(cause as Error).message}`,
      );
    }

    return {
      method: "POST",
      url,
      requestBody: redact(body),
      status: response.status,
      responseBody: await readBody(response),
      durationMs: Math.round(performance.now() - startedAt),
    };
  }
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text === "") return null;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    // Reported verbatim: a non-JSON body is exactly the kind of divergence
    // from the documentation this harness exists to surface.
    return text;
  }
}

function readString(body: unknown, key: string): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const value = (body as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}
