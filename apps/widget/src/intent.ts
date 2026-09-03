/**
 * Where opening a course from the catalogue lands (P168-04).
 *
 * It lives in its own module because it is shared by three layers that must not
 * import each other: the catalogue card that offers the choice, `App` that acts
 * on it, and `element.ts`, which accepts the same words as the `open-at`
 * attribute so a routing host can carry the choice across its own navigation.
 * Before there was a third value, the union was written out in five places; the
 * fourth will be a compiler error rather than a screen that quietly falls back
 * to the overview.
 *
 * - `start` — the course's own page: description, Referenten, Zertifizierung,
 *   the outline. What a physician sees when they open a course to look at it.
 * - `resume` — straight into the content the *server* says they left off at.
 * - `certify` — the Punktemeldung, for a course whose videos and
 *   Lernerfolgskontrolle are done and whose CME point is not yet claimed. It
 *   passes through the Evaluationsbogen first when that is outstanding, because
 *   the API refuses a completion without one and the refusal would otherwise
 *   arrive after the EFN had been typed.
 *
 * `certify` is a request, never a permission: `App` grants it only while the
 * server's own `courseComplete` holds and the completion is still open, so a
 * stale card or a hand-written `open-at="certify"` lands on the course page
 * rather than on a form that cannot be submitted (§9.2).
 */
export type OpenIntent = "start" | "resume" | "certify";
