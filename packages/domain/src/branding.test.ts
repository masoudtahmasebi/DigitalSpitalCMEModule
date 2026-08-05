import { describe, expect, it } from "vitest";
import {
  brandingCssVariables,
  fontFaceRule,
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

describe("an uploaded font", () => {
  it("goes first in the stack, so the upload wins", () => {
    // And the configured stack is what a browser uses while the file
    // downloads, or if it never arrives.
    const vars = brandingCssVariables(
      parseBranding({
        fontFamilyName: "Medice Sans",
        fontVersion: "2026-07-28T12:00:00.000Z",
        fontFamily: "Inter, system-ui, sans-serif",
      }),
    );

    expect(vars).toContainEqual([
      "--ds-font-family",
      '"Medice Sans", Inter, system-ui, sans-serif',
    ]);
  });

  it("stands alone when no fallback stack is configured", () => {
    expect(
      brandingCssVariables(
        parseBranding({ fontFamilyName: "Medice Sans", fontVersion: "v1" }),
      ),
    ).toContainEqual(["--ds-font-family", '"Medice Sans"']);
  });

  it("needs both the name and the version, since one without the other is unusable", () => {
    // A name with no version has no URL to point at; a version with no name
    // has nothing to declare.
    expect(
      parseBranding({ fontFamilyName: "Medice Sans" }).fontFamilyName,
    ).toBeUndefined();
    expect(parseBranding({ fontVersion: "v1" }).fontVersion).toBeUndefined();
  });

  it("refuses a family name that would break out of the @font-face block", () => {
    // This one is emitted inside `@font-face { font-family: … }`, where a
    // brace ends the rule and starts another.
    for (const name of [
      'Evil"; } body { display: none } @font-face { font-family: "x',
      "Evil}",
      "Evil;",
      "url(https://evil/x)",
      "Evil'",
    ]) {
      expect(
        parseBranding({ fontFamilyName: name, fontVersion: "v1" }).fontFamilyName,
      ).toBeUndefined();
    }
  });

  it("refuses a version that could escape the query string", () => {
    for (const version of ['v1" onload="x', "v1&evil=1", "../../etc", "v1 v2"]) {
      expect(
        parseBranding({ fontFamilyName: "Medice Sans", fontVersion: version })
          .fontVersion,
      ).toBeUndefined();
    }
  });

  it("accepts the real shape — a name and an ISO timestamp", () => {
    const branding = parseBranding({
      fontFamilyName: "Medice Sans",
      fontVersion: "2026-07-28T12:00:00.000Z",
    });

    expect(branding.fontFamilyName).toBe("Medice Sans");
    expect(branding.fontVersion).toBe("2026-07-28T12:00:00.000Z");
  });
});

describe("fontFaceRule", () => {
  const url = "https://api.cme.example.de/branding/font?project=medice-adhs&v=2026-07-28";

  it("emits a rule naming the family and the file", () => {
    const rule = fontFaceRule("Medice Sans", url);

    expect(rule).toContain('font-family:"Medice Sans"');
    expect(rule).toContain(`src:url("${url}")`);
    // The physician reads text while the file downloads, rather than a blank
    // paragraph on hospital wifi.
    expect(rule).toContain("font-display:swap");
    // One uploaded file has to serve every weight, or bold text falls back to
    // a different family mid-sentence.
    expect(rule).toContain("font-weight:100 900");
  });

  it("produces exactly one balanced rule", () => {
    const rule = fontFaceRule("Medice Sans", url) ?? "";
    expect(rule.match(/@font-face/g)).toHaveLength(1);
    expect(rule.match(/\{/g)).toHaveLength(1);
    expect(rule.match(/\}/g)).toHaveLength(1);
  });

  it("refuses a family name that would close the rule", () => {
    // This is the one place in the platform that concatenates CSS text, so the
    // grammar is re-checked here rather than trusted from parseBranding.
    for (const name of [
      'X"}body{display:none}@font-face{font-family:"Y',
      "X; }",
      "X\\22 }",
    ]) {
      expect(fontFaceRule(name, url)).toBeUndefined();
    }
  });

  it("refuses a URL that would close the url() token", () => {
    for (const bad of [
      'https://evil.example/f.woff2");}body{display:none}@font-face{src:url("x',
      "https://evil.example/f.woff2)",
      "https://evil.example/a\\)b",
      "https://evil.example/a b",
      "javascript:alert(1)",
      "data:font/woff2;base64,AAAA",
      "//evil.example/f.woff2",
    ]) {
      expect(fontFaceRule("Medice Sans", bad)).toBeUndefined();
    }
  });

  it("refuses plain HTTP except on loopback", () => {
    // The page holding this font also holds a bearer token. A developer on
    // localhost is the one case where there is no network to downgrade.
    expect(
      fontFaceRule("Medice Sans", "http://api.example.de/branding/font"),
    ).toBeUndefined();
    expect(
      fontFaceRule("Medice Sans", "http://localhost:3000/branding/font?v=1"),
    ).toContain("@font-face");
    expect(
      fontFaceRule("Medice Sans", "http://127.0.0.1:3000/branding/font?v=1"),
    ).toContain("@font-face");
    // Not a loopback host, however much it looks like one.
    expect(
      fontFaceRule("Medice Sans", "http://localhost.evil.example/branding/font"),
    ).toBeUndefined();
  });
});

/**
 * The catalogue hero's white-label fields.
 *
 * The heading is the one that mattered: "Fortbildungsbereich für ADHS" was
 * compiled into the widget bundle, so a second customer in a different
 * therapeutic area would have been reading MEDICE's heading over their own
 * courses. It is branding, and branding is data on the project row.
 */
describe("the catalogue hero", () => {
  it("accepts a heading, a photograph and a labelled seal", () => {
    expect(
      parseBranding({
        catalogTitle: "Fortbildungsbereich für ADHS",
        catalogHeroImageUrl: "https://cdn.medice.de/hero.jpg",
        catalogSealImageUrl: "https://cdn.medice.de/siegel.png",
        catalogSealAlt: "Zertifizierte CME Fortbildung",
      }),
    ).toEqual({
      catalogTitle: "Fortbildungsbereich für ADHS",
      catalogHeroImageUrl: "https://cdn.medice.de/hero.jpg",
      catalogSealImageUrl: "https://cdn.medice.de/siegel.png",
      catalogSealAlt: "Zertifizierte CME Fortbildung",
    });
  });

  it("drops a seal with no alternative text, and the alt with no seal", () => {
    // Same rule as the logo. A seal is the claim that the course is
    // accredited, so an unlabelled one is a screen reader saying "image"
    // where a physician needs the claim itself.
    expect(
      parseBranding({ catalogSealImageUrl: "https://cdn.medice.de/siegel.png" }),
    ).toEqual({});
    expect(parseBranding({ catalogSealAlt: "Zertifizierte CME Fortbildung" })).toEqual(
      {},
    );
  });

  it("refuses image URLs that are not https", () => {
    for (const bad of [
      "http://cdn.medice.de/hero.jpg",
      "javascript:alert(1)",
      "data:image/png;base64,AAAA",
      "//cdn.medice.de/hero.jpg",
      "/hero.jpg",
    ]) {
      expect(parseBranding({ catalogHeroImageUrl: bad })).toEqual({});
    }
  });

  it("permits plain HTTP on loopback, as fonts already do", () => {
    // So a developer running the API on localhost sees the branding they just
    // configured, instead of debugging a silently dropped field. It widens
    // nothing in production: an http image on an https page is mixed content
    // and the browser blocks it outright.
    expect(
      parseBranding({ catalogHeroImageUrl: "http://localhost:4411/hero.jpg" }),
    ).toEqual({ catalogHeroImageUrl: "http://localhost:4411/hero.jpg" });
    expect(
      parseBranding({ catalogHeroImageUrl: "http://127.0.0.1:4411/hero.jpg" }),
    ).toEqual({ catalogHeroImageUrl: "http://127.0.0.1:4411/hero.jpg" });
    // Not a loopback host, however much it looks like one.
    expect(
      parseBranding({ catalogHeroImageUrl: "http://localhost.evil.example/hero.jpg" }),
    ).toEqual({});
  });

  it("agrees with the admin form about what a usable image URL is", () => {
    // The two functions answering differently is the failure worth pinning:
    // a form that accepts a value the parse then drops reports success and
    // shows the learner nothing.
    for (const url of [
      "ftp://cdn.medice.de/hero.jpg",
      "javascript:alert(1)",
      "http://cdn.medice.de/hero.jpg",
    ]) {
      expect(parseBranding({ catalogHeroImageUrl: url })).toEqual({});
      expect(invalidBrandingFields({ catalogHeroImageUrl: url })).toEqual([
        "catalogHeroImageUrl",
      ]);
    }
  });

  it("refuses a heading that is empty, whitespace or a paragraph", () => {
    expect(parseBranding({ catalogTitle: "" })).toEqual({});
    expect(parseBranding({ catalogTitle: "   " })).toEqual({});
    expect(parseBranding({ catalogTitle: "x".repeat(121) })).toEqual({});
    // The bound itself is accepted.
    expect(parseBranding({ catalogTitle: "x".repeat(120) })).toEqual({
      catalogTitle: "x".repeat(120),
    });
  });

  it("reports each rejected catalogue field to an admin form", () => {
    expect(
      invalidBrandingFields({
        catalogTitle: "x".repeat(121),
        catalogHeroImageUrl: "http://cdn.medice.de/hero.jpg",
        catalogSealImageUrl: "https://cdn.medice.de/siegel.png",
      }),
    ).toEqual(["catalogHeroImageUrl", "catalogTitle", "catalogSealAlt"]);
  });

  it("says nothing about catalogue fields that are simply absent", () => {
    expect(invalidBrandingFields({ primaryColor: "#0d6f7a" })).toEqual([]);
  });
});
