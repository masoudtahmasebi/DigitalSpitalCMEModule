/**
 * Fails the boot when the schema permits an identity provider no class
 * implements (P12-02).
 *
 * A project naming a provider that is not registered is a configuration error
 * whose only other symptom is every learner on that project getting a 401, with
 * the actual reason buried in an audit row nobody reads until somebody
 * complains. `OnApplicationBootstrap` runs before the HTTP port is opened, so
 * the process exits non-zero and — under any rolling deploy — the previous
 * container carries on serving.
 *
 * ## Why the dependencies are passed in rather than injected by type
 *
 * The first version took `registry: IdentityProviderRegistry` as a constructor
 * parameter and let Nest resolve it from the emitted `design:paramtypes`. Nest
 * refused to start: the parameter arrived `undefined`.
 *
 * The cause is not Nest. `emitDecoratorMetadata` is a TypeScript-compiler
 * feature that esbuild does not implement, and `tsx` — which runs this app in
 * development and in every script that boots it — is esbuild. The compiled
 * `dist/` build emits the metadata and would have worked, so the failure would
 * have appeared only in development, or only in production, depending on which
 * one you tried second.
 *
 * Taking the dependencies explicitly makes the wiring identical under both.
 * It is also why every other provider in `AuthModule` is registered with a
 * `useFactory` and an `inject` array rather than by type.
 */

import { Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import type { Pool } from "pg";
import {
  assertProvidersCoverSchema,
  IdentityProviderRegistry,
} from "./identity-provider.js";

@Injectable()
export class IdentityProviderBootCheck implements OnApplicationBootstrap {
  private readonly logger = new Logger(IdentityProviderBootCheck.name);

  constructor(
    private readonly registry: IdentityProviderRegistry,
    private readonly pool: Pick<Pool, "query">,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await assertProvidersCoverSchema(this.registry, (sql) => this.pool.query(sql));
    this.logger.log(
      `identity providers registered: ${this.registry.registeredNames().join(", ")}`,
    );
  }
}
