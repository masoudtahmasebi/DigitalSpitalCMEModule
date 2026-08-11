/**
 * The dev Keycloak stub's guards, and its path parsing (P52-02).
 *
 * The interesting property of this file is what it does **not** test. Whether
 * the stub mints a token the API accepts is not asserted here and could not
 * usefully be: that question is answered by the API's own guard, against a real
 * JWKS, over real HTTP — which is what the integration suites already do with
 * the same `jose` primitives.
 *
 * What is worth pinning is the part that is easy to get quietly wrong and has
 * a real cost: the realm parser, because a loose one would serve a JWKS at
 * paths that are not realms, and the production refusal, because a token minter
 * that can start in production is a token minter that eventually does.
 */

import { describe, expect, it } from "vitest";
import {
  realmOf,
  refuseInProduction,
  CERTS_SUFFIX,
  TOKEN_SUFFIX,
} from "./dev-keycloak.js";

describe("realmOf", () => {
  it("reads the realm out of a Keycloak certs path", () => {
    expect(realmOf(`/realms/ds-dev${CERTS_SUFFIX}`, CERTS_SUFFIX)).toBe("ds-dev");
    expect(realmOf(`/realms/ds-demo${TOKEN_SUFFIX}`, TOKEN_SUFFIX)).toBe("ds-demo");
  });

  it("refuses a path that merely ends with the suffix", () => {
    // `/anything/realms/x/…` and `/notrealms/x/…` are not realm paths. Serving
    // a signing key at a URL that only looks like one is how a stub starts
    // answering requests nobody meant to send it.
    expect(realmOf(`/evil/realms/ds-dev${CERTS_SUFFIX}`, CERTS_SUFFIX)).toBeUndefined();
    expect(realmOf(`/notrealms/ds-dev${CERTS_SUFFIX}`, CERTS_SUFFIX)).toBeUndefined();
  });

  it("refuses a nested realm name", () => {
    // A realm is one path segment. `ds-dev/../other` must not parse.
    expect(realmOf(`/realms/a/b${CERTS_SUFFIX}`, CERTS_SUFFIX)).toBeUndefined();
  });

  it("refuses an empty realm", () => {
    expect(realmOf(`/realms/${CERTS_SUFFIX}`, CERTS_SUFFIX)).toBeUndefined();
  });

  it("returns undefined when the suffix is not there at all", () => {
    expect(realmOf("/realms/ds-dev", CERTS_SUFFIX)).toBeUndefined();
    expect(realmOf("/", CERTS_SUFFIX)).toBeUndefined();
  });

  it("does not confuse one endpoint for another", () => {
    // The certs path asked for as a token path is not a token path.
    expect(realmOf(`/realms/ds-dev${CERTS_SUFFIX}`, TOKEN_SUFFIX)).toBeUndefined();
  });
});

describe("refuseInProduction", () => {
  it("refuses under NODE_ENV=production", () => {
    expect(refuseInProduction("production")).toBe(true);
  });

  it("allows development, test and an unset environment", () => {
    expect(refuseInProduction("development")).toBe(false);
    expect(refuseInProduction("test")).toBe(false);
    expect(refuseInProduction(undefined)).toBe(false);
  });

  it("is not fooled by case or padding", () => {
    // `NODE_ENV=Production` is a typo somebody makes once. It must not be the
    // difference between refusing and minting tokens on a real host.
    expect(refuseInProduction("Production")).toBe(true);
    expect(refuseInProduction(" production ")).toBe(true);
    expect(refuseInProduction("PRODUCTION")).toBe(true);
  });
});
