/**
 * Prose with an inline _Mehr lesen…_ fold (#63).
 *
 * ## Why this is one component and not two
 *
 * It was two: the Übersicht tab's description and the Experten tab's biography
 * each had their own `useState`, their own `line-clamp` and their own button,
 * and the design review recorded the same defect against both rows (2.5 and
 * 3.2). Two copies of a control is two places to fix a control, and the second
 * one is always the one that gets missed.
 *
 * ## What the layout draws
 *
 * The toggle is **inline, immediately after the last visible word**, teal and
 * bold, with no underline and no line of its own. `read-more.ts` explains why
 * that means cutting the string rather than clipping the box, and what that
 * costs.
 *
 * ## Why the toggle is a button and not a link
 *
 * It goes nowhere. A learner using a screen reader is told "link" by an anchor
 * and then arrives at the same page having lost their place; `aria-expanded` on
 * a button says what actually happens.
 */

import { useState } from "react";
import { de } from "../locale/de.js";
import { readMoreCut } from "../read-more.js";

export function ReadMore(props: {
  text: string;
  /** One of the limits in `read-more.ts`, chosen by the column's width. */
  limit: number;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const cut = readMoreCut(props.text, props.limit);

  return (
    // `whitespace-pre-line` preserves the author's paragraph breaks and never
    // interprets the content as markup — the field is plain text and stays
    // plain text.
    <p className={props.className ?? "whitespace-pre-line text-sm text-gray-800"}>
      {expanded ? props.text : cut.head}
      {cut.truncated ? (
        <>
          {" "}
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => {
              setExpanded(!expanded);
            }}
            className="font-bold text-brand-600 hover:text-brand-700"
          >
            {expanded ? de.overviewTab.less : de.overviewTab.more}
          </button>
        </>
      ) : null}
    </p>
  );
}
