/**
 * The one content column every learner screen is measured against (P190-01).
 *
 * ## Why this exists
 *
 * The layout draws every screen of the CME module on the same grid: a band
 * that bleeds to the edges of the page, and everything readable inside a
 * column centred in it. Measured off the 1920 px exports, that column is
 * **1398 px** and its gutters are 261 px — the catalogue's filter panel, the
 * course-detail meta strip and the player's white panel all begin at x = 261
 * and end at x = 1659, on all twelve pages.
 *
 * Before this file the three screens disagreed. The catalogue had its own
 * `max-w-[1082px]`, the course detail had none at all, and `CourseShell` had
 * none either — so the player and the exam ran the full width of whatever the
 * host page gave them, which on MEDICE's site is the viewport. Three readings
 * of one measurement is the shape §9.11 names: the fix belongs in one place
 * that all three import, not in three corrected numbers.
 *
 * ## Why the max-width is 1430 and not 1398
 *
 * `px-4` is inside the box. 1430 − 2 × 16 = 1398, so at any width from 1430 px
 * up the readable column is exactly the drawing's, and below it the padding
 * keeps the text off the edge of a phone rather than the column suddenly
 * losing its gutter. Writing 1398 here and dropping the padding would be right
 * at 1920 and wrong at 1400.
 *
 * ## Why the widget owns it rather than the host theme
 *
 * The hero, the course artwork and the player's teal band all bleed past this
 * column, and a WordPress container would clip them. The widget is given the
 * full width and insets its own content — which also means the bleed and the
 * inset agree about where the left edge is, which is the only way the hero's
 * heading can line up with the panel beneath it.
 */

/** The column itself, without padding — for anything that supplies its own. */
export const CONTENT_WIDTH = "w-full max-w-[1430px]";

/** The column as a screen uses it: centred, with the narrow-viewport gutter. */
export const CONTENT = `mx-auto ${CONTENT_WIDTH} px-4`;

/**
 * The two-column split the layout draws on the course detail and the player.
 *
 * Measured on the course detail: 1070 px of content, a 43 px gap and a 283 px
 * aside, which sums to the 1398 above. `18rem` (288 px) is the nearest Tailwind
 * width and `gap-10` (40 px) the nearest gap; the pair leaves the main column at
 * 1070 px exactly, which is the number that matters because it is what the body
 * copy wraps against.
 *
 * The **player** does not use this. Its grid sits inside a panel with 24 px of
 * its own padding and DEP-24 derived its own pair from the same drawings —
 * `gap-6` and `20rem`, against a sidebar measured at 304 px there and 313 px
 * here. Two readings of one measurement is what this file exists to prevent, so
 * the difference is worth naming: DEP-24 rounded up to a Tailwind step and this
 * one lands on the drawing exactly, and they are 8 px apart. Neither is worth
 * changing the other for; what matters is that both now sit on the same column.
 *
 * `minmax(0,1fr)` and not `1fr`: a grid track's default minimum is `auto`, so a
 * long unbreakable German compound in the body would widen the column past the
 * container instead of wrapping — which is the same defect the hero heading's
 * `break-words` exists for, one level up.
 */
export const MAIN_ASIDE = "grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_18rem]";
