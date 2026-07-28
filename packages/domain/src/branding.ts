/**
 * White-label branding (P10-05).
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
 * ## Fonts are named, never fetched
 *
 * `fontFamily` is a CSS font stack. It is **not** a URL and the platform never
 * loads a font from a third party. That is deliberate and it is a legal
 * position, not a technical preference: a German healthcare site that pulls a
 * webfont from Google Fonts transmits every visitor's IP address to a US
 * service, which German courts have already found unlawful without consent
 * (LG München I, 3 O 17493/20). A CME platform for physicians is precisely the
 * wrong place to relitigate that.
 *
 * A customer who wants their own typeface self-hosts it and declares
 * `@font-face` in their own page. A shadow root cannot declare fonts for the
 * document, but it *can* use families the document has already declared —
 * `@font-face` is document-scoped — so naming the family is enough.
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
  if (branding.fontFamily !== undefined) {
    vars.push(["--ds-font-family", branding.fontFamily]);
  }
  if (branding.cornerRadiusPx !== undefined) {
    vars.push(["--ds-radius", `${branding.cornerRadiusPx}px`]);
  }

  return vars;
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
