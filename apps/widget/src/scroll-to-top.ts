/**
 * A screen change puts the learner at the top of the page (DEP-36, P210-02).
 *
 * ## The report
 *
 * > Opening a course from the course list navigates to the course detail page
 * > with the scroll position in the middle of the page. The top of the page
 * > (course header/hero section) is not visible on load.
 *
 * The widget swaps its screen **in place**: `Routed` renders either the
 * catalogue or the course into the same element, and `Loaded` swaps the outline
 * for a player or an exam inside that. Nothing navigates in the browser's sense
 * — there is no document load and no anchor — so the host page keeps whatever
 * scroll offset the previous screen was left at. A physician who scrolled the
 * catalogue to find a course opens it and lands halfway down the hero.
 *
 * ## Why the whole window, and not the widget's own top
 *
 * `scrollIntoView` on the element would be gentler on a host page that puts
 * something above the embed. The ticket asks for the top of the page, the
 * platform's own portal *is* the widget, and on the customer's WordPress page
 * the module is the content of a page whose header a reader expects to see when
 * they arrive somewhere new — which is what every ordinary navigation does.
 *
 * So: the same thing a link would have done, which is also what the report asks
 * for in its own words.
 *
 * ## Never on the first render
 *
 * This is the half that a naive "scroll on mount" gets wrong. An embed can sit
 * anywhere on a customer's page, and yanking the reader to the top when the
 * widget merely *finishes loading* would be a defect of its own — one nobody
 * reported because the widget did not do it.
 *
 * So the first value of `key` is recorded and not acted on; only a change from
 * it scrolls.
 *
 * ## `smooth` is deliberately not used
 *
 * A smooth scroll of a long page takes hundreds of milliseconds during which
 * the new screen is already rendered, so the learner watches the old one slide
 * away. It also respects no reduced-motion preference unless asked. An instant
 * jump is what a page load does.
 */

import { useEffect, useRef } from "react";

/**
 * Scrolls to the top whenever `key` changes — but not for its first value.
 *
 * `key` is a string naming the screen. Anything that identifies "where the
 * learner is" works; what matters is that it is stable while they stay put, so
 * a re-render for any other reason does not move the page.
 */
export function useScrollToTopOnChange(key: string): void {
  const previous = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (previous.current === undefined) {
      previous.current = key;
      return;
    }
    if (previous.current === key) return;
    previous.current = key;

    /*
     * Guarded because jsdom does not implement `scrollTo` and a component test
     * that renders a screen change should not fail on a missing browser API —
     * the tests that care about this stub it and assert the call.
     */
    if (typeof window.scrollTo === "function") window.scrollTo({ top: 0, left: 0 });
  }, [key]);
}
