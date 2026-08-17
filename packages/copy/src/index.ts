/**
 * @ds/copy — the learner-facing wording, and the catalogue of what may be
 * changed (P83-01).
 *
 * ## Why this is a package and not a file in the widget
 *
 * `de.ts` lived in `apps/widget/src/locale/` and CLAUDE.md §5 still says that
 * is where German user-facing copy belongs. It does — this *is* that file, one
 * directory further out, and the widget's `locale/de.ts` re-exports it so
 * nothing about the rule changed for a component author.
 *
 * What changed is who else needs to read it. Once a customer can override a
 * string (P83), three programs need the same list of strings:
 *
 *   * the **widget**, to render them;
 *   * the **API**, to refuse an override naming a key that does not exist —
 *     otherwise stored settings accumulate for screens that were renamed away,
 *     invisible and undeletable;
 *   * the **console**, to draw a field per key with its default beside it.
 *
 * A second copy of that list in either of the other two would go stale the
 * first time somebody added a sentence, and silently: the console would simply
 * not offer the field, and nobody would notice for a release. One table, three
 * readers (CLAUDE.md §4 invariant 6).
 *
 * ## Why the catalogue is derived and not written
 *
 * `COPY_KEYS` walks the table. Nothing is maintained by hand, so a key cannot
 * exist in one place and not the other, and adding a string to `de` is the
 * whole of the work needed to make it overridable.
 */

import { copyKeysOf } from "@ds/domain";

export { de } from "./de.js";
import { de } from "./de.js";

/**
 * Every string a customer may replace, as dotted paths.
 *
 * Plain strings only — `copyKeysOf` skips functions, and the functions in `de`
 * are the interpolated ones where German agreement is decided ("1 Punkt" vs
 * "4 Punkten"). Handing those to a customer as templates would lose the
 * singular and produce "1 Punkte" on an accredited course.
 */
export const COPY_KEYS: readonly string[] = copyKeysOf(de);
