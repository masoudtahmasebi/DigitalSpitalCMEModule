/**
 * White-label branding (P10-08).
 *
 * The platform is sold to more than one customer, so logo, colours and
 * typeface are data on the project record, not constants in a stylesheet. This
 * module is the one place that decides what a valid branding value is.
 *
 * ## Why this is in `packages/domain` and not in a component
 *
 * Every value here ends up inside a CSS declaration or an HTML attribute in a
 * page that holds a physician's bearer token. A colour is not a colour once it
 * reaches a stylesheet — `red; background-image: url(...)` is two declarations,
 * and a font family is a place to put a closing brace. So the values are
 * validated against strict grammars **before** they are stored and again when
 * they are read, and anything that does not match is dropped rather than
 * sanitised. Dropping is safer than repairing: a repaired value is a value
 * somebody has to reason about, and nobody will.
 *
 * Pure, exhaustively tested, no I/O — the same reason the compliance rules live
 * here (CLAUDE.md §4 invariant 4).
 *
 * ## Fonts are self-hosted, never fetched from a third party
 *
 * A customer uploads a font file; it is stored on the project and served from
 * our own origin (migration 0008). **No third party is ever contacted for a
 * font.** That is a legal position, not a technical preference: a German
 * healthcare site pulling a webfont from Google transmits every visitor's IP
 * address to a US service, which LG München I (3 O 17493/20) found unlawful
 * without consent. A CME platform for physicians is precisely the wrong place
 * to relitigate that, and "self-host it on your own CDN" only moves the
 * problem.
 *
 * Two fields, and they do different jobs:
 *
 * - `fontFamily` is a CSS font **stack** — the fallback chain, e.g.
 *   `Inter, system-ui, sans-serif`. Never a URL; the grammar cannot express
 *   `url(`.
 * - `fontFamilyName` names the uploaded file's family, and the widget emits
 *   `@font-face { font-family: <name>; src: url(<our own origin>) }` for it.
 *
 * When both are present the uploaded family goes first, so the upload wins and
 * the stack is what a browser falls back to while it downloads or if it fails.
 */

export interface Branding {
  /** Shown in the widget header. Absent means the course title stands alone. */
  readonly logoUrl?: string;
  /** Alternative text for the logo. Required whenever a logo is set. */
  readonly logoAlt?: string;
  /** Primary brand colour: buttons, active tabs, the progress ring. */
  readonly primaryColor?: string;
  /** Text drawn on top of `primaryColor`. Chosen by the customer, not derived. */
  readonly primaryContrastColor?: string;
  /** Accent used for links and focus rings. Falls back to primary. */
  readonly accentColor?: string;
  /** A CSS font stack — never a URL. See the module header. */
  readonly fontFamily?: string;
  /**
   * The family name of the customer's uploaded font, if they have one.
   *
   * Set by the API from the project row, not by the client: the value has to
   * match what the upload endpoint stored, or the `@font-face` rule names a
   * family nothing declares.
   */
  readonly fontFamilyName?: string;
  /** Cache-busting token for the font URL — the upload timestamp. */
  readonly fontVersion?: string;
  /** Radius for buttons and cards, in pixels. 0–24. */
  readonly cornerRadiusPx?: number;

  /*
   * The catalogue hero (layout §4.1).
   *
   * These four are the difference between a white-label product and one with
   * a first customer compiled into it. "Fortbildungsbereich für ADHS" is
   * MEDICE's heading, not the platform's — a second customer in a different
   * therapeutic area would be reading MEDICE's copy — and the photograph and
   * the accreditation seal behind it are likewise theirs. All four are
   * optional, and the widget's own generic wording and drawn seal stand in
   * when they are unset.
   */

  /** Replaces the catalogue heading. Plain text; it is rendered as text. */
  readonly catalogTitle?: string;
  /**
   * Replaces the catalogue's intro paragraph.
   *
   * Same argument as the heading. The widget's own wording says what the area
   * is without naming a therapeutic area, which is correct for every customer
   * and specific to none; the layout's copy names ADHS, and that is MEDICE's
   * to write.
   */
  readonly catalogIntro?: string;
  /** Photograph behind the catalogue hero. Decorative — see `CatalogHero`. */
  readonly catalogHeroImageUrl?: string;
  /**
   * The customer's own accreditation seal.
   *
   * A CME seal is an accreditation artefact, not decoration: which body
   * certified the course, and in what form they permit their mark to be shown,
   * is the customer's business with their Ärztekammer. The widget draws a
   * neutral one when this is unset rather than approximating anyone's.
   */
  readonly catalogSealImageUrl?: string;
  /** Alternative text for the seal. Required whenever a seal is set. */
  readonly catalogSealAlt?: string;

