/**
 * EIV-FOBI client (P7-01, rewritten against the real specification in P31-01).
 *
 * ## What changed, and why it is a rewrite rather than an edit
 *
 * ADR-0005 built this from a prose description because the Swagger was not
 * reachable (S24). The specification arrived on 09.08 and **every assumption in
 * the previous version was wrong**:
 *
 * | We assumed                                    | It actually is                                    |
 * | --------------------------------------------- | ------------------------------------------------- |
 * | `POST /auth/login` with a JSON body           | `GET /fobi/veranstalter-auth/jwt` with HTTP Basic |
 * | the token comes back as `token`               | `jwt`                                             |
 * | the push body carries `vnr` and `rolle`       | neither — the VNR is *in the token*               |
 * | the push body is `{ vnr, efn, rolle }`        | `{ efn, punkte_*_flag, punkte_referent, teilnahmedatum }` |
 * | `422` is the business rejection               | `406` is; `422` is a *format* error                |
 * | success returns `{ referenz, status }`        | it returns diagnostics that are **not contractual** |
 *
 * That last row is the one worth reading twice. The specification says, in
 * terms: *"Maßgeblich für die technische Bewertung einer Antwort ist immer der
 * HTTP-Statuscode, nicht einzelne interne Response-Felder wie `affectedRows`
 * oder `messages`."* So this client decides on the status code and records the
 * body verbatim for a human. It never branches on a response field.
 *
 * ## The three things the specification guarantees that we rely on
 *
 * 1. **Idempotency is per `(EFN, VNR)`.** A repeat with an unchanged payload
 *    updates the same record rather than double-booking, and is explicitly safe
 *    after a 5xx whose outcome is unknown. That is precisely the case the retry
 *    queue exists for.
 * 2. **A retraction is a normal push** with both flags false and
 *    `punkte_referent: 0`. There is no delete, and the record stays auditable.
 *    This is the correction mechanism `packages/domain` computes a window for
 *    and previously had no way to perform.
 * 3. **`teilnahmedatum` must fall inside the accredited event period**, or the
 *    call is refused 406. The period is readable — `GET
 *    /fobi/veranstalter/veranstaltung` returns `beginn` and `ende` — which is
 *    what makes that refusal preventable rather than a surprise at submission
 *    time. See `getVeranstaltung`.
 *
 * `baseUrl` remains the only difference between mock, test system and live.
 */

import { redact } from "./redact.js";

export interface EivClientOptions {
  readonly baseUrl: string;
  readonly vnr: string;
  readonly vnrPassword: string;
  readonly timeoutMs?: number;
  /**
   * Extra request headers, for the contract harness only.
   *
   * The mock takes its behaviour from `x-mock-behaviour`, and until this
   * existed the harness could reach none of the behaviours: the CLI had no way
   * to send a header, so the failure paths the whole retry queue is built
   * around could be exercised from unit tests and from nowhere a human could
   * type.
   *
   * Deliberately a general header map rather than a `behaviour` option: the
   * production client must not grow a concept of "mock". Nothing sets it in
   * production — `EivAccreditationReporter` does not pass it.
   */
  readonly extraHeaders?: Readonly<Record<string, string>>;
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
 * The distinction is load-bearing, and the specification made it finer than we
 * had it. `business` and `validation` are both permanent and need different
 * human action:
 *
 * - `business` (406) — the VNR is unknown or blocked, or the `teilnahmedatum`
 *   is outside the accredited period. The submission is well-formed; the
 *   *event* is the problem, and only an operator or the Ärztekammer can fix it.
 * - `validation` (422) — the payload is malformed: a failed EFN check digit, a
 *   point value out of range. The physician's EFN is the problem.
 *
 * Retrying either forever hides the problem until the correction window has
 * closed. Reporting them identically sends an operator to the wrong place.
 */
export type EivFailureKind =
  | "transport"
  | "auth"
  | "rate_limited"
  | "business"
  | "validation"
  | "server"
  | "unknown";

export class EivError extends Error {
  constructor(
    readonly kind: EivFailureKind,
    message: string,
    readonly exchange?: EivExchange,
  ) {
    super(message);
    this.name = "EivError";
  }

