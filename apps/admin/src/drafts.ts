/**
 * The three helpers every authoring editor needs (P9-02, P9-04, P9-05).
 *
 * Six editors reorder a list, six turn an empty input into `null`, and two
 * suggest a slug. Written out per file that is fourteen near-identical copies,
 * and near-identical copies of an off-by-one are how a reorder control ends up
 * working everywhere except the last row of one screen.
 */

/**
 * Swap two positions, returning a new array.
 *
 * Out-of-range indices return a copy unchanged rather than throwing or
 * producing a hole. The callers are "move up" and "move down" buttons which
 * are already disabled at the ends, so a swap that could not happen means the
 * list changed underneath the click — and doing nothing is the right answer.
 */
export function swap<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  const a = next[from];
  const b = next[to];
  if (a === undefined || b === undefined) return next;
  next[from] = b;
  next[to] = a;
  return next;
}

/**
 * An empty or whitespace-only input means "no value", not an empty string.
 *
 * The distinction reaches the database: a `text` column holding `''` and one
 * holding `NULL` render differently and compare differently, and a chapter
 * whose body is the empty string is not the same as a chapter with no body.
 */
export function nullable(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * A first guess at a slug, from a title.
 *
 * A guess and nothing more: the field stays editable and stops being derived
 * the moment it is touched. Deliberately **not** a copy of the server's
 * validator — the server decides what it accepts, and a client that
 * reimplemented that rule would eventually accept something the server rejects
 * or reject something it would have taken. The umlaut expansions are here
 * because German titles are the normal case, and `fortbildung-fr-rzte` is not
 * a slug anybody would have chosen.
 */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "")
    .slice(0, 100);
}

/**
 * A React key for a row the server has never seen.
 *
 * A uuid rather than an array index, because an index changes when a row above
 * it is deleted and React then reuses the wrong input's DOM node. On the quiz
 * screen that means a checkbox marking the wrong answer correct — the same
 * class of bug as any other, except that this one ships a quiz nobody can pass.
 */
export function freshKey(): string {
  return `new-${crypto.randomUUID()}`;
}
