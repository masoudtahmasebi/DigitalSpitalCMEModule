/**
 * Joining a path onto a configured base URL, without a backtracking regex
 * (P49-01).
 *
 * ## Why this is not `value.replace(/\/+$/, "")`
 *
 * It was, in four places, and CodeQL is right about all four:
 *
 * > Polynomial regular expression used on uncontrolled data
 *
 * `\/+$` anchors a repetition at the end of the string, and a regex engine
 * answering "does a run of slashes reach the end?" restarts that scan at every
 * position. On a pathological input — a long run of slashes followed by one
 * other character — the work is quadratic in the length.
 *
 * The exposure here is genuinely small: the values are `apiBase` from
 * `/config.js`, `PORTAL_BASE_URL` and `S3_ENDPOINT` from a deployment's own
 * environment. None is attacker-supplied today. But "not attacker-controlled
 * today" is how these are described right up until a host adapter passes an
 * attribute through, and the fix is four lines of obviously-linear code, so
 * there is nothing to weigh.
 *
 * ## Why one function rather than four local loops
 *
 * `@ds/domain` is where a rule lives when more than one caller needs it, and
 * this is a rule: *a configured base URL may carry trailing slashes and a
 * joined path must not double them.* The four call sites got it right
 * independently, which is exactly the situation where the fifth gets it wrong.
 *
 * It belongs in this package rather than a new one because it is pure — no
 * I/O, no clock, no framework — which is the only entry condition here.
 */

/**
 * Remove every trailing `/`, in one pass.
 *
 * Linear by construction: each character is examined at most once, and there is
 * no engine that can be made to reconsider a position.
 *
 * A string of only slashes becomes empty, which is the honest answer — `"///"`
 * names no origin, and returning `"/"` would invent one.
 */
export function stripTrailingSlashes(value: string): string {
  return stripTrailing(value, "/");
}

/**
 * Remove every trailing character drawn from `characters`, in one pass.
 *
 * The general form, because `\/+$` was not the only instance: a slug builder
 * trimming `-+$`, and the widget's read-more trimming `[\s,;:(«„-]+$` off a
 * course description, are the same regex against different sets — and the
 * course description is the one that is genuinely somebody else's text.
 *
 * `characters` is a set, not a pattern. That is deliberate: a caller cannot
 * accidentally pass something with its own backtracking in it, which is the
 * failure this function exists to remove rather than relocate.
 */
export function stripTrailing(value: string, characters: string): string {
  let end = value.length;
  while (end > 0 && characters.includes(value[end - 1] as string)) end -= 1;
  return value.slice(0, end);
}

/**
 * The index of the last whitespace character, or `-1`.
 *
 * `text.search(/\s\S*$/)` is the idiomatic spelling and is quadratic for the
 * same reason as the rest of this file. Scanning backwards answers the same
 * question by examining each character at most once — and reads more like what
 * the caller wanted, which was "where do I cut this without splitting a word".
 */
export function lastWhitespaceIndex(value: string): number {
  for (let index = value.length - 1; index >= 0; index -= 1) {
    const character = value[index] as string;
    if (
      character === " " ||
      character === "\t" ||
      character === "\n" ||
      character === "\r"
    ) {
      return index;
    }
  }
  return -1;
}

/**
 * `base` + `/` + `path`, with exactly one slash between them.
 *
 * The shape every call site actually wanted. Taking the join rather than only
 * the trim means a caller cannot strip correctly and then concatenate wrongly,
 * which is the second half of the same mistake.
 *
 * `path` is used as given: it is a literal at every call site (`health`,
 * `zertifikate/…`), not a value from a request, and quietly normalising it
 * would hide a caller passing something it should not.
 */
export function joinUrl(base: string, path: string): string {
  return `${stripTrailingSlashes(base)}/${path}`;
}