  /**
   * `rate_limited` is retryable, and the specification asks for backoff by
   * name — *"Bitte mit angemessenem Backoff erneut versuchen."* The existing
   * exponential policy in `@ds/domain` already provides one; what matters here
   * is that a 429 is not mistaken for a permanent refusal and dropped.
   */
  get retryable(): boolean {
    return (
      this.kind === "transport" || this.kind === "server" || this.kind === "rate_limited"
    );
  }
}

export interface AuthenticateResult {
  readonly token: string;
  readonly exchange: EivExchange;
}

/**
 * One Punktemeldung, in the platform's vocabulary.
 *
 * The point flags are **inputs**, not something this client decides. Which
 * flags a completion earns is an accreditation question — the Bescheid awards
 * points for the Fortbildung and separately for the Lernerfolgskontrolle — and
 * `CLAUDE.md` §7 is explicit that a client is not the place to invent one.
 */
export interface TeilnahmeMeldung {
  /** 15 digits, including the check digit EIV validates. */
  readonly efn: string;
  /** Points for attending. */
  readonly punkteBasis: boolean;
  /** Points for passing the Lernerfolgskontrolle. */
  readonly punkteLernerfolg: boolean;
  /** Speaker points. Always 0 here — every participant is a Teilnehmer. */
  readonly punkteReferent: number;
  /**
   * `YYYY-MM-DD`, and it must fall inside the accredited event period or EIV
   * answers 406. Produced by `formatBerlinIsoDate` — the date is the one that
   * was on a German calendar, not on a UTC clock.
   */
  readonly teilnahmedatum: string;
}

export interface PushTeilnahmeResult {
  /**
   * Decided by the HTTP status alone, as the specification requires.
   *
   * There is no reference and no status word to read: EIV issues neither. The
   * previous version of this file invented both, and the audit log recorded
   * `null` for a field that will never be populated by this authority.
   */
  readonly accepted: boolean;
  readonly exchange: EivExchange;
}

/** What EIV holds about the accredited event behind a VNR. */
export interface VeranstaltungsInfos {
  readonly vnr?: string;
  readonly thema?: string;
  readonly unterthema?: string;
  /** The accredited period. A `teilnahmedatum` outside it is refused 406. */
  readonly beginn?: string;
  readonly ende?: string;
  readonly kategorie?: string;
  readonly punkteBasis?: number;
  readonly punkteLernerfolg?: number;
  /** True when the Kammer has locked the event against further reporting. */
  readonly gesperrtFuerVeranstalter?: boolean;
}

/** One row of what EIV believes it has already been told. */
export interface GemeldeterPunkt {
  readonly efn?: string;
  readonly vnr?: string;
  readonly punkteBasisFlag?: number;
  readonly punkteLernerfolgFlag?: number;
  readonly punkteReferent?: number;
  readonly teilnahmedatum?: string;
  readonly created?: string;
  readonly lastModified?: string;
}

export class EivClient {
  private readonly timeoutMs: number;

