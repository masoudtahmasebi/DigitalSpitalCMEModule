/**
 * The API's plugin wiring (ADR-0010).
 *
 * This is the one file that decides which implementation the deployment uses
 * for each capability. It is deliberately dull and deliberately central: the
 * answer to "which system files our Punktemeldungen" should be readable in one
 * screen, not assembled from four modules that each register something.
 *
 * ## Why a module-scoped registry rather than a Nest provider
 *
 * The capabilities here are process-wide and immutable after boot, and one of
 * their consumers — the EIV scheduler — is constructed before any request
 * exists. Threading a provider through would buy nothing and would make it
 * possible, in principle, to have two registries; a sealed module singleton
 * cannot.
 *
 * The seal is the part that matters. After `installPlugins` returns, nothing
 * can swap the accreditation reporter, and a test that tried would get an error
 * rather than a race.
 *
 * ## Adding one
 *
 * Write a package implementing a contract from `@ds/plugin-api`, import it
 * here, register it, deploy. There is no runtime loading and no plugin
 * directory — see the note in `capabilities.ts` on why a process holding the
 * KMS key and a non-BYPASSRLS database role does not execute code that has not
 * been reviewed.
 */

import { Logger } from "@nestjs/common";
import { EivAccreditationReporter } from "@ds/eiv-client";
import { createPluginRegistry, type PluginRegistry } from "@ds/plugin-api";

let registry: PluginRegistry | undefined;

/**
 * Build the registry, install the deployment's plugins, and seal it.
 *
 * Called once from `main.ts`, before the Nest application is created — the EIV
 * scheduler resolves its reporter in its constructor, which runs during module
 * initialisation.
 *
 * Idempotent by refusal rather than by silence: calling it twice is a wiring
 * mistake and returns the sealed registry rather than building a second one
 * that some modules would already have missed.
 */
export function installPlugins(logger?: Logger): PluginRegistry {
  if (registry !== undefined) return registry;

  const built = createPluginRegistry();

  // EIV-FOBI, the Ärztekammer interface every Punktemeldung goes through
  // today. The reporter holds transport only; whether to send, how often to
  // retry and when a failure is permanent are decided by `@ds/domain` and the
  // submission worker.
  built.register("accreditationReporter", new EivAccreditationReporter());

  // Not registered, and that is the correct state rather than an omission:
  //
  // - `certificateRenderer` — the PDF renderer is injected directly into
  //   `CertificateService` and there is exactly one. It moves here the day a
  //   second one exists; registering a capability with one implementation and
  //   no prospect of another is indirection for its own sake.
  // - `deliveryChannel` — certificate email is P8-03 and unbuilt. Its absence
  //   is why nothing is sent, and `find` returning undefined is the documented
  //   behaviour rather than a crash.
  // - `contentIngestor` — Storyblok is on the deferred list (roadmap §4). The
  //   interface exists so that when somebody builds it, the shape is already
  //   decided; declaring it is not permission to build it.

  built.seal();
  registry = built;

  const installed = built
    .installed()
    .map((entry) => `${entry.capability}=${entry.id}`)
    .join(" ");
  logger?.log(`plugins: ${installed === "" ? "none" : installed}`);

  return built;
}

/**
 * The sealed registry, installing it first if nothing has yet.
 *
 * Lazily rather than throwing, and the reason is a bug this had before it was
 * written this way: the integration suites create the Nest application
 * themselves, so a `main.ts`-only call meant they booted an API whose EIV
 * scheduler had no reporter and died during module initialisation. That is the
 * same shape of defect `configure-app.ts` exists to prevent — a test app that
 * is not the app.
 *
 * Lazy installation is safe here **because the set is a constant in this
 * file**. There is no configuration that could produce a different one, so
 * "installed early by main.ts" and "installed on first use" cannot disagree.
 * `installPlugins` remains the eager entry point purely so the boot log lands
 * in order with the rest of startup.
 */
export function pluginRegistry(): PluginRegistry {
  return registry ?? installPlugins();
}

/** Test seam: drop the registry so a suite can install a different set. */
export function resetPluginsForTesting(): void {
  registry = undefined;
}
