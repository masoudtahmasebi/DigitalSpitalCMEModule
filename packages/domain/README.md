# @ds/domain

The pure compliance core. **Everything that decides whether a physician earns a
CME point lives here**, and nothing else does.

## The rules this package obeys

Stated in `CLAUDE.md` §4 invariant 4, enforced by `src/purity.test.ts`:

- **Zero runtime dependencies.** The `dependencies` block is empty and a test
  asserts it stays empty.
- **Zero I/O.** No filesystem, no network, no database, no environment reads.
- **Zero ambient time.** `Date.now()` and `new Date()` with no argument are
  forbidden. Time is always a parameter, so every deadline test is
  deterministic.
- **Zero randomness.** `Math.random()` is forbidden.
- **Zero framework imports.** Nothing from NestJS, React or Drizzle.

## Why it is built this way

Most of the surrounding implementation is generated. That is only safe if the
part with legal weight is small, dependency-free and exhaustively tested — a
suite that runs in milliseconds with no infrastructure gets written and kept
green, and one that needs a database and a mocked clock does not.

The specific failure this guards against: `watchedPercent` computed as maximum
playback position rather than the union of watched intervals. That version passes
a casual review, works in a manual test, and lets any learner satisfy a 100 %
watch requirement by dragging the scrub bar to the end — which would make every
CME point this system has ever issued indefensible.

## Contents

| Module          | Responsibility                                                   |
| --------------- | ---------------------------------------------------------------- |
| `watch.ts`      | `mergeWatchedSegments`, `watchedPercent`, `maxContiguousWatched` |
| `gating.ts`     | `evaluateGate` — sequential unlock with machine-readable reasons |
| `progress.ts`   | `rollupProgress` — content → chapter → module → course           |
| `assessment.ts` | `scoreQuiz` — single choice and multi-choice exact-set           |
| `eiv.ts`        | `eivDeadlines` — 8-day reporting, 7-day correction window        |
| `completion.ts` | `isCourseComplete` — the four conditions                         |

## Testing

```bash
pnpm --filter @ds/domain test
```

No infrastructure required, by design.