  /*
   * The privacy notice behind the Punktemeldung consent (layout page 13).
   *
   * The checkbox reads "… gemäß der Datenschutzerklärung zu" with
   * Datenschutzerklärung as a link, so the widget needs somewhere to point it.
   * The version is not decoration: it is written to
   * `enrolments.consent_document`, and it is what makes the stored consent
   * demonstrable under GDPR Art. 7(1). Consent to the January wording is not
   * consent to the June wording, and a record that cannot tell them apart
   * proves only that somebody agreed to something.
   *
   * Accepted as a pair. A link with no version produces a consent record that
   * names nothing; a version with no link asks a physician to agree to a
   * document they cannot read.
   */
  readonly privacyPolicyUrl?: string;
  readonly privacyPolicyVersion?: string;
}

/**
 * `#rgb`, `#rrggbb` or `#rrggbbaa`.
 *
 * Hex only. Named colours would be harmless but open the door to argument
 * about which names are valid; `rgb()` and `hsl()` bring parentheses and
 * commas into a value that is interpolated into CSS. One narrow grammar is
 * easier to be certain about than three broad ones.
 */
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/**
 * A CSS font stack: quoted or bare family names separated by commas.
 *
 * Deliberately excludes `;`, `{`, `}`, `(`, `)`, `:` and backslashes — every
 * character that could end the declaration or begin another one. `url(` cannot
 * be expressed at all, which is what stops this being a font-loading vector.
 */
