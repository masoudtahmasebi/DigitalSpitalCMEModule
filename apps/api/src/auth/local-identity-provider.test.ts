/**
 * The local participant provider, and the boundary it is responsible for.
 *
 * One of these tests matters more than the rest: a session created through one
 * project must not authenticate against another. Without that check, a
 * participant who signs in at `/medice` could send the same cookie with
 * `X-DS-Project: ds` and be authenticated in a different tenant — RLS would
 * then faithfully scope the data to *that* customer, which is the cross-tenant
 * read the whole architecture exists to prevent.
 */

import { describe, expect, it, vi } from "vitest";
import type { ProjectBinding } from "../modules/projects/project-binding.repository.js";
import {
  hashSessionToken,
  LocalIdentityProvider,
  LOCAL_REALM,
  type LearnerSession,
  type LearnerSessionLookup,
} from "./local-identity-provider.js";
import { TokenInvalidError } from "./token-verifier.js";

const NOW = new Date("2026-08-07T12:00:00.000Z");
const MEDICE_PROJECT = "0198f4c1-7a2e-7000-8000-0000000000a1";
const DS_PROJECT = "0198f4c1-7a2e-7000-8000-0000000000a2";

function binding(projectId: string): ProjectBinding {
  return {
    projectId,
    customerId: "0198f4c1-7a2e-7000-8000-000000000001",
    keycloakIssuer: "",
    keycloakAudience: "",
    identityProvider: "local",
  };
}

function session(overrides: Partial<LearnerSession> = {}): LearnerSession {
  return {
    userId: "0198f4c1-7a2e-7000-8000-0000000000b1",
    projectId: MEDICE_PROJECT,
    subject: "participant-1",
    realm: LOCAL_REALM,
    email: "arzt@praxis.de",
    firstName: "Anna",
    lastName: "Schmidt",
    expiresAt: new Date(NOW.getTime() + 3_600_000),
    revokedAt: null,
    ...overrides,
  };
}

function lookup(found: LearnerSession | undefined): LearnerSessionLookup & {
  readonly touched: Buffer[];
} {
  const touched: Buffer[] = [];
  return {
    touched,
    findByTokenHash: async () => found,
    touch: async (hash) => {
      touched.push(hash);
    },
  };
}

function providerFor(found: LearnerSession | undefined) {
  const sessions = lookup(found);
  return { sessions, provider: new LocalIdentityProvider(sessions, () => NOW) };
}

describe("a valid session", () => {
  it("identifies the participant", async () => {
    const { provider } = providerFor(session());
    const identity = await provider.verify("a-token", binding(MEDICE_PROJECT));

    expect(identity.subject).toBe("participant-1");
    expect(identity.issuer).toBe(LOCAL_REALM);
    expect(identity.email).toBe("arzt@praxis.de");
  });

  it("claims no roles at all", async () => {
    // A local credential asserts identity and nothing more. Authorisation is
    // `user_roles`, exactly as for a federated one (P1-04) — a provider that
    // could hand out roles would be a provider that could mint a super admin.
    const { provider } = providerFor(session());
    const identity = await provider.verify("a-token", binding(MEDICE_PROJECT));

    expect(identity.realmRoles).toEqual([]);
    expect(identity.raw).toEqual({});
  });

  it("looks the session up by hash, never by the token", async () => {
    // The table stores a hash so that a database dump is not a set of live
    // sessions. A lookup by the raw value would make that pointless.
    const sessions = lookup(session());
    const spy = vi.spyOn(sessions, "findByTokenHash");
    await new LocalIdentityProvider(sessions, () => NOW).verify(
      "a-token",
      binding(MEDICE_PROJECT),
    );

    expect(spy).toHaveBeenCalledWith(hashSessionToken("a-token"));
    expect(spy.mock.calls[0]?.[0].toString("utf8")).not.toContain("a-token");
  });

  it("records that it was used, without letting a failure there matter", async () => {
    const sessions: LearnerSessionLookup = {
      findByTokenHash: async () => session(),
      touch: async () => {
        throw new Error("the write failed");
      },
    };

    // `last_seen_at` is bookkeeping. A failure writing it must never turn a
    // valid session into a 401.
    await expect(
      new LocalIdentityProvider(sessions, () => NOW).verify("t", binding(MEDICE_PROJECT)),
    ).resolves.toBeDefined();
  });
});

describe("the tenant boundary", () => {
  it("refuses a session presented against a different project", async () => {
    // The one that matters. A cookie from `/medice` sent with
    // `X-DS-Project: ds` must not authenticate — RLS would then scope the data
    // to the wrong customer, faithfully, and nothing downstream could tell.
    const { provider } = providerFor(session({ projectId: MEDICE_PROJECT }));

    await expect(provider.verify("a-token", binding(DS_PROJECT))).rejects.toThrow(
      TokenInvalidError,
    );
  });

  it("does not touch a session it refused", async () => {
    // A refused session that still updated `last_seen_at` would leave a trail
    // suggesting it was accepted.
    const { provider, sessions } = providerFor(session({ projectId: MEDICE_PROJECT }));

    await provider.verify("a-token", binding(DS_PROJECT)).catch(() => undefined);
    expect(sessions.touched).toEqual([]);
  });
});

describe("everything that is not a valid session", () => {
  for (const [label, found] of [
    ["no such session", undefined],
    ["revoked", session({ revokedAt: new Date(NOW.getTime() - 1000) })],
    ["expired", session({ expiresAt: new Date(NOW.getTime() - 1) })],
  ] as const) {
    it(`refuses when ${label}`, async () => {
      const { provider } = providerFor(found);
      await expect(provider.verify("a-token", binding(MEDICE_PROJECT))).rejects.toThrow(
        TokenInvalidError,
      );
    });
  }

  it("refuses a session that expires exactly now", async () => {
    // The boundary. `<=` rather than `<`, because a session valid at the
    // instant it expires is a session valid for ever at the wrong clock skew.
    const { provider } = providerFor(session({ expiresAt: NOW }));
    await expect(provider.verify("t", binding(MEDICE_PROJECT))).rejects.toThrow();
  });

  it("gives the same reason for every one of them", async () => {
    // Distinguishing "no such session" from "expired" tells a caller which of
    // their guesses was closer, and no legitimate client needs to know.
    const reasons: string[] = [];
    for (const found of [
      undefined,
      session({ revokedAt: NOW }),
      session({ expiresAt: new Date(0) }),
      session({ projectId: DS_PROJECT }),
    ]) {
      const { provider } = providerFor(found);
      await provider.verify("t", binding(MEDICE_PROJECT)).catch((error: unknown) => {
        reasons.push((error as TokenInvalidError).reason);
      });
    }

    expect(new Set(reasons).size).toBe(1);
    expect(reasons).toHaveLength(4);
  });
});
