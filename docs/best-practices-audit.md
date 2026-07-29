# Best-practices audit — 28.07.2026

Reviewer: Claude Code. Scope: the whole repository, run alongside the security
audit (`docs/security-audit.md`).

Where the security audit asked "can this be exploited", this one asks "will the
next person be able to change this safely". Findings are ordered by that: dead
surface first, then duplication, then the one that turned out to matter most —
a lint warning that had been dismissed on reasoning that had since expired.

**Eight findings. All fixed.** B-07 came out of the layout alignment pass
(P5-11) and B-08 out of the player work (P5-12) — both surfaced while building
something else, which is where this kind of thing surfaces.

---

## Findings

### B-01 · An accessibility gap dismissed on reasoning that had expired

**Found by:** asking why the repository's one remaining lint warning was still
there.

`jsx-a11y/media-has-caption` had warned on the video player since the widget was
written, with a comment explaining that a `<track>` was owed but the schema had
no caption field "in this budget". That was true when the admin console could
not author content at all and every course was seeded by hand. It stopped being
true when P9-04 shipped — and nothing re-examined it, because a warning that has
always been there reads as furniture.

The gap is not cosmetic. **WCAG 2.2 success criterion 1.2.2 (Captions,
Prerecorded) is Level A** — the floor, not an enhancement — and EN 301 549 makes
it the reference standard in Germany. This is professional education a physician
is _required_ to complete: one who cannot hear the video cannot earn the points,
and the watch gate faithfully records that they did not.

_Fixed_ end to end: `contents.captions_url` (migration 0015), through the
authoring DTO, contract, SDK, console form and the learner's lesson payload, to
a `<track kind="captions" default>` in the player. The caption URL is signed with
the same lifetime as the video — a track that expired first would leave a
hard-of-hearing learner watching an uncaptioned recording, which is precisely
the failure it exists to prevent.

Three sub-decisions worth recording:

- **Not enforced.** A slide-only recording with no speech legitimately has no
  captions, and neither the form nor the server can tell it from a lecture. The
  console shows a warning saying what is owed and why; blocking the save would
  refuse valid content, and saying nothing would let an author not know.
- **The `<track>` is conditional.** An empty `<track>` with no `src` is worse
  than none: the player offers a captions control that produces nothing, which
  reads as broken captions rather than absent ones.
- **The remaining `eslint-disable` is honest now.** `jsx-a11y` only recognises a
  static child and cannot see a conditional, so it warns about markup that is
  present. One line, with the note that the day the `<track>` is deleted the
  next reviewer finds a disable with no corresponding element.

_Verify:_ the round trip is asserted in `authoring.integration.test.ts` — an
author supplies a `.vtt`, and the learner's lesson payload carries it.

`pnpm lint` is now clean for the first time.

### B-02 · Silent wrong-date fallbacks in the deadline arithmetic

**Found by:** `berlin.ts` sitting at 57 % branch coverage while the rest of
`packages/domain` was at 96 %, and asking what the uncovered branches were.

`readParts` ended in `parsed["year"] ?? 0`, `parsed["month"] ?? 1`,
`parsed["day"] ?? 1`. Unreachable with the options the formatter is built with —
but the _shape_ was wrong for this module. A missing part would have produced
the 1st of January in the year 0 and carried it into an 8-day statutory
reporting deadline, silently. Nobody would have seen a wrong date; they would
have seen a rejected Punktemeldung weeks later, past a window that cannot be
reopened.

_Fixed_ by refusing instead: `BerlinFormatError`, its own class so a caller can
tell "the platform's timezone data is broken" from an ordinary validation
failure. The alternative to a loud failure here is a quiet wrong answer about a
legal deadline.

### B-03 · The deadline arithmetic was tested only indirectly

**Found by:** the same coverage question. `berlin.test.ts` covered the three
_presentation_ helpers and nothing else.

`berlinDateOf`, `addCalendarDays` and `endOfBerlinDay` were exercised only
through `eivDeadlines`. That is the wrong altitude for them: they decide which
calendar day a statutory window closes on, and the ways to be wrong by a day are
a DST transition and a month boundary — neither of which a test written _about
deadlines_ naturally reaches for.

_Fixed_ with fifteen direct tests: both DST transitions (the 23-hour day in
March and the 25-hour day in October), month, year and leap-year boundaries,
millisecond precision, and a round trip asserting that the end of a Berlin day
is still that Berlin day. All passed first time, which is the good outcome —
the code was right and is now pinned.

### B-04 · Four dead exports

**Found by:** a script listing every export referenced neither elsewhere nor
within its own file.

Only four survived the false positives: `statusFor` (superseded by the
problem-details filter), `resetPluginsForTesting` and `isConflict` (both written
the same day and never called), and `isRateLimited`.

_Fixed_ by deleting all four. A dead export is a claim that something is API
surface when nothing uses it, and it is the kind of claim that has to keep
working. Where the removal is likely to be re-proposed, a comment says why it
went — `plugins.ts` records that a test wanting a different plugin set builds
its own registry, which is what a mutable escape hatch on a _sealed_ singleton
would have undermined.

### B-05 · Ten copies of two error-rendering blocks

**Found by:** a normalised duplicate-block scan across the repository.

The authoring console rendered the same load-failure block in four editors and
the same save-error ternary in six places — all written the same day, all
identical.

