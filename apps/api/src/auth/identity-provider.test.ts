/**
 * The learner identity port (P12-02).
 *
 * Two properties are worth a test here, and they are both about *refusing*:
 *
 * - an unknown provider name must never fall back to a working one, because a
 *   fallback authenticates learners against the wrong realm and looks identical
 *   to success;
 * - the schema permitting a name nothing implements must stop the boot, not the
 *   request, because the request-time symptom is one project's learners getting
 *   a 401 with the reason buried in an audit row.
 *
 * The third case — dispatch reaching the right implementation — is the one that
 * makes "adding a provider is a class and a row value" true rather than
 * aspirational, so it is asserted with two providers even though production
 * registers one.
 */

import { describe, expect, it } from "vitest";
import {
  assertProvidersCoverSchema,
  IdentityProviderRegistry,
  UnknownIdentityProviderError,
  type IdentityProvider,
  type IdentityProviderName,
} from "./identity-provider.js";
import type { ProjectBinding } from "../modules/projects/project-binding.repository.js";
import type { VerifiedIdentity } from "./token-verifier.js";

function binding(identityProvider: string): ProjectBinding {
  return {
    projectId: "p1",
    customerId: "c1",
    keycloakIssuer: "https://issuer.example",
    keycloakAudience: "aud",
    identityProvider,
  } as unknown as ProjectBinding;
}

/** Records what it was asked to verify, so dispatch can be observed. */
function stubProvider(name: string): IdentityProvider & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    name: name as IdentityProviderName,
    async verify(credential: string): Promise<VerifiedIdentity> {
      calls.push(credential);
      return {
        subject: `${name}-sub`,
        issuer: "https://issuer.example",
        realmRoles: [],
        raw: {},
      };
    },
  };
}

describe("IdentityProviderRegistry", () => {
  it("dispatches to the provider the binding names", async () => {
    const keycloak = stubProvider("keycloak");
    const other = stubProvider("azure_ad");
    const registry = new IdentityProviderRegistry([keycloak, other]);

    const identity = await registry
      .forBinding(binding("azure_ad"))
      .verify("token-x", binding("azure_ad"));

    expect(identity.subject).toBe("azure_ad-sub");
    expect(other.calls).toEqual(["token-x"]);
    // The point of the port: the other provider is not consulted at all.
    expect(keycloak.calls).toEqual([]);
  });

  it("throws rather than falling back when the name is unknown", () => {
    const registry = new IdentityProviderRegistry([stubProvider("keycloak")]);

    expect(() => registry.forBinding(binding("typo_ad"))).toThrow(
      UnknownIdentityProviderError,
    );
  });

  it("names the requested provider on the error, for the audit reason", () => {
    const registry = new IdentityProviderRegistry([stubProvider("keycloak")]);

    try {
      registry.forBinding(binding("typo_ad"));
      expect.unreachable("forBinding should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(UnknownIdentityProviderError);
      expect((error as UnknownIdentityProviderError).requested).toBe("typo_ad");
    }
  });

  it("refuses to be constructed empty", () => {
    // A registry with nothing in it authenticates nobody, and the symptom would
    // read as every project being misconfigured rather than as the wiring bug.
    expect(() => new IdentityProviderRegistry([])).toThrow(/at least one provider/);
  });
});

describe("assertProvidersCoverSchema", () => {
  const rowsFor =
    (...allowed: string[]) =>
    async () => ({
      rows: allowed.map((a) => ({ allowed: a })),
    });

  it("passes when every permitted name has an implementation", async () => {
    const registry = new IdentityProviderRegistry([stubProvider("keycloak")]);

    await expect(
      assertProvidersCoverSchema(registry, rowsFor("keycloak")),
    ).resolves.toBeUndefined();
  });

  it("fails the boot when the CHECK was widened but the class was not shipped", async () => {
    const registry = new IdentityProviderRegistry([stubProvider("keycloak")]);

    await expect(
      assertProvidersCoverSchema(registry, rowsFor("keycloak", "azure_ad")),
    ).rejects.toThrow(/azure_ad/);
  });

  it("fails when the constraint is absent, rather than passing vacuously", async () => {
    // No rows means the migration has not run. Treating that as "nothing to
    // check" would let the process start against a schema that permits
    // anything, which is the opposite of what this guard is for.
    const registry = new IdentityProviderRegistry([stubProvider("keycloak")]);

    await expect(assertProvidersCoverSchema(registry, rowsFor())).rejects.toThrow(
      /migration 0019/,
    );
  });

  it("does not object to a registered provider the schema does not permit", async () => {
    // Registering ahead of the migration is the normal order for a two-step
    // rollout, and it locks nobody out: the CHECK still refuses the row.
    const registry = new IdentityProviderRegistry([
      stubProvider("keycloak"),
      stubProvider("azure_ad"),
    ]);

    await expect(
      assertProvidersCoverSchema(registry, rowsFor("keycloak")),
    ).resolves.toBeUndefined();
  });
});
