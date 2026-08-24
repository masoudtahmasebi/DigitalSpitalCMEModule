/**
 * Rendering a module's number and its title without saying the number twice.
 *
 * ## Why this is not trivial
 *
 * The layout numbers every module — "Modul 1 – Grundlagen" in the Inhalte list,
 * "Materialien zu Modul 1 (Grundlagen & Epidemiologie)" in the Mediathek — so
 * the widget prefixes the ordinal rather than trusting authors to type it.
 *
 * Authors type it anyway. The ADHS course's modules are titled
 * "Modul 1 – Grundlagen" in the seed, and the naive prefix produced
 * "Modul 1 – Modul 1 – Grundlagen" in the Inhalte list and
 * "Materialien zu Modul 1 Modul 1 – Grundlagen" in the Mediathek. Both shipped
 * and both were visible on the first screen a learner opens.
 *
 * Two functions rather than one because the two screens need opposite things:
 * the Inhalte list wants the number *added* when it is missing, and the
 * Mediathek — whose heading already says "Materialien zu Modul 1" — wants it
 * *removed* when it is present.
 *
 * Matching requires a digit after the word, never the word "Modul" alone, so a
 * module legitimately titled "Modulare Therapie" keeps its name intact.
 *
 * ## Any number, not only the matching one (P106-04)
 *
 * This used to test for the module's *own* ordinal, so a title numbered
 * differently from its position was treated as unnumbered and got a second
 * number in front of it. The client's own install:
 *
 * ```
 * Modul 2 – Modul 3 – Pharmako…
 * Modul 3 – Modul 2 – Diagnostik
 * Modul 4 – Modul 5 – Komorbidi…
 * ```
 *
 * — modules reordered in the console without their titles being retyped. The
 * old rule was written against the *agreeing* case ("Modul 1 – Grundlagen" in
 * position 1) and silently produced this for the disagreeing one.
 *
 * The position wins, because everything else on the screen already uses it:
 * the order of the list, the gate, the progress count. Two contradictory
 * numbers on one row is strictly worse than either alone — a physician cannot
 * act on it, and the one they read aloud is a coin toss.
 *
 * **This hides an authoring mistake, and that is not this file's to fix.**
 * A title whose number disagrees with its position is wrong wherever it is
 * shown; the place to say so is the console, to the person who can retype it,
 * not the learner's sidebar. Recorded in `docs/backlog/P106.md`.
 */

/** `^Modul <any number>` followed by a word boundary, case-insensitive. */
const NUMBERED = /^Modul\s*(\d+)\b/iu;

/** "Grundlagen" → "Modul 1 – Grundlagen"; a title already numbered 1 passes through. */
export function moduleHeading(ordinal: number, title: string): string {
  const trimmed = title.trim();
  const found = NUMBERED.exec(trimmed);

  if (found === null) return `Modul ${String(ordinal)} – ${trimmed}`;

  // Numbered, and it agrees with the position: the author's own wording stands,
  // separator and spacing included. Only a disagreement is rewritten, and it is
  // rewritten rather than prefixed — that is the whole of P106-04.
  if (Number(found[1]) === ordinal) return trimmed;

  return `Modul ${String(ordinal)} – ${moduleTopic(trimmed)}`;
}

/**
 * "Modul 1 – Grundlagen" → "Grundlagen", for a context that has already said
 * which module it means.
 *
 * Returns the title unchanged when stripping would leave nothing: a module
 * whose entire title is "Modul 3" has no topic to fall back to, and an empty
 * heading is worse than a repeated number.
 */
export function moduleTopic(title: string): string {
  const trimmed = title.trim();
  if (!NUMBERED.test(trimmed)) return trimmed;

  // Drop the number and whatever separator follows it — "–", "-", ":", "·".
  const stripped = trimmed
    .replace(NUMBERED, "")
    .replace(/^\s*[–—:·-]\s*/u, "")
    .trim();

  return stripped === "" ? trimmed : stripped;
}
