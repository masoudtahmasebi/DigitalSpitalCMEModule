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
 * Matching is on the specific ordinal, never on the word "Modul" alone, so a
 * module legitimately titled "Modulare Therapie" keeps its name intact.
 */

/** `^Modul 3` followed by a word boundary, case-insensitive. */
function numberedWith(ordinal: number): RegExp {
  return new RegExp(`^Modul\\s*${String(ordinal)}\\b`, "i");
}

/** "Grundlagen" → "Modul 1 – Grundlagen"; already-numbered titles pass through. */
export function moduleHeading(ordinal: number, title: string): string {
  const trimmed = title.trim();
  return numberedWith(ordinal).test(trimmed)
    ? trimmed
    : `Modul ${String(ordinal)} – ${trimmed}`;
}

/**
 * "Modul 1 – Grundlagen" → "Grundlagen", for a context that has already said
 * which module it means.
 *
 * Returns the title unchanged when stripping would leave nothing: a module
 * whose entire title is "Modul 3" has no topic to fall back to, and an empty
 * heading is worse than a repeated number.
 */
export function moduleTopic(ordinal: number, title: string): string {
  const trimmed = title.trim();
  if (!numberedWith(ordinal).test(trimmed)) return trimmed;

  // Drop the ordinal and whatever separator follows it — "–", "-", ":", "·".
  const stripped = trimmed
    .replace(numberedWith(ordinal), "")
    .replace(/^\s*[–—:·-]\s*/, "")
    .trim();

  return stripped === "" ? trimmed : stripped;
}
