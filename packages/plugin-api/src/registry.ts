/**
 * The registry: which implementation is in use for each capability.
 *
 * ## One implementation per capability, not a chain
 *
 * `register` replaces; it does not append. That is the important design
 * decision in this file, and it is a compliance one rather than a taste one.
 *
 * A chain of accreditation reporters would mean a completed Fortbildung is
 * reported twice — to the same Ärztekammer if somebody registered the same
 * plugin under two names, to two authorities if they did not. Neither is
 * recoverable: a Punktemeldung cannot be withdrawn once the seven-day
 * correction window closes. A chain of certificate renderers would mean two
 * documents claiming to be the same Teilnahmebescheinigung. So the registry
 * answers "which one", and there is always exactly one answer or none.
 *
 * Registering twice for the same capability is an **error**, not a silent
 * overwrite. Two modules each believing they own the reporter is a wiring
 * mistake, and finding out at boot is better than finding out from a physician
 * whose points were filed twice.
 *
 * ## Sealing
 *
 * A registry is sealed once the composition root has finished wiring. After
 * that, `register` throws. Nothing in the request path should be able to swap
 * the certificate renderer between two requests, and a mutable global that
 * could is exactly the sort of thing that works in every test and fails once
 * under load.
 */

import type {
  AccreditationReporter,
  CertificateRenderer,
  ContentIngestor,
  DeliveryChannel,
} from "./capabilities.js";

/**
 * The capabilities, by name.
 *
 * A map rather than four fields so `register` and `resolve` can be one
 * type-safe pair instead of four near-identical ones — and so that adding a
 * fifth capability is one line here plus its interface, with the registry
 * needing no change at all.
 */
export interface Capabilities {
  readonly accreditationReporter: AccreditationReporter;
  readonly certificateRenderer: CertificateRenderer;
  readonly deliveryChannel: DeliveryChannel;
  readonly contentIngestor: ContentIngestor;
}

export type CapabilityName = keyof Capabilities;

export class PluginError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PluginError";
  }
}

export interface PluginRegistry {
  /**
   * Install the implementation for a capability.
   *
   * Throws if one is already registered, or if the registry is sealed.
   */
  register<K extends CapabilityName>(name: K, implementation: Capabilities[K]): void;

  /**
   * The implementation, or `undefined` if none is registered.
   *
   * Undefined is a legitimate answer and callers must handle it: a deployment
   * with no `contentIngestor` is the normal case, and one with no
   * `deliveryChannel` simply does not send email — which is the documented
   * behaviour for a project with no SMTP configuration, not a failure.
   */
  find<K extends CapabilityName>(name: K): Capabilities[K] | undefined;

  /**
   * The implementation, or a `PluginError` naming what is missing.
   *
   * For the capabilities a code path genuinely cannot proceed without. The
   * message names the capability, because the alternative — a `TypeError` on
   * `undefined.render` three frames deeper — says nothing about what to wire.
   */
  require<K extends CapabilityName>(name: K): Capabilities[K];

  /** What is registered. Logged once at boot, so a deployment is self-describing. */
  installed(): ReadonlyArray<{
    readonly capability: CapabilityName;
    readonly id: string;
  }>;

  /** No further registration. Called by the composition root when wiring is done. */
  seal(): void;
}

export function createPluginRegistry(): PluginRegistry {
  const implementations = new Map<CapabilityName, { id: string }>();
  let sealed = false;

  return {
    register(name, implementation) {
      if (sealed) {
        throw new PluginError(
          `cannot register ${name} after the registry is sealed — plugins are wired at startup, not per request`,
        );
      }
      const existing = implementations.get(name);
      if (existing !== undefined) {
        throw new PluginError(
          `${name} is already provided by "${existing.id}" — a capability has exactly one implementation`,
        );
      }
      implementations.set(name, implementation);
    },

    find(name) {
      return implementations.get(name) as Capabilities[typeof name] | undefined;
    },

    require(name) {
      const found = implementations.get(name);
      if (found === undefined) {
        throw new PluginError(`no implementation registered for ${name}`);
      }
      return found as Capabilities[typeof name];
    },

    installed() {
      return (
        [...implementations.entries()]
          .map(([capability, implementation]) => ({ capability, id: implementation.id }))
          // Sorted so the boot log is stable and two deployments can be diffed.
          .sort((a, b) => a.capability.localeCompare(b.capability))
      );
    },

    seal() {
      sealed = true;
    },
  };
}
