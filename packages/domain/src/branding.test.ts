import { describe, expect, it } from "vitest";
import {
  brandingCssVariables,
  invalidBrandingFields,
  parseBranding,
} from "./branding.js";

describe("parseBranding accepts what a customer legitimately sets", () => {
  it("reads a full branding record", () => {
    expect(
      parseBranding({
        logoUrl: "https://cdn.medice.de/logo.svg",
        logoAlt: "MEDICE",
        primaryColor: "#0a7f4b",
        primaryContrastColor: "#ffffff",
        accentColor: "#0a7f4b",
        fontFamily: "Inter, system-ui, sans-serif",
        cornerRadiusPx: 8,
      }),
    ).toEqual({
      logoUrl: "https://cdn.medice.de/logo.svg",
      logoAlt: "MEDICE",
      primaryColor: "#0a7f4b",
      primaryContrastColor: "#ffffff",
      accentColor: "#0a7f4b",
      fontFamily: "Inter, system-ui, sans-serif",
      cornerRadiusPx: 8,
    });
  });

  it("accepts the three hex lengths", () => {
    for (const color of ["#fff", "#ffffff", "#ffffffcc"]) {
      expect(parseBranding({ primaryColor: color }).primaryColor).toBe(color);
    }
  });

  it("accepts a quoted family name and German characters", () => {
    expect(
      parseBranding({ fontFamily: `"Helvetica Neue", Grün-Sans, sans-serif` }).fontFamily,
    ).toBe(`"Helvetica Neue", Grün-Sans, sans-serif`);
  });

  it("trims incidental whitespace", () => {
    expect(parseBranding({ primaryColor: "  #0a7f4b  " }).primaryColor).toBe("#0a7f4b");
  });
});

describe("a branding value is a CSS injection vector, and is treated as one", () => {
  it("drops a colour that closes the declaration", () => {
    // `red; background-image: url(https://evil/pixel)` is two declarations, and
    // the second one exfiltrates the fact that a physician opened this page.
    expect(
      parseBranding({ primaryColor: "red; background-image: url(https://evil/x)" }),
    ).toEqual({});
  });

  it("drops a font stack containing a url(", () => {
    // This is the one that would turn "name a font" into "load a font", which
    // is the GDPR exposure the design exists to avoid.
    expect(
      parseBranding({ fontFamily: "url(https://fonts.gstatic.com/x.woff2)" }),
    ).toEqual({});
  });

  it("drops a font stack with a brace or semicolon", () => {
    for (const candidate of ["Inter}", "Inter; color: red", "Inter{}", "In\\ter"]) {
      expect(parseBranding({ fontFamily: candidate })).toEqual({});
    }
  });

  it("drops a javascript: logo URL", () => {
    expect(parseBranding({ logoUrl: "javascript:alert(1)", logoAlt: "x" })).toEqual({});
  });

  it("drops a data: logo URL", () => {
    // A data: URL can carry an SVG, and an SVG is executable markup.
    expect(
      parseBranding({
        logoUrl: "data:image/svg+xml,<svg onload='alert(1)'></svg>",
        logoAlt: "x",
      }),
    ).toEqual({});
  });

  it("drops a plain-http logo URL", () => {
    // Mixed content on a page that holds a bearer token.
    expect(
      parseBranding({ logoUrl: "http://cdn.example/logo.png", logoAlt: "x" }),
    ).toEqual({});
  });

  it("drops a logo URL containing a quote", () => {
    expect(
      parseBranding({ logoUrl: 'https://cdn/x.png" onerror="alert(1)', logoAlt: "x" }),
    ).toEqual({});
  });
});

