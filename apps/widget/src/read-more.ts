/**
 * Where long prose is cut for its collapsed state (#63).
 *
 * ## Why this is a function and not a CSS class
 *
 * It was a CSS class — `line-clamp-4` — with the toggle underneath it, and that
 * had two faults the layout makes obvious.
 *
 * The layout draws _Mehr lesen…_ **inline, immediately after the last visible
 * word**, teal and bold. `line-clamp` clips the box; anything placed after the
 * text is clipped with it, and anything placed after the *paragraph* lands on a
 * line of its own. There is no arrangement of the two that puts a button at the
 * end of clipped text.
 *
 * The second fault is worse and is not about looks. `line-clamp` clips nothing
 * when the text is already short, so the toggle appeared on a two-line
 * description and clicking it changed the page in no way — a control that looks
 * implemented and does nothing, which is the failure this repository keeps
 * finding in its own work. A cut the component can *ask about* is what lets it
 * draw the toggle only when there is something behind it.
 *
 * ## What this costs, stated plainly
 *
 * Collapsed, the tail is not in the DOM, so find-in-page does not reach it and
 * a screen reader does not read past the cut. That is a real regression against
 * the CSS version and it is the reason the toggle carries `aria-expanded`: the
 * text is one activation away and its state is announced. The alternative was a
 * button in a place the layout does not draw it, that half the time did
 * nothing.
 *
 * ## Characters, not lines
 *
 * Lines are a rendering fact and this is not a renderer — it has no font, no
 * width and no hyphenation. The limits below are calibrated to the widget's own
 * column at desktop width and are deliberately approximate: being a line out on
 * an unusual viewport costs nothing, and asking the DOM for a measurement would
 * make every one of these tests need a browser.
 */

/** Roughly four lines of the description column. */
export const DESCRIPTION_LIMIT = 420;

/** Roughly three lines of the narrower biography column. */
export const BIOGRAPHY_LIMIT = 260;

export interface ReadMoreCut {
  /** What to show while collapsed. Equal to the input when nothing was cut. */
  readonly head: string;
  /** Whether anything was removed — and therefore whether to draw the toggle. */
  readonly truncated: boolean;
}

/**
 * Cut `text` at the last word boundary at or before `limit`.
 *
 * Never mid-word: a description ending "…und psychopharmakolog **Mehr lesen…**"
 * reads as a rendering fault rather than as a fold. When the first word is
 * itself longer than the limit there is no boundary to use and the cut is hard,
 * which is the one case where a hyphen-free URL in body text looks odd and is
 * still better than showing the whole thing.
 */
export function readMoreCut(text: string, limit: number): ReadMoreCut {
  const trimmed = text.trim();
  if (trimmed.length <= limit) return { head: trimmed, truncated: false };

  const window = trimmed.slice(0, limit + 1);
  const boundary = window.search(/\s\S*$/);

  const head = (boundary > 0 ? window.slice(0, boundary) : trimmed.slice(0, limit))
    // Trailing punctuation a sentence was cut before — a comma or an opening
    // bracket left hanging in front of the toggle reads as a typo.
    .replace(/[\s,;:(«„-]+$/, "");

  return { head, truncated: true };
}
