import { describe, expect, it } from "vitest";

import { deliveryAddress, DELIVERY_EMAIL_MAX } from "./delivery-address.js";

/**
 * The cases that matter are the ones where a plausible implementation differs
 * from this one: clearing, whitespace, and "the same address typed again".
 */
describe("deliveryAddress", () => {
  it("accepts an ordinary address where none is stored", () => {
    expect(deliveryAddress({ proposed: "arzt@praxis.de", current: null })).toEqual({
      ok: true,
      email: "arzt@praxis.de",
    });
  });

  it("accepts a replacement for a stored one", () => {
    expect(
      deliveryAddress({ proposed: "neu@praxis.de", current: "alt@praxis.de" }),
    ).toEqual({ ok: true, email: "neu@praxis.de" });
  });

  it("trims, because a pasted address arrives with the paste", () => {
    expect(deliveryAddress({ proposed: "  arzt@praxis.de \n", current: null })).toEqual({
      ok: true,
      email: "arzt@praxis.de",
    });
  });

  // Clearing is how somebody goes back to their account address. Refusing it
  // would make the field one-way, which is not what a correction is.
  it("clears when given an empty string and something is stored", () => {
    expect(deliveryAddress({ proposed: "", current: "alt@praxis.de" })).toEqual({
      ok: true,
      email: null,
    });
    expect(deliveryAddress({ proposed: "   ", current: "alt@praxis.de" })).toEqual({
      ok: true,
      email: null,
    });
  });

  it("reports clearing an empty field as unchanged, not as a save", () => {
    expect(deliveryAddress({ proposed: "", current: null })).toEqual({
      ok: false,
      reason: "unchanged",
    });
  });

  // A screen that says "Gespeichert" for a keystroke that changed nothing is
  // making a false statement about what the system holds — P41-01's shape.
  it("reports the same address as unchanged, ignoring case", () => {
    expect(
      deliveryAddress({ proposed: "arzt@praxis.de", current: "arzt@praxis.de" }),
    ).toEqual({ ok: false, reason: "unchanged" });
    expect(
      deliveryAddress({ proposed: "Arzt@Praxis.DE", current: "arzt@praxis.de" }),
    ).toEqual({ ok: false, reason: "unchanged" });
  });

  // The injection this refuses at the layer that can explain it: `headerSafe`
  // strips it later, silently, and by then nobody is looking at a form.
  it("refuses a display name wrapped around an address", () => {
    expect(
      deliveryAddress({ proposed: "Dr. Muster <m@example.de>", current: null }),
    ).toEqual({ ok: false, reason: "malformed" });
  });

  it("refuses an address carrying a header break", () => {
    expect(deliveryAddress({ proposed: "a@b.de\nBcc: c@d.de", current: null })).toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  it("refuses anything without a usable @", () => {
    for (const proposed of ["arzt", "@praxis.de", "arzt@", "a@b@c.de"]) {
      expect(deliveryAddress({ proposed, current: null })).toEqual({
        ok: false,
        reason: "malformed",
      });
    }
  });

  it("refuses an address longer than a forward path may be", () => {
    const long = `${"a".repeat(DELIVERY_EMAIL_MAX)}@example.de`;
    expect(deliveryAddress({ proposed: long, current: null })).toEqual({
      ok: false,
      reason: "too_long",
    });
  });

  // The boundary, to the character. 254 is RFC 5321's forward-path maximum, so
  // 254 must pass and 255 must not.
  it("accepts exactly the maximum length and refuses one more", () => {
    const at = "@example.de";
    const exact = "a".repeat(DELIVERY_EMAIL_MAX - at.length) + at;
    expect(exact).toHaveLength(DELIVERY_EMAIL_MAX);
    expect(deliveryAddress({ proposed: exact, current: null }).ok).toBe(true);
    expect(deliveryAddress({ proposed: `a${exact}`, current: null })).toEqual({
      ok: false,
      reason: "too_long",
    });
  });

  // Addresses a naive regex refuses and a mail server delivers. Each of these
  // is somebody who would not receive their own certificate.
  it("accepts the unusual addresses a stricter rule would refuse", () => {
    for (const proposed of [
      "vorname.nachname+cme@praxis-am-see.de",
      "p@klinik.uni-muenchen.bayern",
      "j.müller@ärzte.de",
      "a@b.co",
      "'quoted'@example.de",
    ]) {
      expect(deliveryAddress({ proposed, current: null })).toEqual({
        ok: true,
        email: proposed,
      });
    }
  });
});
