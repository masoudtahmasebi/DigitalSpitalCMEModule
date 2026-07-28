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

/** Logos are fetched by the browser, so the scheme matters. */
const SAFE_URL = /^https:\/\/[^\s"'<>]{1,500}$/;

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
  } = {};

  const logoUrl = matching(raw["logoUrl"], SAFE_URL);
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

  check("logoUrl", SAFE_URL);
  check("primaryColor", HEX_COLOR);
  check("primaryContrastColor", HEX_COLOR);
  check("accentColor", HEX_COLOR);
  check("fontFamily", FONT_STACK);

  const alt = raw["logoAlt"];
  if (alt !== undefined && alt !== null) {
    if (typeof alt !== "string" || alt.trim() === "" || alt.length > MAX_ALT_LENGTH) {
      invalid.push("logoAlt");
    }
  }

  // The pairing rule, reported so the form can explain it rather than silently
  // discarding a logo the admin just uploaded.
  const hasLogo = typeof raw["logoUrl"] === "string" && raw["logoUrl"] !== "";
  const hasAlt =
    typeof raw["logoAlt"] === "string" && (raw["logoAlt"] as string).trim() !== "";
  if (hasLogo && !hasAlt && !invalid.includes("logoAlt")) invalid.push("logoAlt");

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
