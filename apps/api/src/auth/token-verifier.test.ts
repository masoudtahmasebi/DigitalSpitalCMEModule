import { describe, expect, it, beforeAll } from "vitest";
import {
  exportJWK,
  generateKeyPair,
  SignJWT,
  type JWK,
  type CryptoKey,
  createLocalJWKSet,
} from "jose";
import { TokenInvalidError, verifyToken } from "./token-verifier.js";

const ISSUER = "http://localhost:8080/realms/ds-dev";
const AUDIENCE = "ds-education-api";
const OPTIONS = { issuer: ISSUER, audience: AUDIENCE, clockToleranceSec: 5 };

let privateKey: CryptoKey;
let publicKey: CryptoKey;
let jwks: ReturnType<typeof createLocalJWKSet>;
let otherPrivateKey: CryptoKey;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  publicKey = pair.publicKey;

  const other = await generateKeyPair("RS256");
  otherPrivateKey = other.privateKey;

  const jwk: JWK = { ...(await exportJWK(publicKey)), kid: "test-key", alg: "RS256" };
  jwks = createLocalJWKSet({ keys: [jwk] });
});

async function mint(
  overrides: {
    issuer?: string;
    audience?: string;
    exp?: string | number;
    nbf?: number;
    sub?: string;
    signWith?: CryptoKey;
    alg?: string;
    claims?: Record<string, unknown>;
  } = {},
): Promise<string> {
  const jwt = new SignJWT({
    email: "dr.mueller@example.org",
    given_name: "Anna",
    family_name: "Müller",
    realm_access: { roles: ["learner"] },
    ...overrides.claims,
  })
    .setProtectedHeader({ alg: overrides.alg ?? "RS256", kid: "test-key" })
    .setIssuedAt()
    .setIssuer(overrides.issuer ?? ISSUER)
    .setAudience(overrides.audience ?? AUDIENCE)
    .setSubject(overrides.sub ?? "sub-123")
    .setExpirationTime(overrides.exp ?? "5m");

  if (overrides.nbf !== undefined) jwt.setNotBefore(overrides.nbf);

  return jwt.sign(overrides.signWith ?? privateKey);
}

describe("a valid token is accepted", () => {
  it("returns the identity from the validated token", async () => {
    const identity = await verifyToken(await mint(), jwks, OPTIONS);

    expect(identity.subject).toBe("sub-123");
    expect(identity.email).toBe("dr.mueller@example.org");
    expect(identity.firstName).toBe("Anna");
    expect(identity.lastName).toBe("Müller");
    expect(identity.realmRoles).toEqual(["learner"]);
  });
});

describe("each failure mode is rejected with its own reason", () => {
  it("rejects a tampered signature", async () => {
    const token = await mint({ signWith: otherPrivateKey });
    await expect(verifyToken(token, jwks, OPTIONS)).rejects.toMatchObject({
      reason: "bad_signature",
    });
  });

  it("rejects the wrong audience — a token minted for another client", async () => {
    const token = await mint({ audience: "some-other-client" });
    await expect(verifyToken(token, jwks, OPTIONS)).rejects.toMatchObject({
      reason: "wrong_audience",
    });
  });

  it("rejects the wrong issuer — a token from another realm", async () => {
    const token = await mint({ issuer: "http://localhost:8080/realms/evil" });
    await expect(verifyToken(token, jwks, OPTIONS)).rejects.toMatchObject({
      reason: "wrong_issuer",
    });
  });

  it("rejects an expired token", async () => {
    // Issued and expired in the past, beyond the clock tolerance.
    const token = await mint({ exp: Math.floor(Date.now() / 1000) - 3600 });
    await expect(verifyToken(token, jwks, OPTIONS)).rejects.toMatchObject({
      reason: "expired",
    });
  });

  it("rejects a not-yet-valid token", async () => {
    const token = await mint({ nbf: Math.floor(Date.now() / 1000) + 3600 });
    await expect(verifyToken(token, jwks, OPTIONS)).rejects.toMatchObject({
      reason: "not_yet_valid",
    });
  });

  it("rejects an unsigned alg:none token structurally", async () => {
    // Hand-built alg:none token: header.payload with an empty signature.
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString(
      "base64url",
    );
    const body = Buffer.from(
      JSON.stringify({ sub: "sub-123", iss: ISSUER, aud: AUDIENCE }),
    ).toString("base64url");
    const unsigned = `${header}.${body}.`;

    await expect(verifyToken(unsigned, jwks, OPTIONS)).rejects.toBeInstanceOf(
      TokenInvalidError,
    );
  });

  it("rejects a token signed by an unknown key", async () => {
    // Correct alg, but a kid the JWKS does not contain.
    const token = await new SignJWT({ realm_access: { roles: [] } })
      .setProtectedHeader({ alg: "RS256", kid: "unknown-kid" })
      .setIssuedAt()
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setSubject("sub-123")
      .setExpirationTime("5m")
      .sign(otherPrivateKey);

    await expect(verifyToken(token, jwks, OPTIONS)).rejects.toMatchObject({
      reason: "unknown_key",
    });
  });

  it("rejects garbage", async () => {
    await expect(verifyToken("not.a.jwt", jwks, OPTIONS)).rejects.toBeInstanceOf(
      TokenInvalidError,
    );
  });

  it("rejects a token with no subject", async () => {
    const token = await mint({ sub: "" });
    await expect(verifyToken(token, jwks, OPTIONS)).rejects.toMatchObject({
      reason: "malformed",
    });
  });
});

describe("issuer and audience come from configuration, not the token", () => {
  it("a token cannot self-declare an audience the verifier does not require", async () => {
    // The token claims aud "ds-education-api" honestly, but the verifier is
    // configured to require a different audience — the token loses.
    const token = await mint();
    await expect(
      verifyToken(token, jwks, { ...OPTIONS, audience: "different-api" }),
    ).rejects.toMatchObject({ reason: "wrong_audience" });
  });
});

describe("no token material leaks", () => {
  it("the error message carries only the reason, never the token", async () => {
    const token = await mint({ audience: "wrong" });
    try {
      await verifyToken(token, jwks, OPTIONS);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as Error).message).not.toContain(token);
      expect((error as Error).message).toBe("token rejected: wrong_audience");
    }
  });
});