const FONT_STACK = /^[A-Za-z0-9À-ɏ ,'"-]{1,200}$/;

/**
 * Branding images are fetched by the browser, so the scheme matters.
 *
 * The grammar is the shape check; `hasSafeAssetOrigin` below is the scheme and
 * host check. Both have to pass. Splitting them is deliberate: a regular
 * expression is the wrong tool for deciding what a host is, and
 * `http://localhost.evil.example` is what happens when it is used for that.
 */
const SAFE_URL = /^[a-z]+:\/\/[^\s"'<>]{1,500}$/i;

/**
 * An uploaded font's family name.
 *
 * Narrower than the stack grammar because this one is emitted inside an
 * `@font-face` block, where a stray brace ends the rule and starts another.
 * Letters, digits, spaces, hyphen and underscore — enough for every real
 * family name, and nothing that means anything to a CSS parser. Mirrors the
 * CHECK constraint in migration 0008.
 */
const FONT_FAMILY_NAME = /^[A-Za-z0-9 _-]{1,64}$/;

/** An ISO timestamp or any opaque token; only used as a query parameter. */
const FONT_VERSION = /^[A-Za-z0-9:.T_-]{1,40}$/;

/**
 * Characters permitted inside `src: url("…")`.
 *
 * Stricter than `SAFE_URL` because the destination is a CSS function call, not
 * an HTML attribute: a `)` or a backslash would end the `url()` token and let
 * whatever follows be parsed as CSS. Excluded accordingly, along with quotes
 * and whitespace.
 */
const FONT_SRC_CHARS = /^[^\s"'<>()\\]{1,512}$/;

/**
 * The only hosts a font may be served from over plain HTTP.
 *
 * So a developer running the API on `localhost:3000` sees their branding. Any
 * other host must be HTTPS: a font is a same-page subresource, and one fetched
 * over plain HTTP on a page holding a bearer token is a downgrade a browser
 * would block anyway.
 */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1"]);

/**
 * Whether this URL's scheme and host are acceptable for a font source.
 *
 * Parsed with `URL` rather than matched with a pattern. A regular expression
 * over a URL is where host-confusion bugs live — `http://localhost.evil.example`
 * looks like loopback to anything doing a prefix comparison — and `URL` is a
 * pure, standard parser that already knows what a host is. (It reads no clock,
 * no environment and no I/O, so it does not breach the purity rule that governs
 * this package.)
 */
/**
 * Whether this URL may be used as a branding image — logo, catalogue hero, seal.
 *
 * HTTPS anywhere, or plain HTTP on loopback. The loopback exception is the same
 * one fonts already have and it exists for the same reason: a developer running
 * the API on `localhost:3000` should see the branding they just configured,
 * rather than debugging a silently dropped field.
 *
 * It widens nothing in production. An `http:` image on an `https:` page is
 * mixed content, which every supported browser blocks outright — so the value
 * that this permits is one that cannot load anywhere a physician will ever be.
 * What it must **not** permit is a scheme that executes: `javascript:` and
 * `data:` are both absent, and `URL` is what decides that rather than a pattern.
 */
function hasSafeAssetOrigin(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (parsed.protocol === "https:") return true;
  return parsed.protocol === "http:" && LOOPBACK_HOSTS.has(parsed.hostname);
}

/** `SAFE_URL` plus a scheme and host the browser may actually be pointed at. */
function assetUrl(value: unknown): string | undefined {
  const candidate = matching(value, SAFE_URL);
  if (candidate === undefined) return undefined;
  return hasSafeAssetOrigin(candidate) ? candidate : undefined;
}

function hasSafeFontOrigin(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // Relative, scheme-less, or otherwise unparseable. A font source has to be
    // absolute — the CSS it lands in is not on the API's origin.
    return false;
  }

  if (parsed.protocol === "https:") return true;
  return parsed.protocol === "http:" && LOOPBACK_HOSTS.has(parsed.hostname);
}

const MAX_ALT_LENGTH = 200;
const MAX_CORNER_RADIUS_PX = 24;

/**
 * The catalogue heading.
 *
 * Long enough for "Fortbildungsbereich für ADHS" and a good deal more, short
 * enough that it cannot become a paragraph in a slot the layout draws as one
 * line. It is rendered as React text, so this is a layout bound rather than a
 * safety one — the safety comes from never putting it in an attribute or a
 * stylesheet.
 */
const MAX_CATALOG_TITLE_LENGTH = 120;

/** The intro paragraph. The layout gives it two lines at 1440 px. */
const MAX_CATALOG_INTRO_LENGTH = 400;

/**
 * A privacy-notice version, e.g. `datenschutz-2026-01` or `v3.2`.
 *
 * Narrow because it is stored as evidence and read back by a human answering
 * "what did this person agree to". A version that can contain arbitrary text is
 * a version that will eventually contain a sentence.
 */
const POLICY_VERSION = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * Read branding from whatever is in the `projects.branding` column.
 *
 * Total: any input produces a `Branding`, because a malformed value must not
 * be able to break a learner's screen. Invalid fields are **omitted**, not
 * corrected — the widget then falls back to its own defaults, which are always
 * valid.
 */
export function parseBranding(value: unknown): Branding {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }

  const raw = value as Record<string, unknown>;
  const branding: {
    logoUrl?: string;
    logoAlt?: string;
    primaryColor?: string;
    primaryContrastColor?: string;
    accentColor?: string;
    fontFamily?: string;
    fontFamilyName?: string;
    fontVersion?: string;
    cornerRadiusPx?: number;
    catalogTitle?: string;
    catalogIntro?: string;
    catalogHeroImageUrl?: string;
    catalogSealImageUrl?: string;
    catalogSealAlt?: string;
    privacyPolicyUrl?: string;
    privacyPolicyVersion?: string;
  } = {};

  const logoUrl = assetUrl(raw["logoUrl"]);
  const logoAlt = text(raw["logoAlt"], MAX_ALT_LENGTH);

  // A logo without alternative text is a screen reader announcing "image".
  // The a11y floor is costed in and non-negotiable (CLAUDE.md §3), so the pair
  // is accepted or neither is.
  if (logoUrl !== undefined && logoAlt !== undefined) {
    branding.logoUrl = logoUrl;
    branding.logoAlt = logoAlt;
  }

  assign(branding, "primaryColor", matching(raw["primaryColor"], HEX_COLOR));
  assign(
    branding,
    "primaryContrastColor",
    matching(raw["primaryContrastColor"], HEX_COLOR),
  );
  assign(branding, "accentColor", matching(raw["accentColor"], HEX_COLOR));
  assign(branding, "fontFamily", matching(raw["fontFamily"], FONT_STACK));

  // The uploaded font. Both halves or neither: a family name with no version
  // has no URL to point at, and a version with no name has nothing to declare.
  const fontFamilyName = matching(raw["fontFamilyName"], FONT_FAMILY_NAME);
  const fontVersion = matching(raw["fontVersion"], FONT_VERSION);
  if (fontFamilyName !== undefined && fontVersion !== undefined) {
    branding.fontFamilyName = fontFamilyName;
    branding.fontVersion = fontVersion;
  }

  const radius = raw["cornerRadiusPx"];
  if (
    typeof radius === "number" &&
    Number.isInteger(radius) &&
    radius >= 0 &&
    radius <= MAX_CORNER_RADIUS_PX
  ) {
    branding.cornerRadiusPx = radius;
  }

  assign(branding, "catalogTitle", text(raw["catalogTitle"], MAX_CATALOG_TITLE_LENGTH));
  assign(branding, "catalogIntro", text(raw["catalogIntro"], MAX_CATALOG_INTRO_LENGTH));
  assign(branding, "catalogHeroImageUrl", assetUrl(raw["catalogHeroImageUrl"]));

  // Paired for the same reason the logo is: a seal is meaningful content — it
  // is the claim that the course is accredited — so an unlabelled one is a
  // screen reader saying "image" where a physician needs "Zertifizierte CME
  // Fortbildung".
  const sealUrl = assetUrl(raw["catalogSealImageUrl"]);
  const sealAlt = text(raw["catalogSealAlt"], MAX_ALT_LENGTH);
  if (sealUrl !== undefined && sealAlt !== undefined) {
    branding.catalogSealImageUrl = sealUrl;
    branding.catalogSealAlt = sealAlt;
  }

  // Both or neither — see the note on the fields.
  const policyUrl = assetUrl(raw["privacyPolicyUrl"]);
  const policyVersion = matching(raw["privacyPolicyVersion"], POLICY_VERSION);
  if (policyUrl !== undefined && policyVersion !== undefined) {
    branding.privacyPolicyUrl = policyUrl;
    branding.privacyPolicyVersion = policyVersion;
  }

  return branding;
}

/**
 * Which submitted fields are invalid, so an admin form can say so.
 *
 * `parseBranding` drops silently because a learner's screen must render
 * whatever is stored. An admin saving a value deserves to be told it was
 * rejected, which is a different question and gets a different function.
 */
export function invalidBrandingFields(value: unknown): readonly string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return ["branding"];
  }

  const raw = value as Record<string, unknown>;
  const invalid: string[] = [];

  const check = (key: string, pattern: RegExp): void => {
    const candidate = raw[key];
    if (candidate === undefined || candidate === null) return;
    if (typeof candidate !== "string" || !pattern.test(candidate)) invalid.push(key);
  };

  /**
   * Reported by exactly the rule `parseBranding` applies.
   *
   * Not `check(key, SAFE_URL)`: the grammar alone would accept `ftp://…` and
   * the parse would then drop it, so the form would report a value as valid
   * and the learner's screen would show nothing. The two functions have to
   * agree about what a usable image URL is, and the way to be sure of that is
   * for both to call the same predicate.
   */
  const checkAssetUrl = (key: string): void => {
    const candidate = raw[key];
    if (candidate === undefined || candidate === null) return;
    if (assetUrl(candidate) === undefined) invalid.push(key);
  };

  checkAssetUrl("logoUrl");
  check("primaryColor", HEX_COLOR);
  check("primaryContrastColor", HEX_COLOR);
  check("accentColor", HEX_COLOR);
  check("fontFamily", FONT_STACK);
  checkAssetUrl("catalogHeroImageUrl");
  checkAssetUrl("catalogSealImageUrl");
  checkAssetUrl("privacyPolicyUrl");
  check("privacyPolicyVersion", POLICY_VERSION);

  /** A trimmed, non-empty string within a bound. */
  const checkText = (key: string, maxLength: number): void => {
    const candidate = raw[key];
    if (candidate === undefined || candidate === null) return;
    if (
      typeof candidate !== "string" ||
      candidate.trim() === "" ||
      candidate.length > maxLength
    ) {
      invalid.push(key);
    }
  };

  checkText("logoAlt", MAX_ALT_LENGTH);
  checkText("catalogSealAlt", MAX_ALT_LENGTH);
  checkText("catalogTitle", MAX_CATALOG_TITLE_LENGTH);
  checkText("catalogIntro", MAX_CATALOG_INTRO_LENGTH);

  // The pairing rule, reported so the form can explain it rather than silently
  // discarding a logo the admin just uploaded.
  const missingAlt = (urlKey: string, altKey: string): void => {
    const url = raw[urlKey];
    const alt = raw[altKey];
    const hasUrl = typeof url === "string" && url !== "";
    const hasAlt = typeof alt === "string" && alt.trim() !== "";
    if (hasUrl && !hasAlt && !invalid.includes(altKey)) invalid.push(altKey);
  };

  missingAlt("logoUrl", "logoAlt");
  missingAlt("catalogSealImageUrl", "catalogSealAlt");
  missingAlt("privacyPolicyUrl", "privacyPolicyVersion");

  const radius = raw["cornerRadiusPx"];
  if (radius !== undefined && radius !== null) {
    if (
      typeof radius !== "number" ||
      !Number.isInteger(radius) ||
      radius < 0 ||
      radius > MAX_CORNER_RADIUS_PX
    ) {
      invalid.push("cornerRadiusPx");
    }
  }

  return invalid;
}

