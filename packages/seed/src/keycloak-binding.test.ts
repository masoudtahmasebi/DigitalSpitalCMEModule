/**
 * The seed's Keycloak binding rules (P101-03).
 *
 * ## What is under test, and why it is worth its own file
 *
 * That **a seed never invents an issuer**, and that a project already carrying
 * a loopback one is reported rather than accepted.
 *
 * The defect these encode cost a working day and was invisible from every
 * direction: MEDICE's WordPress said "Token liegt vor", the API said `401` with
 * no reason (deliberately — ADR-0003), the deploy said success, and the value
 * doing the damage was a `??` default in a seed that no production host had
 * ever been asked to override. The one place it *was* visible was a comparison
 * between two strings, which is what this file does exhaustively.
 *
 * `seedKeycloakBinding` takes the environment as an argument rather than
 * reading `process.env`, so every branch here is a value, not a test that has
 * to mutate global state and put it back.
 */

import { describe, expect, it } from "vitest";
import { bindingProblem, seedKeycloakBinding } from "./keycloak-binding.js";

describe("seedKeycloakBinding", () => {
  it("uses what the environment states", () => {
    expect(
      seedKeycloakBinding({
        issuer: "https://login.medice.com/auth/realms/medicerealm",
        audience: "account",
      }),
    ).toEqual({
      issuer: "https://login.medice.com/auth/realms/medicerealm",
      audience: "account",
      // Derived from the issuer, which is the string that has to be right
      // anyway — not typed a second time where it can drift.
      realm: "medicerealm",
    });
  });

  it("invents nothing when the environment is silent", () => {
    // The whole ticket. This used to answer
    // `http://127.0.0.1:8080/realms/ds-dev`, on every installation, for ever.
    expect(seedKeycloakBinding({})).toEqual({
      issuer: null,
      audience: null,
      realm: null,
    });
  });

  it("treats blank and whitespace as unset, not as a value", () => {
    // `KEYCLOAK_ISSUER=` in a config.env is somebody who has not filled it in.
    // Writing "" would satisfy a NOT NULL check and authenticate nobody.
    expect(seedKeycloakBinding({ issuer: "", audience: "   " })).toEqual({
      issuer: null,
      audience: null,
      realm: null,
    });
  });

  it("trims, because a trailing space in a config file is invisible", () => {
    expect(
      seedKeycloakBinding({
        issuer: " https://login.medice.com/auth/realms/medicerealm ",
        audience: "account ",
      }).issuer,
    ).toBe("https://login.medice.com/auth/realms/medicerealm");
  });

  it("prefers a stated realm over the derived one", () => {
    expect(
      seedKeycloakBinding({
        issuer: "https://auth.example.de/realms/one",
        realm: "two",
      }).realm,
    ).toBe("two");
  });

  it("derives a realm from an issuer with a trailing slash", () => {
    // `.../realms/medicerealm/` is what a copy out of a Keycloak admin screen
    // frequently looks like, and a realm of "" would be stored as unset.
    expect(
      seedKeycloakBinding({ issuer: "https://login.medice.com/auth/realms/medicerealm/" })
        .realm,
    ).toBe("medicerealm");
  });
});

describe("bindingProblem", () => {
  const configured = {
    issuer: "https://login.medice.com/auth/realms/medicerealm",
    audience: "account",
    realm: "medicerealm",
  };

  it("passes a project that can authenticate somebody", () => {
    expect(
      bindingProblem({
        projectSlug: "medice-adhs",
        stored: configured,
        issuerRequested: true,
      }),
    ).toBeUndefined();
  });

  it("refuses a project with no issuer, and names both ways to fix it", () => {
    const problem = bindingProblem({
      projectSlug: "medice-adhs",
      stored: { issuer: null, audience: "account", realm: null },
      issuerRequested: false,
    });

    expect(problem).toContain("no issuer");
    // §9.4: the message has to say what the person does next, in the place
    // they will look. The console path first — it needs no deployment.
    expect(problem).toContain("Verwaltung -> Organisation -> Projekte -> medice-adhs");
    expect(problem).toContain("KEYCLOAK_ISSUER");
  });

  it("names the audience when that is the half that is missing", () => {
    const problem = bindingProblem({
      projectSlug: "medice-adhs",
      stored: { ...configured, audience: null },
      issuerRequested: true,
    });

    expect(problem).toContain("no audience");
    expect(problem).not.toContain("no issuer and");
  });

  it("refuses the loopback default a previous seed wrote", () => {
    // The installation as it actually stood: a real token, correctly signed,
    // rejected because `iss` was compared against a localhost URL.
    const problem = bindingProblem({
      projectSlug: "medice-adhs",
      stored: {
        issuer: "http://127.0.0.1:8080/realms/ds-dev",
        audience: "ds-education-api",
        realm: "ds-dev",
      },
      issuerRequested: false,
    });

    expect(problem).toContain("loopback");
    expect(problem).toContain("401");
  });

  it.each([
    "http://localhost:8080/realms/ds-dev",
    "http://127.0.0.1/realms/ds-dev",
    "http://127.1.2.3:8080/realms/ds-dev",
    "http://[::1]:8080/realms/ds-dev",
    "https://keycloak.localhost/realms/ds-dev",
  ])("recognises %s as loopback", (issuer) => {
    expect(
      bindingProblem({
        projectSlug: "p",
        stored: { issuer, audience: "a", realm: "r" },
        issuerRequested: false,
      }),
    ).toContain("loopback");
  });

  it("leaves a developer who asked for loopback alone", () => {
    // Dev and the e2e rig both set KEYCLOAK_ISSUER explicitly. Refusing a value
    // somebody stated on purpose would be a gate that goes red where the work
    // happens, which is how gates get switched off.
    expect(
      bindingProblem({
        projectSlug: "medice-adhs",
        stored: {
          issuer: "http://127.0.0.1:8080/realms/ds-dev",
          audience: "ds-education-api",
          realm: "ds-dev",
        },
        issuerRequested: true,
      }),
    ).toBeUndefined();
  });

  it("does not call a public host loopback because its name contains one", () => {
    expect(
      bindingProblem({
        projectSlug: "p",
        stored: {
          issuer: "https://localhost.medice.com/realms/r",
          audience: "a",
          realm: "r",
        },
        issuerRequested: false,
      }),
    ).toBeUndefined();
  });

  it("does not re-diagnose a value that is not a URL at all", () => {
    // The API's own DTO refuses this. Reporting it here as "loopback" would be
    // a second, wrong answer about the same row.
    expect(
      bindingProblem({
        projectSlug: "p",
        stored: { issuer: "not a url", audience: "a", realm: "r" },
        issuerRequested: false,
      }),
    ).toBeUndefined();
  });
});
