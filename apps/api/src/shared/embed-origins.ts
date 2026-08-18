/**
 * Which origins may call this API, resolved from the projects (P18-04).
 *
 * ## Why this is not a config variable any more
 *
 * `EXTRA_CORS_ORIGINS` in `config.env` was the union of every customer's
 * embedding origins across the whole installation, so adding a second customer
 * widened the list for the first, and MEDICE's WordPress origin was permitted
 * to reach the API on behalf of any project. Which origins may embed a
 * project's widget is a fact about that project.
 *
 * ## What CORS is, and is not, protecting
 *
 * A preflight carries no `X-DS-Project` header — browsers do not send custom
 * headers on an `OPTIONS` — so at the moment this has to answer, the API cannot
 * know which project is being asked about. That was the stated obstacle for
 * three tickets, and it dissolves once the question is read correctly: CORS
 * asks "may this **origin** talk to this API at all", and that is answerable by
 * looking the origin up across every project.
 *
 * The per-project part is enforced later and elsewhere, where it belongs: the
 * real request carries `X-DS-Project`, the guard resolves the binding and
 * validates the credential against *that* project, and RLS scopes every row.
 * CORS was never the tenant boundary. Treating it as one is what made a shared
 * env-file list look acceptable.
 *
 * ## Cached, and why the TTL is what it is
 *
 * A database round trip on every preflight would put Postgres in the path of
 * every cross-origin request, including the ones that are about to be refused.
 * Sixty seconds is long enough that a burst of preflights costs one query, and
 * short enough that an operator who has just pasted an origin into the console
 * sees it work before they conclude it did not.
 *
 * The cache fails **closed** in one direction only: a database error leaves the
 * previous set in place rather than emptying it, because an outage that also
 * revoked every customer's embed permission would turn a recoverable blip into
 * every widget on the internet breaking. A newly *added* origin waits; a
 * newly *removed* one waits too, and sixty seconds of that is a trade worth
 * naming rather than hiding.
 */

import type { Pool } from "pg";
import { embedOriginAllowed } from "@ds/domain";

/** How long a resolved set is reused. See the header. */
const TTL_MS = 60_000;

export interface OriginSource {
  /** Every origin any project permits. Deduplicated by the database. */
  load(): Promise<readonly string[]>;
}

export class ProjectOriginSource implements OriginSource {
  constructor(private readonly pool: Pick<Pool, "query">) {}

  async load(): Promise<readonly string[]> {
    // Through the SECURITY DEFINER function: `projects` is RLS-scoped and CORS
    // runs before any tenant context exists — a direct read returns zero rows
    // and every embedded widget breaks.
    const { rows } = await this.pool.query<{ resolve_embed_origins: string }>(
      "SELECT resolve_embed_origins()",
    );
    return rows.map((row) => row.resolve_embed_origins);
  }
}

/**
 * The always-allowed pair plus whatever the projects say.
 *
 * The console and the portal are this installation's own browser origins and
 * are never in the database — they are derived from `BASE_DOMAIN` at deploy
 * time, and a deployment whose own admin console could not reach its own API
 * would be broken in a way no customer configuration should be able to cause.
 */
export class EmbedOriginRegistry {
  /** This installation's own origins — exact, from configuration. */
  #exact: ReadonlySet<string> = new Set();
  /** The customers', which may be patterns (P94-04). */
  #patterns: readonly string[] = [];
  /**
   * `undefined` until a load has actually succeeded — not `0`.
   *
   * A sentinel of `0` is a real point on the clock, and an injected test clock
   * starting there made "never loaded" indistinguishable from "loaded at time
   * zero", which suppressed the retry after a failed load. Any sentinel drawn
   * from the value's own domain has this problem eventually; `undefined` is
   * outside it.
   */
  #loadedAt: number | undefined;
  #inFlight: Promise<void> | undefined;

  constructor(
    private readonly source: OriginSource,
    /** Ours, from configuration. Always allowed. */
    private readonly always: readonly string[],
    private readonly now: () => number = () => Date.now(),
  ) {
    this.#exact = new Set(always);
  }

  /**
   * Is this origin allowed?
   *
   * Synchronous on purpose. Express's `cors` callback is invoked per request
   * and an `await` here would serialise every preflight behind a promise;
   * refreshing in the background instead means the answer is always immediate
   * and at worst `TTL_MS` stale.
   */
  isAllowed(origin: string): boolean {
    this.#refreshIfStale();
    /*
     * A pattern match, not a set lookup (P94-04).
     *
     * The stored entries were exact origins and this was `Set.has`. They are
     * now patterns — `https://*.medice.de`, `http://localhost:*` — because one
     * customer is several environments and enumerating a preview deployment per
     * branch is a platform setting somebody has to edit every morning, which
     * means it gets left wide or the embed silently fails.
     *
     * `embedOriginAllowed` is the same rule the console validates with and the
     * same rule `@ds/domain` tests exhaustively. A second matcher here is how
     * "what may be stored" and "what is accepted" come to disagree, and this is
     * the side where disagreeing means letting a page in.
     *
     * Linear over a small list, called per preflight. `always` is checked first
     * and by identity because it is this installation's own two origins and
     * they are exact.
     */
    if (this.#exact.has(origin)) return true;
    return embedOriginAllowed(this.#patterns, origin);
  }

  /** Force a load — used at boot so the first preflight is not a cache miss. */
  async warm(): Promise<void> {
    await this.#load();
  }

  #refreshIfStale(): void {
    if (this.#loadedAt !== undefined && this.now() - this.#loadedAt < TTL_MS) return;
    // Not awaited: see `isAllowed`. Guarded so a burst of preflights past the
    // TTL produces one query rather than one per request.
    void this.#load();
  }

  async #load(): Promise<void> {
    this.#inFlight ??= (async () => {
      try {
        this.#patterns = await this.source.load();
        this.#loadedAt = this.now();
      } catch {
        // Deliberately keeps the previous set. See the header: an outage must
        // not revoke every customer's embed permission. The next request tries
        // again, because `#loadedAt` was not advanced.
      } finally {
        this.#inFlight = undefined;
      }
    })();

    await this.#inFlight;
  }
}
