import { describe, expect, it } from "vitest";
import { signInMethodsProblem } from "./sign-in-methods.js";

const methods = (doccheck: boolean, keycloak: boolean) => ({
  docCheckLoginAllowed: doccheck,
  keycloakLoginAllowed: keycloak,
});

describe("signInMethodsProblem", () => {
  it("refuses a project nobody can sign in to", () => {
    expect(signInMethodsProblem(methods(false, false))).toBe("no_method_permitted");
  });

  it("permits Keycloak alone — every project today", () => {
    expect(signInMethodsProblem(methods(false, true))).toBeUndefined();
  });

  /*
   * DocCheck alone is legal and is a real configuration: a customer running a
   * pure HCP reading room, with no accredited participation at all. It is the
   * case somebody would be tempted to refuse on the grounds that "you cannot
   * earn a point" — which is true and is not a reason to refuse it.
   */
  it("permits DocCheck alone", () => {
    expect(signInMethodsProblem(methods(true, false))).toBeUndefined();
  });

  it("permits both", () => {
    expect(signInMethodsProblem(methods(true, true))).toBeUndefined();
  });
});
