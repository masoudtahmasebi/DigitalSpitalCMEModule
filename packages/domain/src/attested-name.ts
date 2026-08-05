/**
 * The name a physician attests to, composed from the parts the layout captures.
 *
 * Layout page 13 asks for three fields — `Titel`, `Vorname`, `Nachname` — and
 * the platform reports **one** string: `enrolments.attested_name` is what the
 * Teilnahmebescheinigung prints and what the Punktemeldung sends. So there has
 * to be exactly one place that turns three into one, and this is it.
 *
 * ## Why that matters more than it looks
 *
 * A second composer would eventually disagree with the first about a space, and
 * the two artefacts a physician's CME record consists of — the certificate and
 * the report to their Kammer — would carry subtly different names. Nobody would
 * notice until an Ärztekammer could not match them. That is the same argument
 * as CLAUDE.md §4 invariant 6, applied to a string instead of a percentage.
 *
 * The database refuses the *state* where parts exist and no composed name does
 * (`enrolments_attested_name_present`, migration 0024). It deliberately does
 * not try to check the composition itself: SQL's idea of whitespace and this
 * function's would drift, and a constraint that is almost right is worse than
 * none.
 *
 * ## Why the title is optional and the names are not
 *
 * The layout marks all three with an asterisk, but its `Titel` select opens on
 * "Bitte Auswählen" and offers no empty-but-valid choice. Taken literally that
 * makes the form impossible to complete for a physician without a title, which
 * cannot be the intent. Both names are required; the title is not.
 *
 * Pure — no clock, no I/O, no framework (CLAUDE.md §4 invariant 4).
 */

/** The bound each part is stored under. A name, not a free-text field. */
export const NAME_PART_MAX_LENGTH = 100;

export interface AttestedNameParts {
  /** "Dr. med.", "Prof. Dr." — absent for a physician without one. */
  readonly title?: string | undefined;
  readonly givenName: string;
  readonly familyName: string;
}

export type AttestedNameProblem =
  | "given_name_missing"
  | "family_name_missing"
  | "given_name_too_long"
  | "family_name_too_long"
  | "title_too_long";

export type AttestedNameResult =
  | { readonly ok: true; readonly name: string; readonly parts: AttestedNameParts }
  | { readonly ok: false; readonly problems: readonly AttestedNameProblem[] };

/**
 * Collapse runs of whitespace and trim.
 *
 * Not cosmetic. A name pasted from a PDF carries non-breaking spaces and
 * sometimes a trailing newline, and the difference between `"Anna  Musterfrau"`
 * and `"Anna Musterfrau"` is invisible on screen and fatal to a string
 * comparison at the Ärztekammer. Normalising once, here, means the stored parts
 * and the stored composition were both derived from the same cleaned input.
 */
function normalise(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

/**
 * Compose, or say what is wrong with the parts.
 *
 * Returns every problem rather than the first, because the form shows three
 * fields at once and reporting them one at a time makes a physician submit
 * three times to learn three things.
 */
export function composeAttestedName(input: {
  readonly title?: string | null | undefined;
  readonly givenName: string | null | undefined;
  readonly familyName: string | null | undefined;
}): AttestedNameResult {
  const title = normalise(input.title ?? "");
  const givenName = normalise(input.givenName ?? "");
  const familyName = normalise(input.familyName ?? "");

  const problems: AttestedNameProblem[] = [];
  if (givenName === "") problems.push("given_name_missing");
  if (familyName === "") problems.push("family_name_missing");
  if (givenName.length > NAME_PART_MAX_LENGTH) problems.push("given_name_too_long");
  if (familyName.length > NAME_PART_MAX_LENGTH) problems.push("family_name_too_long");
  if (title.length > NAME_PART_MAX_LENGTH) problems.push("title_too_long");

  if (problems.length > 0) return { ok: false, problems };

  return {
    ok: true,
    // Title first, matching the Muster's "Titel, Vorname, Name" ordering on
    // the Anerkennungsbescheid's certificate template.
    name: [title, givenName, familyName].filter((part) => part !== "").join(" "),
    parts: {
      ...(title === "" ? {} : { title }),
      givenName,
      familyName,
    },
  };
}
