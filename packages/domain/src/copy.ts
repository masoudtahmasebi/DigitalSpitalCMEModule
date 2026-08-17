/**
 * Customer-editable interface copy (P83-01).
 *
 * ## Why this exists
 *
 * Asked for directly: _"the texts in the learners widgets should be changable
 * from the admin panel for each customer individually"_ — with the widget's
 * `de.ts` as the defaults rather than the last word.
 *
 * The platform is multi-tenant and the copy is not neutral. "Fortbildung",
 * "Lernerfolgskontrolle", "Mediathek" are MEDICE's words for MEDICE's product;
 * another customer in another therapeutic area has their own, and until now
 * changing one meant a deploy. `Branding` already carries the customer's
 * colours, logo and catalogue title through the same channel — this is the same
 * idea applied to the sentences.
 *
 * ## What is overridable, and what deliberately is not
 *
 * **Plain strings only.** The locale file also holds functions, and they are
 * functions for a reason its own header records: German agreement is decided
 * there, so "1 Punkt" and "4 Punkten" are one call and not one template with a
 * plural bug. A customer handed `"{count} Punkte"` would lose the singular and
 * have no way to express it, and the first person to notice would be a
 * physician reading "1 Punkte" on an accredited course.
 *
 * So the interpolated copy keeps its code-defined form, and the console **says
 * so** where somebody looks for it rather than quietly omitting those keys
 * (CLAUDE.md §9.4). Templates with plural cases are a bigger feature and would
 * be scope creep dressed as consistency.
 *
 * ## Why an unknown key is refused rather than ignored
 *
 * An override map is stored data that outlives the code that wrote it. If a key
 * disappears from the defaults — renamed, or a screen removed — its override
 * becomes a string with no home. Accepting it means carrying values nobody can
 * see and nobody can find to delete; refusing it means the console can tell an
 * operator which of their settings no longer applies.
 *
 * ## What this cannot do, by construction
 *
 * Every value here is rendered as **text**, never as markup — the widget's own
 * rule, because it renders inside a closed shadow root that holds a bearer
 * token and a careless admin account must not become a scripting vector. This
 * module does not sanitise HTML because nothing here is ever HTML; it bounds
 * length and refuses control characters, and the renderer does the rest.
 */

/** A flat map of dotted key to the string a customer wants instead. */
export type CopyOverrides = Readonly<Record<string, string>>;

/**
 * The longest override accepted.
 *
 * Generous — the longest default is a paragraph explaining the EFN — and still
 * a bound, because this is stored per customer, sent to every learner on every
 * mount, and typed into a form.
 */
export const COPY_MAX_LENGTH = 2000;

export type CopyRejection =
  /** No such key in the defaults. A rename, or a typo, or a stale setting. */
  | "unknown_key"
  /** Not a string at all. */
  | "not_text"
  /** Longer than `COPY_MAX_LENGTH`. */
  | "too_long"
  /**
   * Contains a control character.
   *
   * Not a security boundary — the renderer's text-only rule is that — but a
   * newline in a button label and a zero-width space in a heading are both
   * "why does this look wrong" bugs that nobody can see in a form field.
   */
  | "control_characters";

export interface RejectedCopy {
  /** The key. **Never the value** — see the note on `invalidCopyKeys`. */
  readonly key: string;
  readonly reason: CopyRejection;
}

/**
 * Every overridable key in a nested defaults object, as dotted paths.
 *
 * Derived from the defaults rather than written beside them, so there is one
 * list and it cannot fall behind (CLAUDE.md §4 invariant 6). A key catalogue
 * maintained by hand would go stale the first time somebody added a sentence,
 * and the failure mode is silent: the console simply would not offer the field.
 *
 * Functions are skipped, which is what makes the "plain strings only" rule in
 * the module header mechanical rather than a convention.
 */
export function copyKeysOf(defaults: unknown, prefix = ""): readonly string[] {
  if (defaults === null || typeof defaults !== "object") return [];

  const keys: string[] = [];
  for (const [name, value] of Object.entries(defaults as Record<string, unknown>)) {
    const path = prefix === "" ? name : `${prefix}.${name}`;
    if (typeof value === "string") {
      keys.push(path);
      continue;
    }
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      keys.push(...copyKeysOf(value, path));
    }
    // Functions and arrays fall through deliberately — see the module header.
  }
  return keys;
}

