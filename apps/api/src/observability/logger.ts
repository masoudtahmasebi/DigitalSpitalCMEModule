/**
 * One JSON object per line, redacted, with the request's id on it (P25-01).
 *
 * ## Why JSON and not Nest's pretty printer
 *
 * Nest's default logger writes coloured, human-shaped lines. That is pleasant
 * in a terminal and close to useless on a server: `journalctl | grep` cannot
 * answer "every 500 for customer X in the last hour" against prose, and the
 * ANSI escapes make even the grep awkward.
 *
 * One JSON object per line is greppable with `jq`, ingestible by anything, and
 * still readable by a person. The platform runs on one small host with
 * `docker compose` and `journalctl`, so this has to work with no log shipper at
 * all — and it does: `./dsc logs api | jq 'select(.level=="error")'`.
 *
 * ## Everything goes through `redact`
 *
 * Not "everything sensitive" — everything. `docs/gdpr.md` §7 claims no personal
 * data reaches application logs, and that claim cannot rest on each caller
 * remembering which of its fields might contain an EFN. A `pg` error quoting a
 * failing row is the case nobody writes on purpose.
 *
 * ## Why it implements Nest's LoggerService
 *
 * So framework messages — the ones Nest writes about routes, lifecycle and
 * unhandled exceptions — land in the same stream and the same shape. A log
 * that is half JSON and half prose is one somebody has to parse twice.
 */

import type { LoggerService } from "@nestjs/common";
import { currentContext } from "./correlation.js";
import { redact, redactText } from "./redact.js";

export type Level = "debug" | "info" | "warn" | "error";

/** Ordered, so a threshold is a comparison rather than a set. */
const SEVERITY: Readonly<Record<Level, number>> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface LogFields {
  readonly [key: string]: unknown;
}

export class JsonLogger implements LoggerService {
  constructor(
    private readonly threshold: Level = "info",
    /** Injected so a test can capture lines without spying on the process. */
    private readonly write: (line: string) => void = (line) => {
      process.stdout.write(line);
    },
  ) {}

  log(message: unknown, ...rest: unknown[]): void {
    this.emit("info", message, rest);
  }
  error(message: unknown, ...rest: unknown[]): void {
    this.emit("error", message, rest);
  }
  warn(message: unknown, ...rest: unknown[]): void {
    this.emit("warn", message, rest);
  }
  debug(message: unknown, ...rest: unknown[]): void {
    this.emit("debug", message, rest);
  }
  verbose(message: unknown, ...rest: unknown[]): void {
    this.emit("debug", message, rest);
  }

  /** The structured entrypoint: a message and named fields. */
  write_(level: Level, message: string, fields: LogFields = {}): void {
    this.record(level, message, fields);
  }

  private emit(level: Level, message: unknown, rest: readonly unknown[]): void {
    // Nest's own calls end with a context string — the class name that logged.
    // Everything before it is part of the message.
    const context = typeof rest.at(-1) === "string" ? (rest.at(-1) as string) : undefined;
    const extra = context === undefined ? rest : rest.slice(0, -1);

    this.record(
      level,
      typeof message === "string" ? message : JSON.stringify(redact(message)),
      {
        ...(context === undefined ? {} : { source: context }),
        ...(extra.length === 0 ? {} : { detail: extra.map((entry) => redact(entry)) }),
      },
    );
  }

  private record(level: Level, message: string, fields: LogFields): void {
    if (SEVERITY[level] < SEVERITY[this.threshold]) return;

    const context = currentContext();

    // Field order is deliberate: `at`, `level` and `msg` first, so a line is
    // readable without `jq` when somebody is tailing it during an incident.
    const line = {
      at: new Date().toISOString(),
      level,
      // Redacted like everything else, and this is the one that matters most:
      // a `pg` error quoting the failing row, an auth failure naming the
      // address it rejected, a `fetch` failure carrying a presigned URL — all
      // of those arrive as the *message*, not as a labelled field. The first
      // version of this redacted `fields` only, and the test asserting a Nest
      // message is cleaned is what caught it.
      msg: redactText(message),
      ...(context === undefined
        ? {}
        : {
            correlationId: context.correlationId,
            ...(context.customerId === undefined
              ? {}
              : { customerId: context.customerId }),
            ...(context.actorId === undefined ? {} : { actorId: context.actorId }),
            ...(context.actorKind === undefined ? {} : { actorKind: context.actorKind }),
            ...(context.route === undefined ? {} : { route: context.route }),
          }),
      ...(redact(fields) as object),
    };

    this.write(`${safeStringify(line)}\n`);
  }
}

/**
 * Serialise, and never throw.
 *
 * A logger that can throw turns a handled error into an unhandled one, at the
 * exact moment somebody is trying to find out what went wrong. `redact` already
 * bounds depth and drops what it cannot represent, so this is the last resort
 * rather than the first line of defence — but a last resort is what it is for.
 */
function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({
      at: new Date().toISOString(),
      level: "error",
      msg: "a log line could not be serialised",
    });
  }
}

/** The level from configuration, defaulting to `info` and never crashing on junk. */
export function levelFrom(value: string | undefined): Level {
  const candidate = (value ?? "").trim().toLowerCase();
  return candidate === "debug" || candidate === "warn" || candidate === "error"
    ? candidate
    : "info";
}
