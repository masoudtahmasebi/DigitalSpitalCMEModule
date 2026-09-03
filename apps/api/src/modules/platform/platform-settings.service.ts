/**
 * The rules around arming the EIV worker (P180-01).
 *
 * ## What moved, and what did not
 *
 * `EIV_WORKER_ENABLED` and `EIV_BASE_URL` moved out of `config.env` at the
 * client's instruction, so switching register or pausing submissions no longer
 * needs a deploy. **The safety property did not move with them**: a
 * Punktemeldung filed against the live register cannot be unfiled — only
 * withdrawn, which leaves its own entry on a physician's record — so arming the
 * worker against it still requires explicit consent.
 *
 * What changed is that the consent now has a name and a timestamp on it,
 * instead of being the string `yes` in a file nobody signed.
 *
 * ## Three refusals, and why each is a sentence
 *
 * | Refusal | Why |
 * | --- | --- |
 * | live without consent | the one that cannot be taken back |
 * | consent for an endpoint that is not live | consent to nothing is a habit, and a habit is not consent |
 * | changing endpoint keeps consent | consent is to one register, not to the idea of registers |
 *
 * The third is not a refusal but a **clearing**, and it is the one worth
 * stating: an operator who confirms the live register, switches to the test
 * system to try something, and switches back would otherwise still be armed
 * against production from a decision they made before the detour.
 */

import { eivEndpointUrl, requiresLiveConsent } from "@ds/eiv-client";
import { AppError } from "../../shared/problem-details.js";
import type { AuditServicePort } from "../../audit/audit.service.js";
import type {
  PlatformSettingsPort,
  PlatformSettingsRow,
} from "./platform-settings.repository.js";

export interface EivPlatformSettings {
  readonly workerEnabled: boolean;
  readonly endpoint: "mock" | "test" | "live";
  /**
   * The address the choice resolves to, for the screen to show.
   *
   * Derived, never stored and never accepted: the console displays which domain
   * it is about to talk to, and cannot influence it.
   */
  readonly endpointUrl: string;
  /** Whether this endpoint needs consent before a submission may go to it. */
  readonly requiresConsent: boolean;
  readonly liveConfirmedAt: string | null;
  readonly updatedAt: string;
}

export interface PlatformSettingsUpdate {
  readonly workerEnabled?: boolean | undefined;
  readonly endpoint?: "mock" | "test" | "live" | undefined;
  /** Ticked in the console beside the live choice. Never remembered for later. */
  readonly confirmLive?: boolean | undefined;
}

export class PlatformSettingsService {
  constructor(
    private readonly repository: PlatformSettingsPort,
    private readonly audit: AuditServicePort,
    /**
     * Where the mock lives on this machine.
     *
     * The one address still in the environment, and it is a fact about the
     * local network rather than a choice about who receives statutory reports
     * — see `eivEndpointUrl`.
     */
    private readonly mockUrl: string,
  ) {}

  async read(): Promise<EivPlatformSettings> {
    return this.present(await this.repository.read());
  }

  async update(
    update: PlatformSettingsUpdate,
    actor: { staffUserId: string },
    now: Date,
  ): Promise<EivPlatformSettings> {
    const current = await this.repository.read();

    const endpoint = update.endpoint ?? current.eivEndpoint;
    const workerEnabled = update.workerEnabled ?? current.eivWorkerEnabled;
    const endpointChanged = endpoint !== current.eivEndpoint;

    /*
     * Consent survives only while the endpoint does. Recomputed rather than
     * carried, so there is one expression deciding whether this installation
     * has consented to *this* register.
     */
    const consentHeld = endpointChanged ? false : current.eivLiveConfirmedAt !== null;
    const consented = update.confirmLive === true || consentHeld;
    const needsConsent = requiresLiveConsent(eivEndpointUrl(endpoint, this.mockUrl));

    if (update.confirmLive === true && !needsConsent) {
      throw new AppError(
        "validation",
        `refused: live consent offered for endpoint=${endpoint}, which does not need it`,
        "Für dieses Ziel ist keine ausdrückliche Bestätigung erforderlich. Entfernen Sie den Haken.",
      );
    }

    if (workerEnabled && needsConsent && !consented) {
      throw new AppError(
        "conflict",
        `refused: arming the worker against endpoint=${endpoint} without consent`,
        "Meldungen an das Echtsystem der Ärztekammer müssen ausdrücklich bestätigt werden. " +
          "Eine übermittelte Punktemeldung lässt sich nicht zurücknehmen — sie kann nur " +
          "widerrufen werden, und der Widerruf bleibt im Datensatz der Person sichtbar.",
      );
    }

    const row = await this.repository.update(
      {
        ...(update.workerEnabled === undefined
          ? {}
          : { eivWorkerEnabled: update.workerEnabled }),
        ...(update.endpoint === undefined ? {} : { eivEndpoint: update.endpoint }),
        /*
         * Written whenever the endpoint moved or consent was given, and not
         * otherwise. `null` clears the pair; an omitted field leaves it.
         */
        ...(update.confirmLive === true
          ? { liveConsent: { at: now, by: actor.staffUserId } }
          : endpointChanged
            ? { liveConsent: null }
            : {}),
      },
      actor.staffUserId,
    );

    /*
     * `recordSystem`, which writes a **customer-less** row — but with the
     * operator named, not as the system.
     *
     * A super administrator belongs to no tenant and this setting belongs to
     * none either: filing the most consequential switch on the installation
     * under whichever customer happened to be in the request header would put
     * it in one arbitrary tenant's log and in no other. The actor is still the
     * person (`identity: "staff"`), because "who armed the worker against the
     * live register" is the question this row exists to answer.
     */
    await this.audit.recordSystem({
      actor: { identity: "staff", id: actor.staffUserId },
      action: "platform.eiv_settings_changed",
      subject: "platform_settings",
      detail: {
        workerEnabled: row.eivWorkerEnabled,
        endpoint: row.eivEndpoint,
        liveConfirmed: row.eivLiveConfirmedAt !== null,
        endpointChanged,
      },
    });

    return this.present(row);
  }

  private present(row: PlatformSettingsRow): EivPlatformSettings {
    const endpointUrl = eivEndpointUrl(row.eivEndpoint, this.mockUrl);
    return {
      workerEnabled: row.eivWorkerEnabled,
      endpoint: row.eivEndpoint,
      endpointUrl,
      requiresConsent: requiresLiveConsent(endpointUrl),
      liveConfirmedAt: row.eivLiveConfirmedAt?.toISOString() ?? null,
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