_Fixed_ with `<LoadFailure>` and `<SaveProblem>` in `ui.tsx`. Four copies of a
retry button is four places it can go missing, and a load failure with no way
out is the one error state a user cannot work around.

### B-06 · nodemailer's version range

Recorded here as well as in the security audit (S-03) because the _practice_
failure is a best-practices one: the dependency range was written from memory
rather than from the registry, and admitted a version with six known
advisories. `pnpm add <pkg>@latest`, then narrow.

### B-07 · Two implementations of one approved layout

**Found by:** developing against the layout rather than against the requirements
prose, and reading the two catalogue screens side by side.

`apps/portal` had a catalogue of its own — a second React screen calling the same
`GET /courses` and rendering the same approved layout §4.1. It had already
drifted from the widget's: chips where the layout specifies dropdowns with
removable tag chips, and page-at-a-time navigation where the layout specifies
numbered pagination. Only one of the two had tests, and it was not this one.

The duplication was not the deepest problem. ADR-0007 defines the portal as a
_host adapter_ — mount the widget, supply a token — and a hand-written screen
was the one place it stopped being one. The ADR's whole value is that a second
host proves the core is headless; a second host that reimplements part of the
product proves less than it appears to.

_Fixed_ by giving the widget the one thing it was missing: a cancelable
`ds-lms:course-open` event, so a host that owns URLs can say "I am routing"
(ADR-0007 Contract 3). The portal now mounts the widget for the catalogue too.
Deleted: `Catalogue.tsx`, `CourseMount.tsx`, `api.ts`, and two thirds of the
portal's locale file. **The portal now makes no API call of its own.**

Worth noting against B-05 and the duplication findings generally: this one was
invisible to a duplicate-block scan, because the two screens shared no lines.
They shared a _design_. That is the kind of duplication only reading finds.

### B-08 · A flaky test that was reporting a real defect

**Found by:** a certificate-renderer test failing once in a full run and passing
on three reruns — the shape of thing usually written off as flakiness.

`renderCertificatePdf` was asserted to be deterministic by rendering twice and
comparing bytes. It was **not** deterministic: pdf-lib stamps `ModDate` with the
wall clock at save time, and only `CreationDate` was pinned to `completedAt`. Two
renders in the same second are identical, so the assertion passed almost always
and failed exactly when the pair straddled a tick.

The consequence is small but real, and it is on a compliance document: two
downloads of the same certificate differed in metadata for no reason — a
physician filing one copy and their Ärztekammer receiving another.

_Confirmed_ before fixing, rather than assumed. A bare pdf-lib document with only
`CreationDate` set was rendered 200 times: identical through render 5, different
from render 6 on — one clock tick. Pinning `ModDate` made 400 renders identical.

_Fixed_ with `pdf.setModificationDate(data.completedAt)`.

**The second half of this finding is about the test.** The first replacement
rendered 200 times so it would reliably cross a second — which worked in
isolation and **timed out** under a parallel run, trading one flake for another.
The test now moves the system clock between two renders and asserts the bytes are
unchanged. That states the property directly — _the output does not depend on the
clock_ — in two renders and 55 ms, and it fails when the fix is removed.

The general lesson is worth keeping: a test that fails one run in twenty is
either testing something real intermittently or testing nothing reliably, and
both are worth the twenty minutes to tell apart.

---

## Reviewed and found sound

| Area                         | Finding                                                                                                                                                                                                          |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Layering**                 | ADR-0006's boundaries are enforced by `no-restricted-imports` scoped by `files` globs, not by review. Controllers make no decisions; repositories issue no policy.                                               |
| **Contract drift**           | The DTO/SDK parity test compares every request and response shape at compile time, in both directions. It has caught real mistakes — 3.0 `nullable` syntax in a 3.1 document, a field nested in the wrong block. |
| **`packages/domain` purity** | No I/O, no clock, no framework import, no randomness. Time is an argument everywhere. 97 % statements, 100 % functions.                                                                                          |
| **Test altitude**            | Compliance logic is unit-tested exhaustively; tenant isolation and the two queue workers are tested against a real Postgres, never mocks.                                                                        |
| **German copy**              | In locale files, not inline, in all three frontends. `germanDuration` moved to `@ds/domain` when a second app needed it rather than being copied.                                                                |
| **File headers**             | Say why the file exists and what would go wrong without it, per CLAUDE.md §8 — not what the code below does.                                                                                                     |
| **Migrations**               | Ordered, forward-only, each explaining the failure it prevents. Three now carry a reproduction of the bug they fix.                                                                                              |

## Deliberately not changed

**`apps/admin/src/config.ts` and `apps/portal/src/config.ts` are near-identical**
(five `VITE_*` variables and a completeness check), as are their
`vite-env.d.ts`. Extracting them would mean a package, or coupling config
reading to `@ds/oidc`, for about forty lines — and the two are each app's own
contract with its own deployment, which is exactly the kind of thing that should
be free to diverge. Named here rather than silently skipped, because "we
considered it" and "we did not notice" look identical in a diff.

**The `enrolments` seed shape is repeated across integration suites.** Each
suite seeds its own tenant deliberately: a shared fixture would couple suites
that currently cannot interfere with each other, and two of them already had to
be rewritten once for reading state another suite had left behind.
