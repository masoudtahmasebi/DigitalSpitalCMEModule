/**
 * Which language the console speaks (P86-01).
 *
 * ## Why the table is chosen once, at import
 *
 * Every screen imports `de` directly — thirty files — and that is the right
 * shape for a console whose copy is authoritative and checked term by term
 * (CLAUDE.md §5). Threading a locale object through thirty components to make a
 * dropdown work would be a rewrite of the console to add a feature to its
 * header.
 *
 * So the choice is read here, once, before any table is built, and changing it
 * **reloads the page**. That is not a workaround dressed up: an admin console
 * switching language is a deliberate, rare act, a reload takes a moment, and
 * the alternative costs every component a context read for the benefit of
 * avoiding it. What it does buy is that there is exactly one moment when the
 * language is decided, so no screen can be half-translated mid-session.
 *
 * ## Why English falls back to German rather than being complete
 *
 * The console is roughly a thousand strings written against a German layout
 * whose terms are contractual — _Zertifizierung_, _Lernerfolgskontrolle_,
 * _Teilnahmebescheinigung_. Translating all of them is a translation job, not
 * an engineering one, and inventing English for an accreditation term is the
 * kind of guess CLAUDE.md §7 exists to stop.
 *
 * So `en` is a *partial* table merged over the German one. A key nobody has
 * translated yet renders in German, which is legible to the operator this
 * console is for, rather than rendering a key name or an empty string. Filling
 * it in is additive and safe: each new entry is one more sentence that switches
 * over, and nothing else changes.
 */

export type Language = "de" | "en";

const STORAGE_KEY = "ds-admin-language";

/** German unless somebody has chosen otherwise. The first client is German. */
const DEFAULT: Language = "de";

export function currentLanguage(): Language {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "en" ? "en" : DEFAULT;
  } catch {
    // A console in a private window with storage denied still has to render.
    return DEFAULT;
  }
}

/**
 * Choose a language and start again.
 *
 * The reload is the point — see the header. It is deliberate rather than
 * incidental, so it is here in one place rather than left to the caller to
 * remember.
 */
export function chooseLanguage(language: Language): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // Nothing to be done, and refusing to switch would be worse than
    // switching for this page load only.
  }
  window.location.reload();
}

/**
 * The German table with any translated strings laid over it.
 *
 * Recursive, string-valued keys only, and it never introduces a key — the
 * shape a component reads is exactly the shape it was compiled against, so a
 * partial translation cannot produce `undefined` on a screen.
 */
export function overlay<T>(base: T, translations: unknown): T {
  if (
    translations === null ||
    typeof translations !== "object" ||
    base === null ||
    typeof base !== "object"
  ) {
    return base;
  }

  const over = translations as Record<string, unknown>;
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(base as Record<string, unknown>)) {
    const replacement = over[key];

    if (typeof value === "string") {
      result[key] =
        typeof replacement === "string" && replacement !== "" ? replacement : value;
      continue;
    }
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      result[key] = overlay(value, replacement);
      continue;
    }
    /*
     * Functions and arrays keep the German original.
     *
     * The same rule the learner widget's copy overrides follow, for the same
     * reason: a function is where agreement and pluralisation are decided, and
     * a translation table cannot express that as a string. Translating those
     * means writing an English function, which is a bigger change than this
     * mechanism and is deliberately out of it.
     */
    result[key] = value;
  }

  return result as T;
}
