/**
 * The host page's profile hint (P105-01).
 *
 * ## What is actually under test
 *
 * **That the token wins.** `withProfileHint` fills only what the token left
 * empty, and the failure mode is silent: `{...hint, ...identity}` and
 * `{...identity, ...hint}` read identically to a reviewer and differ completely
 * on the day MEDICE add the claim mappers. Written the wrong way round, a page
 * would override the customer's own IdP and nothing would say so — the person
 * would simply have the wrong name on a CME certificate.
 *
 * The parsing tests are the ordinary boundary work for something that arrives
 * in a header from a page we do not control: a value that becomes two log lines
 * is a real defect, and a hint that cannot be parsed must behave exactly like a
 * hint that was never sent.
 *
 * What is **not** tested here, because it is not this file's to decide: whether
 * a hint can change who somebody is. It cannot — `provision_learner` keys on
 * `(provider, realm, sub)` and this never touches any of the three. The guard's
 * integration tests hold that line.
 */

import { describe, expect, it } from "vitest";
import { parseProfileHint, withProfileHint } from "./profile-hint.js";

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

describe("parseProfileHint", () => {
  it("reads the three fields a page may offer", () => {
    expect(
      parseProfileHint(
        encode({ email: "a.schmidt@example.de", firstName: "Anna", lastName: "Schmidt" }),
      ),
    ).toEqual({
      email: "a.schmidt@example.de",
      firstName: "Anna",
      lastName: "Schmidt",
    });
  });

  it("keeps a name that is not ASCII, which is why this is base64 at all", () => {
    // `Müller-Lüdenscheidt` is not expressible in a raw header value.
    expect(parseProfileHint(encode({ lastName: "Müller-Lüdenscheidt" }))).toEqual({
      lastName: "Müller-Lüdenscheidt",
    });
  });

  it("ignores everything it was not asked for", () => {
    // A page cannot widen its own reach by adding keys.
    expect(
      parseProfileHint(
        encode({ email: "a@b.de", role: "super_admin", efn: "1".repeat(15) }),
      ),
    ).toEqual({ email: "a@b.de" });
  });

  it.each([
    ["absent", undefined],
    ["empty", ""],
    ["not base64", "!!!!"],
    ["not JSON", Buffer.from("hello", "utf8").toString("base64url")],
    ["not an object", encode("Anna")],
    ["null", encode(null)],
  ])("treats a %s header as no hint at all", (_label, header) => {
    // Never an error. A page that offers a malformed hint gets the behaviour of
    // a page that offered none, because the alternative is a 4xx on every
    // request from a site somebody has just misconfigured.
    expect(parseProfileHint(header)).toEqual({});
  });

  it("drops a field carrying a control character", () => {
    // A newline in a value is how one log line becomes two, and how a header
    // becomes two headers.
    expect(parseProfileHint(encode({ firstName: "Anna\nX-Injected: 1" }))).toEqual({});
  });

  it("drops a field longer than a real name", () => {
    expect(parseProfileHint(encode({ lastName: "a".repeat(201) }))).toEqual({});
    expect(parseProfileHint(encode({ lastName: "a".repeat(200) }))).toEqual({
      lastName: "a".repeat(200),
    });
  });

  it("drops an email that is not one", () => {
    expect(parseProfileHint(encode({ email: "not-an-address" }))).toEqual({});
  });

  it("trims, and drops a field that was only whitespace", () => {
    expect(parseProfileHint(encode({ firstName: "  Anna  ", lastName: "   " }))).toEqual({
      firstName: "Anna",
    });
  });

  it("ignores a non-string where a string was expected", () => {
    expect(parseProfileHint(encode({ firstName: 42, lastName: ["Schmidt"] }))).toEqual(
      {},
    );
  });
});

describe("withProfileHint", () => {
  it("fills what the token left empty", () => {
    // The case this exists for: MEDICE's realm sends no profile claims.
    expect(
      withProfileHint({ subject: "abc" } as { subject: string; firstName?: string }, {
        firstName: "Anna",
      }),
    ).toEqual({ subject: "abc", firstName: "Anna" });
  });

  it("never overrides a claim the token carried", () => {
    /*
     * The whole ticket. A realm that adds the mappers later needs no change and
     * no coordination — the hint simply stops being used. Reversed, the page
     * would win over the customer's own IdP and the only symptom would be a
     * wrong name on a Teilnahmebescheinigung.
     */
    expect(
      withProfileHint(
        { email: "real@medice.com", firstName: "Anna", lastName: "Schmidt" },
        { email: "attacker@example.com", firstName: "Mallory", lastName: "X" },
      ),
    ).toEqual({ email: "real@medice.com", firstName: "Anna", lastName: "Schmidt" });
  });

  it("mixes per field, not all or nothing", () => {
    // A realm that maps `email` but not the name is a real configuration, and
    // the half that is present must not suppress the half that is missing.
    expect(
      withProfileHint(
        { email: "real@medice.com" } as { email?: string; lastName?: string },
        { email: "other@example.com", lastName: "Schmidt" },
      ),
    ).toEqual({ email: "real@medice.com", lastName: "Schmidt" });
  });

  it("changes nothing when there is no hint", () => {
    const identity = { subject: "abc", email: "real@medice.com" };
    expect(withProfileHint(identity, {})).toEqual(identity);
  });

  it("leaves every other property of the identity alone", () => {
    // `subject` is the one that decides who this is, and it is not a field this
    // function knows about — asserted so that a future edit widening the merge
    // has to change this test to pass.
    expect(
      withProfileHint(
        { subject: "abc", issuer: "https://login.medice.com", realmRoles: ["x"] } as {
          subject: string;
          issuer: string;
          realmRoles: readonly string[];
          email?: string;
        },
        { email: "a@b.de" },
      ),
    ).toEqual({
      subject: "abc",
      issuer: "https://login.medice.com",
      realmRoles: ["x"],
      email: "a@b.de",
    });
  });
});
