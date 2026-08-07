/**
 * One id per request, available everywhere without threading it (P25-01).
 *
 * ## The gap this closes
 *
 * A correlation id already existed — and it was minted **inside the error
 * filter**, `randomUUID()` at the moment something threw. So it identified the
 * error and nothing else: there was no request log carrying the same id, no way
 * to see what the client asked for, which tenant it was, or how long it took
 * before it failed. The id in the client's problem-details response matched
 * exactly one line in the log, and that line was the failure itself.
 *
 * Every production bug in this project so far has been diagnosed from a
 * screenshot of the user's DevTools. That is the reason.
 *
 * The id is now minted **once, at the edge**, before anything can fail. The
 * access log, every log line written during the request, and the problem
 * document all carry it.
 *
 * ## Why AsyncLocalStorage rather than a parameter
 *
 * Threading a context object through every service and repository would touch
 * every signature in the codebase, and the one place it would inevitably be
 * dropped is inside a `catch` — which is where it is needed. `AsyncLocalStorage`
 * follows the async call tree that Node already tracks, so a log line written
 * six awaits deep in a repository carries the right id with no ceremony.
 *
 * It is not free — it is a real, if small, cost on every async hop. It buys the
 * only thing that makes a log searchable, which is a fair trade.
 *
 * ## Trusting an inbound id
 *
 * `X-Request-Id` from a client is **accepted but sanitised**, never used raw. A
 * caller can name their own id — which is what makes a trace span the WordPress
 * plugin and the API — and a caller can also send 40 KB of newlines, which is
 * log injection: a forged line in the middle of the access log. So an inbound
 * value has to look like an id or it is replaced.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

export interface RequestContext {
  /** Correlates every line of one request, and the client's error document. */
  readonly correlationId: string;
  /** The tenant, once the guard has resolved one. Never before. */
  customerId?: string | undefined;
  /** Pseudonymous. Never a name or an e-mail — see `redact.ts`. */
  actorId?: string | undefined;
  /** `learner` | `staff` | `system`, once known. */
  actorKind?: string | undefined;
  /** The matched route template, not the concrete path: `/courses/:slug`. */
  route?: string | undefined;
}

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * What an id may look like.
 *
 * Deliberately narrow: printable, no whitespace, bounded. A newline in an id is
 * a forged log line, and a 40 KB id is a log file somebody paid for.
 */
const ID = /^[A-Za-z0-9_.:-]{8,128}$/;

/**
 * The id for this request: the caller's if it is usable, otherwise a new one.
 *
 * Returns the value to *use*, never mutates the header. A caller that sent
 * something unusable gets a fresh id rather than an error — a malformed trace
 * header is not a reason to refuse a request that is otherwise fine.
 */
export function correlationIdFrom(header: unknown): string {
  if (typeof header === "string" && ID.test(header)) return header;
  // An array means the header appeared twice. Ambiguous, so neither wins.
  return randomUUID();
}

/** Run `work` with a fresh context. Everything inside it can reach the id. */
export function runWithContext<T>(context: RequestContext, work: () => T): T {
  return storage.run(context, work);
}

/**
 * The current context, or undefined outside a request.
 *
 * Undefined is legitimate and common: the EIV worker, the certificate delivery
 * queue and the boot sequence all log without a request. They get their own ids
 * where it matters (`eiv_submission_attempts` already carries one) and no
 * correlation id here rather than a fabricated one.
 */
export function currentContext(): RequestContext | undefined {
  return storage.getStore();
}

export function currentCorrelationId(): string | undefined {
  return storage.getStore()?.correlationId;
}

/**
 * Record who the caller turned out to be, once the guard knows.
 *
 * Mutates the context object in place rather than opening a new scope: the
 * request is already running inside `runWithContext`, and re-entering would
 * mean every line written before authentication carried a different id from
 * every line after it — which is precisely the join this exists to make.
 */
export function describeActor(actor: {
  readonly customerId?: string | undefined;
  readonly actorId?: string | undefined;
  readonly actorKind?: string | undefined;
}): void {
  const context = storage.getStore();
  if (context === undefined) return;
  if (actor.customerId !== undefined) context.customerId = actor.customerId;
  if (actor.actorId !== undefined) context.actorId = actor.actorId;
  if (actor.actorKind !== undefined) context.actorKind = actor.actorKind;
}

export function describeRoute(route: string): void {
  const context = storage.getStore();
  if (context !== undefined) context.route = route;
}