describe("what it does with nonsense", () => {
  it("returns empty branding rather than throwing", () => {
    for (const value of [null, undefined, 42, "string", [], [1, 2]]) {
      expect(parseBranding(value)).toEqual({});
    }
  });

  it("keeps the valid fields and drops only the invalid ones", () => {
    // A learner's screen must render whatever is stored, so one bad value does
    // not discard a whole customer's branding.
    expect(parseBranding({ primaryColor: "#0a7f4b", fontFamily: "Inter; evil" })).toEqual(
      { primaryColor: "#0a7f4b" },
    );
  });

  it("rejects a corner radius outside the range, or a fractional one", () => {
    for (const radius of [-1, 25, 4.5, "8", Number.NaN]) {
      expect(parseBranding({ cornerRadiusPx: radius }).cornerRadiusPx).toBeUndefined();
    }
  });

  it("accepts the range boundaries", () => {
    expect(parseBranding({ cornerRadiusPx: 0 }).cornerRadiusPx).toBe(0);
    expect(parseBranding({ cornerRadiusPx: 24 }).cornerRadiusPx).toBe(24);
  });
});

describe("a logo without alternative text is not a logo", () => {
  it("drops a logo with no alt", () => {
    // The a11y floor is costed in and non-negotiable (CLAUDE.md §3). A logo a
    // screen reader announces as "image" is worse than no logo.
    expect(parseBranding({ logoUrl: "https://cdn/logo.png" })).toEqual({});
  });

  it("drops a logo whose alt is only whitespace", () => {
    expect(parseBranding({ logoUrl: "https://cdn/logo.png", logoAlt: "   " })).toEqual(
      {},
    );
  });

  it("drops an alt with no logo, since it describes nothing", () => {
    expect(parseBranding({ logoAlt: "MEDICE" })).toEqual({});
  });
});

describe("invalidBrandingFields tells an admin what was rejected", () => {
  it("names each bad field", () => {
    expect(
      invalidBrandingFields({
        primaryColor: "not-a-colour",
        fontFamily: "Inter; evil",
        logoUrl: "http://insecure/logo.png",
      }),
    ).toEqual(expect.arrayContaining(["primaryColor", "fontFamily", "logoUrl"]));
  });

  it("says nothing about fields that were not submitted", () => {
    expect(invalidBrandingFields({ primaryColor: "#fff" })).toEqual([]);
  });

  it("explains the logo/alt pairing rather than silently discarding the logo", () => {
    expect(invalidBrandingFields({ logoUrl: "https://cdn/logo.png" })).toEqual([
      "logoAlt",
    ]);
  });

  it("reports a non-object as a whole-value problem", () => {
    expect(invalidBrandingFields("nope")).toEqual(["branding"]);
  });

  it("agrees with parseBranding on everything valid", () => {
    const valid = {
      logoUrl: "https://cdn.medice.de/logo.svg",
      logoAlt: "MEDICE",
      primaryColor: "#0a7f4b",
      fontFamily: "Inter, sans-serif",
      cornerRadiusPx: 8,
    };
    expect(invalidBrandingFields(valid)).toEqual([]);
    expect(Object.keys(parseBranding(valid)).sort()).toEqual(Object.keys(valid).sort());
  });
});

describe("brandingCssVariables", () => {
  it("emits nothing for empty branding, so defaults stand", () => {
    expect(brandingCssVariables({})).toEqual([]);
  });

  it("drives the hover state from a single supplied colour", () => {
    // Otherwise a green button keeps the default blue hover.
    const vars = brandingCssVariables({ primaryColor: "#0a7f4b" });
    expect(vars).toEqual([
      ["--ds-brand-600", "#0a7f4b"],
      ["--ds-brand-700", "#0a7f4b"],
    ]);
  });

  it("emits the radius with its unit", () => {
    expect(brandingCssVariables({ cornerRadiusPx: 8 })).toEqual([["--ds-radius", "8px"]]);
  });

  it("emits pairs rather than a CSS string", () => {
    // The caller uses setProperty, which cannot be escaped out of; a
    // concatenated stylesheet could be.
    for (const [name, value] of brandingCssVariables({
      primaryColor: "#0a7f4b",
      fontFamily: "Inter, sans-serif",
    })) {
      expect(name.startsWith("--ds-")).toBe(true);
      expect(value).not.toContain(";");
      expect(value).not.toContain("}");
    }
  });
});