/**
 * Branding as CSS custom properties.
 *
 * Returns pairs, not a string, so the caller sets them as properties on an
 * element rather than concatenating a stylesheet. That distinction matters:
 * `element.style.setProperty` cannot be escaped out of, while a built-up CSS
 * string can. The validation above should already make it impossible; this
 * makes it impossible twice.
 *
 * Only set variables are returned. An unset one falls through to the default
 * in the widget's own stylesheet, which is always valid.
 */
export function brandingCssVariables(
  branding: Branding,
): ReadonlyArray<[string, string]> {
  const vars: Array<[string, string]> = [];

  if (branding.primaryColor !== undefined) {
    vars.push(["--ds-brand-600", branding.primaryColor]);
    // A single supplied colour drives the hover state too, rather than leaving
    // a default blue hover on a green button.
    vars.push(["--ds-brand-700", branding.primaryColor]);
  }
  if (branding.primaryContrastColor !== undefined) {
    vars.push(["--ds-brand-contrast", branding.primaryContrastColor]);
  }
  if (branding.accentColor !== undefined) {
    vars.push(["--ds-accent", branding.accentColor]);
  }
  // The uploaded family goes first, so it wins and the configured stack is
  // what the browser uses while downloading it or if it fails to load.
  const stack = [
    branding.fontFamilyName === undefined ? undefined : `"${branding.fontFamilyName}"`,
    branding.fontFamily,
  ]
    .filter((part): part is string => part !== undefined)
    .join(", ");

  if (stack !== "") vars.push(["--ds-font-family", stack]);
  if (branding.cornerRadiusPx !== undefined) {
    vars.push(["--ds-radius", `${branding.cornerRadiusPx}px`]);
  }

  return vars;
}