/** The default at a dotted path, or `undefined` when there is none. */
export function copyDefaultAt(defaults: unknown, key: string): string | undefined {
  let cursor: unknown = defaults;
  for (const segment of key.split(".")) {
    if (cursor === null || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return typeof cursor === "string" ? cursor : undefined;
}

/*
 * Control characters, written as escapes rather than typed in.
 *
 * A literal control character in a source file is invisible in every editor,
 * survives copy-paste into places nobody expects, and makes the file itself
 * binary to `grep`. The class is C0, DEL, and C1.
 */
// eslint-disable-next-line no-control-regex -- finding them is the point
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u;

/**
 * Which of these overrides cannot be stored, and why.
 *
 * **Names keys, never values** (CLAUDE.md §9.5). The case that decides it is a
 * customer pasting something they should not have — a token, an internal note,
 * a fragment of somebody's name — into a copy field: the refusal is written to
 * a log, shown on a screen and sometimes emailed, and it must not carry the
 * value with it. The same rule `invalidBrandingFields` follows, for the same
 * reason: the case that exercises branding validation is a CSS injection.
 *
 * An **empty** value is not a rejection. It means "stop overriding this", which
 * is how somebody undoes a change, and `applyCopyOverrides` treats it that way.
 */
export function invalidCopyKeys(
  overrides: Readonly<Record<string, unknown>>,
  knownKeys: readonly string[],
): readonly RejectedCopy[] {
  const known = new Set(knownKeys);
  const rejected: RejectedCopy[] = [];

  for (const [key, value] of Object.entries(overrides)) {
    if (!known.has(key)) {
      rejected.push({ key, reason: "unknown_key" });
      continue;
    }
    if (typeof value !== "string") {
      rejected.push({ key, reason: "not_text" });
      continue;
    }
    if (value.length > COPY_MAX_LENGTH) {
      rejected.push({ key, reason: "too_long" });
      continue;
    }
    if (CONTROL_CHARACTERS.test(value)) {
      rejected.push({ key, reason: "control_characters" });
    }
  }

  return rejected;
}

/**
 * The overrides worth storing: known, textual, bounded, and not blank.
 *
 * Total and silent — anything `invalidCopyKeys` would reject is dropped rather
 * than throwing. The two are used together and in that order: the API reports
 * the rejections to the operator who can fix them, and stores what is left.
 * A learner's page must never fail to render because a setting is malformed.
 */
export function parseCopyOverrides(
  raw: unknown,
  knownKeys: readonly string[],
): CopyOverrides {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return {};

  const known = new Set(knownKeys);
  const accepted: Record<string, string> = {};

  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!known.has(key)) continue;
    if (typeof value !== "string") continue;
    if (value.length > COPY_MAX_LENGTH) continue;
    if (CONTROL_CHARACTERS.test(value)) continue;
    // Blank means "use the default", not "render nothing". A button with an
    // empty label is a control nobody can read (§9.2's neighbour), and it would
    // be indistinguishable from a broken screen.
    const trimmed = value.trim();
    if (trimmed === "") continue;
    accepted[key] = trimmed;
  }

  return accepted;
}

/**
 * The defaults with the customer's words in place of ours.
 *
 * Returns a **new** object of the same shape; the defaults are never mutated,
 * because they are a module-level constant shared by every render in the page
 * and a widget that edited them would leak one customer's copy into another's
 * mount on a page hosting two.
 *
 * Only the paths that exist in `defaults` are touched, so this cannot introduce
 * a key — the shape a component reads is exactly the shape it was compiled
 * against, and a missing override is the default rather than `undefined`.
 */
export function applyCopyOverrides<T>(defaults: T, overrides: CopyOverrides): T {
  if (Object.keys(overrides).length === 0) return defaults;
  return applyAt(defaults, overrides, "") as T;
}

function applyAt(node: unknown, overrides: CopyOverrides, prefix: string): unknown {
  if (node === null || typeof node !== "object" || Array.isArray(node)) return node;

  const result: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(node as Record<string, unknown>)) {
    const path = prefix === "" ? name : `${prefix}.${name}`;

    if (typeof value === "string") {
      result[name] = overrides[path] ?? value;
      continue;
    }
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      result[name] = applyAt(value, overrides, path);
      continue;
    }
    // A function keeps its identity: it is the same function object, so a
    // component holding a reference across a re-render is not re-created, and
    // German agreement stays where it was decided.
    result[name] = value;
  }
  return result;
}