  constructor(private readonly options: EivClientOptions) {
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  /**
   * Exchange VNR + password for a JWT.
   *
   * Basic auth on a **GET**, which is unusual enough to be worth stating: the
   * credentials are in the `Authorization` header, not in a body, so they never
   * reach `EivExchange.requestBody` and therefore never reach the audit log or
   * the harness's printed output. That is a happy accident of the real design
   * and better than what we had, where `redact()` had to defend a password that
   * was in the payload.
   *
   * Tokens are invalidated when the VNRPWD changes, so a 401 on a *push* means
   * "get a new token", not necessarily "the credentials are wrong".
   */
  async authenticate(): Promise<AuthenticateResult> {
    const exchange = await this.request("GET", "/fobi/veranstalter-auth/jwt", {
      basic: true,
    });

    if (exchange.status === 401 || exchange.status === 403) {
      throw new EivError("auth", "EIV rejected the VNR credentials", exchange);
    }

    if (exchange.status === 429) {
      throw new EivError("rate_limited", "EIV rate-limited the token request", exchange);
    }

    if (exchange.status >= 500) {
      throw new EivError("server", `EIV returned ${exchange.status}`, exchange);
    }

    const token = readString(asRecord(exchange.responseBody), "jwt");

    if (token === undefined) {
      throw new EivError(
        "unknown",
        "EIV returned no jwt on a successful authenticate",
        exchange,
      );
    }

    return { token, exchange };
  }

  /** Report a participation. Repeating this with an unchanged payload is safe. */
  async pushTeilnahme(
    meldung: TeilnahmeMeldung,
    token: string,
  ): Promise<PushTeilnahmeResult> {
    const exchange = await this.request("POST", "/fobi/veranstalter/push_teilnahme", {
      token,
      body: {
        efn: meldung.efn,
        punkte_basis_flag: meldung.punkteBasis,
        punkte_lernerfolg_flag: meldung.punkteLernerfolg,
        punkte_referent: meldung.punkteReferent,
        teilnahmedatum: meldung.teilnahmedatum,
      },
    });

    this.throwOnPushFailure(exchange);

    return { accepted: exchange.status >= 200 && exchange.status < 300, exchange };
  }

  /**
   * Withdraw a Punktemeldung already sent.
   *
   * Not a delete — the specification is explicit that the record survives and
   * stays auditable, which is the right shape for a CME record. It is the same
   * endpoint with the points zeroed, so it inherits the same idempotency.
   *
   * `teilnahmedatum` is still required and still checked against the event
   * period, so a withdrawal after the period closes is refused like any other
   * push. That is the API's version of the 7-day correction window and matches
   * what `eivDeadlines` already computes.
   */
  async retractTeilnahme(
    efn: string,
    teilnahmedatum: string,
    token: string,
  ): Promise<PushTeilnahmeResult> {
    return this.pushTeilnahme(
      {
        efn,
        punkteBasis: false,
        punkteLernerfolg: false,
        punkteReferent: 0,
        teilnahmedatum,
      },
      token,
    );
  }

  /**
   * What EIV holds about this VNR's event.
   *
   * The reason this is worth having: `beginn`/`ende` are what a
   * `teilnahmedatum` is checked against, and `gesperrt_fuer_veranstalter` says
   * whether reporting is open at all. Both are knowable *before* a physician
   * completes, which turns a 406 at submission time — after the CME point has
   * been promised on screen — into a warning at authoring time.
   */
  async getVeranstaltung(
    token: string,
  ): Promise<{ readonly info: VeranstaltungsInfos; readonly exchange: EivExchange }> {
    const exchange = await this.request("GET", "/fobi/veranstalter/veranstaltung", {
      token,
    });

    this.throwOnReadFailure(exchange);

    const body = asRecord(exchange.responseBody);

    return {
      info: {
        ...optional("vnr", readString(body, "vnr")),
        ...optional("thema", readString(body, "thema")),
        ...optional("unterthema", readString(body, "unterthema")),
        ...optional("beginn", readString(body, "beginn")),
        ...optional("ende", readString(body, "ende")),
        ...optional("kategorie", readString(body, "kategorie")),
        ...optional("punkteBasis", readNumber(body, "punkte_basis")),
        ...optional("punkteLernerfolg", readNumber(body, "punkte_lernerfolg")),
        ...optional(
          "gesperrtFuerVeranstalter",
          readBoolean(body, "gesperrt_fuer_veranstalter"),
        ),
      },
      exchange,
    };
  }

  /**
   * What EIV believes it has already been told about this VNR.
   *
   * This is the reconciliation the platform has never had. Our own
   * `eiv_submissions` table records what we *sent*; this says what the
   * Ärztekammer *holds*. A disagreement between the two is the one failure mode
   * an append-only log of our own attempts cannot detect.
   */
  async getGemeldetePunkte(
    token: string,
    page: { readonly limit?: number; readonly offset?: number } = {},
  ): Promise<{
    readonly rows: readonly GemeldeterPunkt[];
    readonly exchange: EivExchange;
  }> {
    const query = new URLSearchParams();
    if (page.limit !== undefined) query.set("limit", String(page.limit));
    if (page.offset !== undefined) query.set("offset", String(page.offset));
    const suffix = query.size === 0 ? "" : `?${query.toString()}`;

    const exchange = await this.request(
      "GET",
      `/fobi/veranstalter/gemeldetepunkte${suffix}`,
      { token },
    );

    this.throwOnReadFailure(exchange);

    const rows = Array.isArray(exchange.responseBody) ? exchange.responseBody : [];

    return {
      rows: rows.map((row) => {
        const record = asRecord(row);
        return {
          ...optional("efn", readString(record, "efn")),
          ...optional("vnr", readString(record, "vnr")),
          ...optional("punkteBasisFlag", readNumber(record, "punkte_basis_flag")),
          ...optional(
            "punkteLernerfolgFlag",
            readNumber(record, "punkte_lernerfolg_flag"),
          ),
          ...optional("punkteReferent", readNumber(record, "punkte_referent")),
          ...optional("teilnahmedatum", readString(record, "teilnahmedatum")),
          ...optional("created", readString(record, "created")),
          ...optional("lastModified", readString(record, "last_modified")),
        };
      }),
      exchange,
    };
  }

  /** Authenticate and submit in one call — the whole documented flow. */
  async submit(meldung: TeilnahmeMeldung): Promise<{
    readonly auth: AuthenticateResult;
    readonly push: PushTeilnahmeResult;
  }> {
    const auth = await this.authenticate();
    const push = await this.pushTeilnahme(meldung, auth.token);
    return { auth, push };
  }

  private throwOnPushFailure(exchange: EivExchange): void {
    if (exchange.status === 401 || exchange.status === 403) {
      throw new EivError("auth", "EIV rejected the bearer token", exchange);
    }

    if (exchange.status === 406) {
      throw new EivError(
        "business",
        `EIV refused the Meldung on business grounds: ${describe(exchange.responseBody)}`,
        exchange,
      );
    }

    if (exchange.status === 400 || exchange.status === 422) {
      throw new EivError(
        "validation",
        `EIV rejected the payload as malformed: ${describe(exchange.responseBody)}`,
        exchange,
      );
    }

    if (exchange.status === 429) {
      throw new EivError("rate_limited", "EIV rate-limited the Meldung", exchange);
    }

    if (exchange.status >= 500) {
      throw new EivError("server", `EIV returned ${exchange.status}`, exchange);
    }
  }

  private throwOnReadFailure(exchange: EivExchange): void {
    if (exchange.status === 401 || exchange.status === 403) {
      throw new EivError("auth", "EIV rejected the bearer token", exchange);
    }

    if (exchange.status === 429) {
      throw new EivError("rate_limited", "EIV rate-limited the request", exchange);
    }

    if (exchange.status >= 500) {
      throw new EivError("server", `EIV returned ${exchange.status}`, exchange);
    }

    if (exchange.status < 200 || exchange.status >= 300) {
      throw new EivError("unknown", `EIV returned ${exchange.status}`, exchange);
    }
  }

  private async request(
    method: "GET" | "POST",
    path: string,
    auth: {
      readonly basic?: boolean;
      readonly token?: string;
      readonly body?: unknown;
    },
  ): Promise<EivExchange> {
    const url = new URL(
      path.replace(/^\//u, ""),
      ensureTrailingSlash(this.options.baseUrl),
    ).toString();
    const startedAt = performance.now();

    const headers: Record<string, string> = {
      accept: "application/json",
      ...this.options.extraHeaders,
    };
    if (auth.body !== undefined) headers["content-type"] = "application/json";

    /*
     * After the spread, always. A caller must not be able to forge or replace
     * the credential by passing an `authorization` header of its own — the
     * harness sets `extraHeaders` from a command line.
     */
    if (auth.basic === true) {
      const encoded = Buffer.from(
        `${this.options.vnr}:${this.options.vnrPassword}`,
        "utf8",
      ).toString("base64");
      headers["authorization"] = `Basic ${encoded}`;
    } else if (auth.token !== undefined) {
      headers["authorization"] = `Bearer ${auth.token}`;
    }

    let response: Response;

    try {
      response = await fetch(url, {
        method,
        headers,
        ...(auth.body === undefined ? {} : { body: JSON.stringify(auth.body) }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (cause) {
      // Never surfaces headers: the Basic credential lives in one.
      throw new EivError(
        "transport",
        `Could not reach EIV at ${url}: ${(cause as Error).message}`,
      );
    }

    return {
      method,
      url,
      requestBody: auth.body === undefined ? null : redact(auth.body),
      status: response.status,
      responseBody: await readBody(response),
      durationMs: Math.round(performance.now() - startedAt),
    };
  }
}

/**
 * `new URL("/a", "https://h/base/")` discards `/base`. The specification's
 * server is a bare host today, but a deployment behind a path prefix is exactly
 * the kind of thing that changes without warning, and losing the prefix
 * silently would send a Punktemeldung to the wrong place.
 */
function ensureTrailingSlash(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
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

/**
 * A response body, for a human reading an error message.
 *
 * Deliberately not a field read. The specification warns that the error shapes
 * are "historisch gewachsen" and not uniform, so picking one key would be
 * right for some endpoints and silently empty for others.
 */
function describe(body: unknown): string {
  if (typeof body === "string") return body.slice(0, 200);
  if (body === null || body === undefined) return "no body";
  const message = readString(asRecord(body), "message");
  if (message !== undefined) return message;
  return JSON.stringify(body).slice(0, 200);
}

function asRecord(body: unknown): Record<string, unknown> {
  return typeof body === "object" && body !== null
    ? (body as Record<string, unknown>)
    : {};
}

function readString(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  return typeof value === "string" ? value : undefined;
}

function readNumber(body: Record<string, unknown>, key: string): number | undefined {
  const value = body[key];
  return typeof value === "number" ? value : undefined;
}

function readBoolean(body: Record<string, unknown>, key: string): boolean | undefined {
  const value = body[key];
  return typeof value === "boolean" ? value : undefined;
}

/** `exactOptionalPropertyTypes` forbids assigning `undefined` to an optional. */
function optional<K extends string, V>(
  key: K,
  value: V | undefined,
): Record<K, V> | Record<string, never> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}