/**
 * The `@font-face` rule for a customer's uploaded font, or `undefined`.
 *
 * ## Why this returns a string when everything else returns pairs
 *
 * `brandingCssVariables` deliberately avoids building CSS text, because
 * `setProperty` cannot be escaped out of. An `@font-face` rule has no such API:
 * a font face genuinely has to be declared as CSS, so this is the one place in
 * the platform that concatenates a stylesheet — which is exactly why it lives
 * here, pure and tested, rather than inline in a component.
 *
 * Both interpolated values are re-validated against their grammars *at the
 * point of concatenation*, not merely trusted from `parseBranding`. Returning
 * `undefined` rather than a sanitised rule is the same rule as everywhere else
 * in this module: a repaired value is a value somebody has to reason about.
 *
 * ## Why the caller must put this in the document, not in a shadow root
 *
 * Chrome does not apply `@font-face` rules declared inside a shadow root — the
 * font simply never loads and the fallback stack renders, which looks like a
 * broken upload rather than a scoping rule. The rule goes in the document; the
 * `font-family` reference stays inside the widget.
 *
 * @param familyName the uploaded font's family, from `Branding.fontFamilyName`
 * @param url absolute URL of the font file, on the API's own origin
 */
export function fontFaceRule(familyName: string, url: string): string | undefined {
  if (!FONT_FAMILY_NAME.test(familyName)) return undefined;
  if (!FONT_SRC_CHARS.test(url)) return undefined;
  if (!hasSafeFontOrigin(url)) return undefined;

  return (
    `@font-face{font-family:"${familyName}";src:url("${url}");` +
    // `swap`: text renders immediately in the fallback stack and switches when
    // the file arrives. The alternative is a physician looking at a blank
    // paragraph while a webfont downloads on hospital wifi.
    `font-display:swap;` +
    // One uploaded file covers every weight. For a variable font this is the
    // real range; for a static one it tells the browser to synthesise bold
    // rather than silently falling back to a different family for it.
    `font-weight:100 900;font-style:normal;}`
  );
}

function matching(value: unknown, pattern: RegExp): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return pattern.test(trimmed) ? trimmed : undefined;
}

function text(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.length > maxLength) return undefined;
  return trimmed;
}

function assign<K extends keyof Branding>(
  target: { [P in K]?: Branding[P] },
  key: K,
  value: Branding[K] | undefined,
): void {
  if (value !== undefined) target[key] = value;
}
