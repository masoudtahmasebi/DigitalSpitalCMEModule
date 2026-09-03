/**
 * Reading and writing the one `platform_settings` row (P180-01).
 *
 * ## The pool, not a tenant `Db`
 *
 * `platform_settings` has no `customer_id` and no RLS policy: there is one EIV
 * worker per installation and one register it talks to. So every read here goes
 * over a plain pool rather than through `runInTenant` — and
 * `scripts/check-tenant-reads.mjs` is told about it by name, because "this
 * table is deliberately not tenant-scoped" and "somebody forgot the tenant
 * context" look identical from a query (§9.6).
 *
 * The worker reads it too, on every tick, from a process that has no request
 * and therefore no tenant at all. That is the whole point of the move: a
 * setting an operator changes in a browser has to reach a scheduler that was
 * started hours earlier.
 */

import type { Pool } from "pg";

export interface PlatformSettingsRow {
  readonly eivWorkerEnabled: boolean;
  readonly eivEndpoint: "mock" | "test" | "live";
  readonly eivLiveConfirmedAt: Date | null;
  readonly eivLiveConfirmedBy: string | null;
  readonly updatedAt: Date;
  readonly updatedBy: string | null;
}

export interface PlatformSettingsPatch {
  readonly eivWorkerEnabled?: boolean;
  readonly eivEndpoint?: "mock" | "test" | "live";
  /**
   * Consent to file against the live register, or its withdrawal.
   *
   * A pair, always: the timestamp answers "when" and the id answers "who", and
   * a database CHECK refuses one without the other. `null` clears both, which
   * is what any change of endpoint does — consent is to one register, not to
   * the idea of registers.
   */
  readonly liveConsent?: { at: Date; by: string } | null;
}

export interface PlatformSettingsPort {
  read(): Promise<PlatformSettingsRow>;
  update(patch: PlatformSettingsPatch, actorId: string): Promise<PlatformSettingsRow>;
}

export class PlatformSettingsRepository implements PlatformSettingsPort {
  constructor(private readonly pool: Pool) {}

  async read(): Promise<PlatformSettingsRow> {
    const { rows } = await this.pool.query<{
      eiv_worker_enabled: boolean;
      eiv_endpoint: string;
      eiv_live_confirmed_at: Date | null;
      eiv_live_confirmed_by: string | null;
      updated_at: Date;
      updated_by: string | null;
    }>(
      `SELECT eiv_worker_enabled, eiv_endpoint, eiv_live_confirmed_at,
              eiv_live_confirmed_by, updated_at, updated_by
         FROM platform_settings WHERE singleton`,
    );

    const row = rows[0];
    if (row === undefined) {
      /*
       * The migration inserts the row, so this is unreachable on a migrated
       * database — and it throws rather than returning a default.
       *
       * A default here would be a *second* answer to "is the worker on", and
       * the safe-looking one ("off") is the one that hides a broken
       * installation: the console would report a worker that is off, the
       * scheduler would agree, and a Punktemeldung approaching its statutory
       * deadline would sit there with nothing wrong on any screen. Failing is
       * the honest outcome, and `assertSchemaCurrent` (§9.9) is what turns it
       * into a message naming the migration.
       */
      throw new Error(
        "platform_settings has no row: the database is older than this code " +
          "(migration 0051). Run the migrator.",
      );
    }

    return toRow(row);
  }

  async update(
    patch: PlatformSettingsPatch,
    actorId: string,
  ): Promise<PlatformSettingsRow> {
    /*
     * One statement, with COALESCE for every absent field.
     *
     * A read-modify-write would be two round trips with a window between them,
     * and two operators arming the worker and changing the endpoint at the same
     * moment could interleave into a state neither chose — with the live
     * register on one side of that. The database's own CHECK is the backstop
     * (`platform_settings_live_needs_consent`), and this keeps the update
     * atomic so the backstop never has to catch a race.
     */
    const consent = patch.liveConsent;

    const { rows } = await this.pool.query<{
      eiv_worker_enabled: boolean;
      eiv_endpoint: string;
      eiv_live_confirmed_at: Date | null;
      eiv_live_confirmed_by: string | null;
      updated_at: Date;
      updated_by: string | null;
    }>(
      `UPDATE platform_settings
          SET eiv_worker_enabled    = COALESCE($1, eiv_worker_enabled),
              eiv_endpoint          = COALESCE($2, eiv_endpoint),
              eiv_live_confirmed_at = CASE WHEN $3::boolean THEN $4::timestamptz
                                           ELSE eiv_live_confirmed_at END,
              eiv_live_confirmed_by = CASE WHEN $3::boolean THEN $5::uuid
                                           ELSE eiv_live_confirmed_by END,
              updated_at            = now(),
              updated_by            = $6
        WHERE singleton
    RETURNING eiv_worker_enabled, eiv_endpoint, eiv_live_confirmed_at,
              eiv_live_confirmed_by, updated_at, updated_by`,
      [
        patch.eivWorkerEnabled ?? null,
        patch.eivEndpoint ?? null,
        // Present-and-null means "clear it", absent means "leave it" — two
        // different intents that `COALESCE` alone cannot tell apart.
        consent !== undefined,
        consent?.at ?? null,
        consent?.by ?? null,
        actorId,
      ],
    );

    const row = rows[0];
    if (row === undefined) throw new Error("platform_settings row disappeared");
    return toRow(row);
  }
}

function toRow(row: {
  eiv_worker_enabled: boolean;
  eiv_endpoint: string;
  eiv_live_confirmed_at: Date | null;
  eiv_live_confirmed_by: string | null;
  updated_at: Date;
  updated_by: string | null;
}): PlatformSettingsRow {
  return {
    eivWorkerEnabled: row.eiv_worker_enabled,
    // Narrowed against the CHECK the column already carries. A value outside
    // the three would mean the constraint was dropped, and answering `mock`
    // would then hide a platform pointed somewhere it should not be — so this
    // fails loudly instead.
    eivEndpoint: endpoint(row.eiv_endpoint),
    eivLiveConfirmedAt: row.eiv_live_confirmed_at,
    eivLiveConfirmedBy: row.eiv_live_confirmed_by,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

function endpoint(value: string): "mock" | "test" | "live" {
  if (value === "mock" || value === "test" || value === "live") return value;
  throw new Error(`platform_settings.eiv_endpoint holds an unknown value`);
}
