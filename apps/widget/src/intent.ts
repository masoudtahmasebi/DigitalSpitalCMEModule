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
 * - `certificate` — the Zertifizierung tab, where the Teilnahmebescheinigung is
 *   downloaded. It exists because the catalogue card added in P168-04 says
 *   "Abgeschlossen – Teilnahmebescheinigung verfügbar" and then offered no way
 *   to it: the client asked the obvious question, *"we have `Abgeschlossen –
 *   Teilnahmebescheinigung verfügbar` when course is done, where can one
 *   download it?"* Naming a document without a route to it is the same §9.4
 *   defect the sentence beside it was written to fix.
 *
 * `certify` and `certificate` are requests, never permissions: `App` grants
 * each only while the server says so — `courseComplete` with the point still
 * unclaimed for the first, a recorded completion for the second — so a stale
 * card or a hand-written `open-at=` lands on the course page rather than on a
 * form that cannot be submitted or a tab with nothing on it (§9.2).
 */
export type OpenIntent = "start" | "resume" | "certify" | "certificate";
