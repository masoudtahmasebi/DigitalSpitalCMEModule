# ADR-0011 — The video player is ours, not a library

- **Status:** Accepted
- **Date:** 2026-07-29
- **Ticket:** P5-12
- **Deciders:** Masoud Tahmasebi

## Context

The learner widget played video through a bare `<video controls>`. That is the
right first version and it stopped being enough for three separate reasons, only
one of which is cosmetic.

**The scrub bar has nothing to say.** Watch credit is the union of intervals
actually played (`CLAUDE.md` §4 invariant 5). A native control bar shows a
playhead and a buffer, and neither of those is what the CME gate counts — so a
learner at "80 % angesehen" has no way to see _which_ eighty per cent, or where
the hole is that is keeping them below the threshold. The one number that
decides whether they earn their points is unlocatable on the one control that
could show it.

**A single file is a single bitrate.** `contents.video_url` held one URL. A
physician on a hospital connection either buffers through a 25-minute lecture or
downloads a needlessly large file. That is not merely uncomfortable: the gate
credits what was played, so a learner who gives up on a stalling video has the
shortfall recorded against their participation.

**Native controls are not ours to label.** They are rendered by the browser in
the browser's language with the browser's shortcuts. German copy is contractual
here (`CLAUDE.md` §5), and the accessibility floor is not a preference — a
physician using a screen reader who cannot operate the player cannot complete a
course they are professionally required to complete.

The obvious answer to all three is a player library — video.js, Plyr, Vidstack,
Shaka.

## Decision

**The player is written in-house, against the platform's own `<video>` element.
No third-party player is bundled.**

`apps/widget/src/components/VideoPlayer.tsx` renders the element with its native
controls off and supplies play/pause, a three-layer scrub bar, volume, playback
rate, captions, Picture-in-Picture, fullscreen and keyboard control. The
arithmetic behind it — coverage bars, seek geometry, remaining time, rate
cycling — lives in `packages/domain/src/playback.ts`, pure and unit-tested.

Format negotiation is the **browser's**, not ours: sources are rendered as
ordered `<source>` children and the browser takes the first `type` it can play.
`orderSources` puts adaptive streams first, so Safari gets HLS natively and
everything else falls through to the progressive file. There is no user-agent
detection anywhere in the widget.

## Rationale

**The watch gate is the product, and a library would own its inputs.** Every
credited second comes from `timeupdate` on the element. A player library sits
between that element and our tracker, and its release notes are then release
notes for a compliance input: a change to how it throttles events, restores
position after a seek, or handles a rate change is a change to what a physician
is credited for. `WatchTracker` is deliberately small and testable for exactly
this reason, and putting a general-purpose abstraction upstream of it would undo
that.

**The feature that motivated this is one no library has.** Shading _which_
passages the server has credited, drawn from `watchedSegments` the API returns,
is specific to a platform with a union-coverage gate. Every library would need
the same custom layer over its own bar — so the library would be carrying the
parts we do not need in order to not carry the part we do.

**ADR-0009 already rules out the delivery mechanism most of them assume.** No
third-party frontend assets: nothing may be fetched from a CDN at runtime
(a Google-Fonts judgment, LG München I 3 O 17493/20, applies the same reasoning
to any third-party origin a learner's browser is made to contact). A player
would therefore be bundled, and bundle size is not free — the widget is injected
into a customer's WordPress page, where it is a guest.

**The remaining scope was small.** What a custom player actually costs is a
control bar, a slider with correct ARIA, and keyboard handling. The parts that
are genuinely hard — decoding, adaptive bitrate switching, fullscreen, PiP,
captions rendering — are the browser's, and are reached through one-line APIs
that a library would wrap rather than replace.

**We do not need MSE.** The one thing only a library provides is HLS or DASH on
browsers without native support, via Media Source Extensions. That matters when
adaptive streaming is _required_; here it is an optimisation over a progressive
fallback that every browser plays. Safari gets HLS natively; Chrome and Firefox
get MP4. Nobody is locked out.

## Consequences

**Positive**

- Every input to the watch gate is code we own and test.
- The scrub bar can show credited coverage, which is the number the learner
  actually needs and which no library exposes a place for.
- German labels and the keyboard map are ours; the a11y floor is enforced by
  our own tests rather than by a dependency's changelog.
- No runtime third-party origin, and no library in the bundle a customer's page
  has to load.
- Multiple renditions with no detection code: the ordering _is_ the negotiation.

**Negative**

- **Browser bugs are now ours.** A quirk in Safari's fullscreen or Firefox's
  `textTracks` is a fix here, not an upgrade. Accepted: the surface is small and
  the alternative trades these for the library's own quirks.
- **No adaptive streaming on Chrome or Firefox.** They fall back to progressive,
  so a learner on a poor connection gets a fixed bitrate. Revisit if the
  fallback proves inadequate in practice — see below.
- **More code to maintain**, including a hand-rolled `role="slider"` whose ARIA
  contract must stay correct. Mitigated by tests that assert the contract
  rather than the pixels.

**If the no-MSE decision has to be revisited**, the seam is already the right
shape: `hasAdaptiveSource` identifies a stream the browser cannot play natively,
and attaching hls.js at that point touches one component and no compliance code.
That is a deliberate property of this design, not an accident.

## Alternatives considered

**video.js.** The mature option, and the one with the plugin ecosystem. Rejected
on the compliance-input argument above, plus roughly 150 kB gzipped into a
bundle already injected into somebody else's page — for a control bar we would
then restyle and relabel entirely.

**Plyr or Vidstack.** Lighter and better-looking, and both would have to be
extended with the coverage overlay anyway. The remaining benefit is the control
bar's appearance, which the layout specifies for us regardless.

**Shaka Player.** Genuinely better at adaptive streaming, and that is its whole
point. Rejected because MSE-based playback is precisely the thing this platform
does not need: the progressive fallback is not a degraded experience, it is the
normal one everywhere except Safari, which has HLS natively.

**Keep `<video controls>` and add a coverage bar beside it.** Two scrub bars —
the browser's and ours — with the playhead on one and the credited coverage on
the other, a few pixels apart. Rejected as the worst of both: the learner has to
mentally align two timelines that mean different things.
