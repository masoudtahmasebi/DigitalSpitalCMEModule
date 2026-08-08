/**
 * The video player (P5-12).
 *
 * ## Why this is ours rather than a library
 *
 * ADR-0011. The short version: the watch gate is the product. A third-party
 * player would own the events the CME credit is derived from, and every
 * upgrade would be an upgrade to a compliance input. What we need beyond a bare
 * `<video controls>` is a coverage overlay on the scrub bar, German labels on
 * every control, and playback rate capped where the server will still credit
 * it — none of which a general-purpose player does, and all of which are
 * ordinary DOM work.
 *
 * ## What decides what
 *
 * | Concern | Owner |
 * | --- | --- |
 * | Which rendition plays | the **browser** — `<source>` order, no detection code |
 * | Position, volume, rate, fullscreen | the **element**, read back through events |
 * | Which passages count as watched | the **server**, via `watchedSegments` |
 * | How far forward it may seek | the **server**, via `seekCeilingSec` |
 * | Whether the video is complete | the **server** — never inferred here |
 *
 * The last three are the ones that matter. This component never accumulates its
 * own coverage: the bar it draws is the server's merged union, redrawn from
 * every `recordProgress` response. An optimistic local bar would show credit
 * for segments the server rejected as implausible, which is precisely the
 * disagreement `CLAUDE.md` §4 invariant 6 exists to prevent.
 *
 * ## Forward seeking stops at what has been watched
 *
 * The accreditation requires the material to have been *seen*, so the scrub bar
 * will not go past `seekCeilingSec` — every seek path here routes through one
 * clamp, and the bar shades the locked remainder rather than silently refusing,
 * because a control that ignores you reads as broken.
 *
 * The clamp is a courtesy, not the gate. Nothing in a browser can be trusted to
 * enforce a compliance rule: the real defence is that coverage is the union of
 * intervals validated server-side against the wall clock, so a skipped passage
 * simply leaves a hole the percentage never fills. If this clamp were removed
 * tomorrow, no learner would gain a point they had not earned — they would only
 * gain a worse explanation of why their percentage was stuck.
 *
 * Backwards is unrestricted. Re-watching is legitimate and free: a union counts
 * each second once however often it is played.
 *
 * ## The element is the state
 *
 * Position, volume, muted, rate and buffered are read *from* the media element
 * on its own events rather than mirrored in React state and pushed down. A
 * mirror is a second source of truth for something the user can change through
 * five paths the component does not control — the native context menu, media
 * keys, Bluetooth headphones, Picture-in-Picture, the OS volume mixer — and it
 * drifts within seconds of any of them being used.
 *
 * `paused` is the one exception, and it is deliberate: the layout puts a
 * **Fortbildung pausieren** control outside the player (§4.3), so pause is a
 * prop, and `onPlayback` reports the element's real state back so the two can
 * never contradict each other.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  bufferedBars,
  clampSeekToLimit,
  clampVolume,
  clockTime,
  coverageBars,
  nextPlaybackRate,
  nudgePositionSec,
  playerSeekLimit,
  positionFraction,
  remainingSec,
  SEEK_JUMP_SEC,
  SEEK_STEP_SEC,
  seekFraction,
  seekPositionSec,
  VOLUME_STEP,
  type WatchedSegment,
} from "@ds/domain";
import type { MediaSource } from "@ds/sdk";
import { de } from "../locale/de.js";

/** What the surrounding chrome is told, on every change worth showing. */
export interface PlaybackState {
  readonly positionSec: number;
  readonly durationSec: number;
  readonly playing: boolean;
  readonly buffering: boolean;
  readonly muted: boolean;
  readonly volume: number;
  readonly rate: number;
  readonly ended: boolean;
}

export interface VideoPlayerProps {
  readonly sources: readonly MediaSource[];
  readonly posterUrl: string | null;
  readonly captionsUrl: string | null;
  readonly title: string;
  /** The authored length the watch gate is computed against. */
  readonly durationSec: number | null;
  /** Where playback starts — the server's `resumeAtSec`, never computed here. */
  readonly startAtSec: number;
  /**
   * The furthest second forward seeking is allowed to reach, from the server.
   *
   * `null` lifts the restriction entirely, which is what a lesson outside the
   * watch gate wants. It is not a fallback for a value that failed to arrive:
   * see `clampSeekToLimit` for why unrestricted is the right direction to fail
   * in when the field is missing.
   */
  readonly seekCeilingSec: number | null;
  /** The server's merged union — what the coverage bar draws. */
  readonly watchedSegments: readonly WatchedSegment[];
  /** Set by the chrome's **Fortbildung pausieren**. */
  readonly paused: boolean;
  readonly onPlayback: (state: PlaybackState) => void;
  /** Fired on `timeupdate` while playing, for the watch tracker. */
  readonly onTick: (positionSec: number, playing: boolean) => void;
  /** Playback stopped for any reason — pause, seek, ended, unmount. */
  readonly onStop: (reason: "pause" | "seek" | "ended") => void;
}

type MediaFailure = "unsupported" | "network" | "decode" | "aborted";

/*
 * `MediaError`'s codes, as literals.
 *
 * Not `MediaError.MEDIA_ERR_NETWORK`: that reads a **global constructor**, and
 * a global that is absent throws — inside an error handler, where the throw
 * replaces the message the learner needed with nothing at all. The values are
 * fixed by the HTML specification and cannot change; the global's presence is
 * an environment detail. Found by the player's own test suite, where jsdom
 * does not define it.
 */
const MEDIA_ERR_ABORTED = 1;
const MEDIA_ERR_NETWORK = 2;
const MEDIA_ERR_DECODE = 3;

export function VideoPlayer(props: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [failure, setFailure] = useState<MediaFailure | undefined>();
  const [captionsOn, setCaptionsOn] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [reloads, setReloads] = useState(0);

  // Read off the element, never mirrored: the user can change any of these
  // through paths this component does not see.
  const [state, setState] = useState<PlaybackState>({
    positionSec: props.startAtSec,
    durationSec: props.durationSec ?? Number.NaN,
    playing: false,
    buffering: false,
    muted: false,
    volume: 1,
    rate: 1,
    ended: false,
  });
  const [buffered, setBuffered] = useState<ReadonlyArray<readonly [number, number]>>([]);

  const { onPlayback, onTick, onStop } = props;

  /**
   * The length everything is measured against.
   *
   * The **authored** figure wins over the element's own. The server computes
   * the watch percentage from the authored length, so a re-encode that made the
   * file a second longer would otherwise put "25:46" beside a percentage
   * computed against 25:45 — two numbers about the same video that do not
   * agree.
   */
  const duration =
    props.durationSec !== null && props.durationSec > 0
      ? props.durationSec
      : state.durationSec;

  /**
   * The furthest second this session has reached by ordinary playback.
   *
   * `seekCeilingSec` is only as fresh as the last progress flush — fifteen
   * seconds — so enforcing it alone would yank a playing video backwards the
   * moment the playhead passed the last flushed second. Advanced only from
   * `timeupdate` while genuinely playing: advancing it on a seek would let the
   * limit raise itself.
   *
   * A ref and state for the same number, deliberately. The ref is what the
   * handlers clamp against, so a seek fired between renders uses the current
   * value rather than the one captured in a stale closure; the state is what
   * the bar draws, updated on the whole second like every other reading.
   */
  //
  // It starts at the resume point rather than at zero, which is safe because
  // the server caps `resumeAtSec` at the ceiling it sends alongside it: the
  // position playback opens at is a position seeking is allowed to reach, or
  // the video would refuse to start where it was just told to.
  const reachedRef = useRef(props.startAtSec);
  const [reachedSec, setReachedSec] = useState(props.startAtSec);

  // A different lesson in the same mounted player starts its own session.
  useEffect(() => {
    reachedRef.current = props.startAtSec;
    setReachedSec(props.startAtSec);
  }, [props.startAtSec, props.seekCeilingSec]);

  /**
   * The limit as the *bar* sees it, which lags a second behind the handlers.
   *
   * That is the right way round: a bar drawn from the throttled reading and a
   * clamp applied from the live one can only ever disagree by showing slightly
   * less freedom than the learner actually has, never more.
   */
  const seekLimit = playerSeekLimit(props.seekCeilingSec, reachedSec);

  /** The limit as the *handlers* see it — the live value, at the moment of the seek. */
  const seekLimitNow = () => playerSeekLimit(props.seekCeilingSec, reachedRef.current);

  const publish = useCallback(
    (video: HTMLVideoElement, patch: Partial<PlaybackState> = {}) => {
      const next: PlaybackState = {
        positionSec: video.currentTime,
        durationSec: video.duration,
        playing: !video.paused && !video.ended,
        buffering: video.readyState < video.HAVE_FUTURE_DATA && !video.paused,
        muted: video.muted,
        volume: video.volume,
        rate: video.playbackRate,
        ended: video.ended,
        ...patch,
      };
      setState(next);
      onPlayback(next);
    },
    [onPlayback],
  );

  // Resume where they left off. Applied on `loadedmetadata` rather than in an
  // effect on mount: setting `currentTime` before the element knows its own
  // duration is silently discarded by every browser.
  const startAtRef = useRef(props.startAtSec);
  startAtRef.current = props.startAtSec;

  const handleLoadedMetadata = () => {
    const video = videoRef.current;
    if (video === null) return;
    setFailure(undefined);
    if (startAtRef.current > 0 && video.currentTime === 0) {
      video.currentTime = Math.min(
        startAtRef.current,
        video.duration || startAtRef.current,
      );
    }
    publish(video);
  };

  // The chrome's pause button. Only ever pauses — a widget that started a video
  // by itself would be doing something the learner did not ask for on somebody
  // else's page, and browsers refuse an unprompted `play()` anyway.
  useEffect(() => {
    if (props.paused) videoRef.current?.pause();
  }, [props.paused]);

  // Captions follow the toggle. The `<track>`'s own mode is the authority a
  // browser reads, and `default` only sets the initial value — so a toggle that
  // did not write `mode` would move the button without moving the captions.
  useEffect(() => {
    const video = videoRef.current;
    if (video === null) return;
    for (const track of Array.from(video.textTracks)) {
      track.mode = captionsOn ? "showing" : "disabled";
    }
  }, [captionsOn, props.captionsUrl, reloads]);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement !== null);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // `timeupdate` fires ~4×/s. The tracker wants every one of them — a coarser
  // sample would widen the gaps it has to treat as seeks — but the controls
  // only re-render on the whole second, so the two are decoupled here.
  const lastSecond = useRef(-1);
  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (video === null) return;

    const playing = !video.paused && !video.seeking;
    onTick(video.currentTime, playing);

    // Playback is the only thing that raises the limit. Not a seek: a limit a
    // seek could raise would be no limit at all.
    if (playing && video.currentTime > reachedRef.current) {
      reachedRef.current = video.currentTime;
    }

    const second = Math.floor(video.currentTime);
    if (second === lastSecond.current) return;
    lastSecond.current = second;
    setReachedSec(reachedRef.current);
    publish(video);
  };

  const handleProgress = () => {
    const video = videoRef.current;
    if (video === null) return;
    const ranges: Array<readonly [number, number]> = [];
    for (let i = 0; i < video.buffered.length; i += 1) {
      ranges.push([video.buffered.start(i), video.buffered.end(i)]);
    }
    setBuffered(ranges);
  };

  const handleError = () => {
    const video = videoRef.current;
    const code = video?.error?.code;
    setFailure(
      code === MEDIA_ERR_NETWORK
        ? "network"
        : code === MEDIA_ERR_DECODE
          ? "decode"
          : code === MEDIA_ERR_ABORTED
            ? "aborted"
            : // SRC_NOT_SUPPORTED, and the default: every `<source>` was
              // skipped or refused. From the learner's side these are the same
              // situation — nothing here can play this.
              "unsupported",
    );
  };

  function withVideo(action: (video: HTMLVideoElement) => void): void {
    const video = videoRef.current;
    if (video === null) return;
    action(video);
    publish(video);
  }

  const togglePlay = () =>
    withVideo((video) => {
      if (video.paused) void video.play().catch(() => setFailure("aborted"));
      else video.pause();
    });

  /**
   * The single seek path. Every control that moves the playhead goes through
   * here — the scrub bar, the arrow keys, J/L, the digit shortcuts — so the
   * clamp cannot be forgotten by one of them.
   */
  const seekTo = (positionSec: number) =>
    withVideo((video) => {
      video.currentTime = clampSeekToLimit(positionSec, seekLimitNow());
    });

  /**
   * The last line of defence, on the element's own `seeking` event.
   *
   * Everything above routes through `seekTo`, but the element can also be moved
   * by things this component does not own: the Picture-in-Picture window's own
   * scrub bar, media-session hardware keys, and the browser's native controls in
   * fullscreen on iOS. Snapping back here catches all of them, and costs
   * nothing when the position was already legal.
   */
  const enforceSeekLimit = () => {
    const video = videoRef.current;
    if (video === null) return;
    const allowed = clampSeekToLimit(video.currentTime, seekLimitNow());
    // A second's grace: `currentTime` lands on a keyframe rather than exactly
    // where it was set, and snapping back over a rounding difference would make
    // the playhead stutter for a learner who did nothing wrong.
    if (video.currentTime > allowed + 1) video.currentTime = allowed;
  };

  /**
   * Keyboard control, on the player's own container.
   *
   * Scoped to the container rather than the document: the widget lives inside
   * somebody else's page, and a space bar that stopped scrolling the article
   * around it would be the widget reaching outside its own box.
   */
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    // A key pressed on the volume slider or a menu belongs to that control.
    const target = event.target as HTMLElement;
    if (target.tagName === "INPUT" || target.getAttribute("role") === "slider") return;

    const video = videoRef.current;
    if (video === null) return;

    const seekBy = (deltaSec: number) => {
      video.currentTime = clampSeekToLimit(
        nudgePositionSec(video.currentTime, deltaSec, duration),
        seekLimitNow(),
      );
      publish(video);
    };

    switch (event.key) {
      case " ":
      case "k":
        togglePlay();
        break;
      case "ArrowLeft":
        seekBy(-SEEK_STEP_SEC);
        break;
      case "ArrowRight":
        seekBy(SEEK_STEP_SEC);
        break;
      case "j":
        seekBy(-SEEK_JUMP_SEC);
        break;
      case "l":
        seekBy(SEEK_JUMP_SEC);
        break;
      case "ArrowUp":
        withVideo((element) => {
          element.volume = clampVolume(element.volume + VOLUME_STEP);
          element.muted = false;
        });
        break;
      case "ArrowDown":
        withVideo((element) => {
          element.volume = clampVolume(element.volume - VOLUME_STEP);
        });
        break;
      case "m":
        withVideo((element) => {
          element.muted = !element.muted;
        });
        break;
      case "c":
        setCaptionsOn((on) => !on);
        break;
      case "f":
        void toggleFullscreen();
        break;
      default:
        // 0–9 jump to that tenth of the video, as every player does.
        if (/^[0-9]$/.test(event.key)) {
          seekTo(seekPositionSec(Number(event.key) / 10, duration));
          break;
        }
        return;
    }
    event.preventDefault();
  };

  const containerRef = useRef<HTMLDivElement>(null);

  const toggleFullscreen = useCallback(async () => {
    const container = containerRef.current;
    if (container === null) return;
    try {
      if (document.fullscreenElement === null) await container.requestFullscreen();
      else await document.exitFullscreen();
    } catch {
      // Refused by the browser or unavailable in this embedding. Nothing the
      // learner can act on, and the video keeps playing either way.
    }
  }, []);

  if (props.sources.length === 0) {
    return <Failure message={de.media.error.missing} onRetry={undefined} />;
  }

  return (
    <div className="space-y-2">
      {/*
        `tabIndex` and the key handler go on the container, not the <video>:
        the video's own element is `controls={false}` and never focused, and
        the controls below are real buttons that must stay reachable. The
        container is focusable and named, so `jsx-a11y` is satisfied without a
        disable — every shortcut it handles also has a button below it.
      */}
      <div
        ref={containerRef}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        aria-label={props.title}
        className="group relative overflow-hidden rounded-[var(--ds-radius)] bg-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
      >
        {/*
          `jsx-a11y/media-has-caption` only recognises a static <track> child
          and cannot see the conditional below, so it warns about markup that is
          in fact present. Narrow disable for exactly that: the day the <track>
          is deleted, the next reviewer finds a disable with no element.
        */}
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video
          ref={videoRef}
          className="block max-h-[70vh] w-full bg-black"
          // The browser picks: it takes the first <source> whose `type` it can
          // play and skips the rest. `orderSources` on the server already put
          // adaptive streams first, which is the whole of the negotiation.
          poster={props.posterUrl ?? undefined}
          preload="metadata"
          playsInline
          controls={false}
          onLoadedMetadata={handleLoadedMetadata}
          onTimeUpdate={handleTimeUpdate}
          onProgress={handleProgress}
          /*
           * `play` and `pause`/`ended` bracket the interval; `timeupdate`
           * alone cannot.
           *
           * `timeupdate` fires about four times a second, so an interval built
           * only from it starts a quarter-second after playback did and ends a
           * quarter-second before it stopped. Watching a video from end to end
           * therefore credited ~97 %, and the watch gate defaults to 100 — so
           * the gate was not strict but *unreachable*. Observing the element's
           * own position at the two ends closes both slivers with the figure
           * the element itself reports.
           *
           * Deliberately **not** on `seeking`: by the time it fires,
           * `currentTime` is already the destination, and observing it would
           * stretch the open interval across material nobody watched. A seek
           * closes the interval and opens a new one where it lands.
           */
          onPlay={() => {
            withVideo((video) => onTick(video.currentTime, true));
          }}
          onPlaying={() => withVideo(() => {})}
          onWaiting={() => withVideo(() => {})}
          onPause={() => {
            withVideo((video) => onTick(video.currentTime, true));
            onStop("pause");
            withVideo(() => {});
          }}
          onSeeking={() => {
            onStop("seek");
            enforceSeekLimit();
            withVideo(() => {});
          }}
          onSeeked={() => withVideo(() => {})}
          onEnded={() => {
            // `pause` fires first and has already observed this position; the
            // repeat is idempotent — the tracker extends an interval to a
            // position it already holds without widening it.
            withVideo((video) => onTick(video.currentTime, true));
            onStop("ended");
            withVideo(() => {});
          }}
          onVolumeChange={() => withVideo(() => {})}
          onRateChange={() => withVideo(() => {})}
          onError={handleError}
          key={reloads}
        >
          {props.sources.map((source) => (
            <source key={source.url} src={source.url} type={source.mimeType} />
          ))}
          {/*
            WCAG 1.2.2 (Captions, Prerecorded) is Level A and EN 301 549 makes
            it the reference standard in Germany. Rendered only when the author
            supplied a track: an empty <track> with no `src` offers a captions
            control that produces nothing, which reads as broken captions rather
            than absent ones.
          */}
          {props.captionsUrl === null ? null : (
            <track
              kind="captions"
              src={props.captionsUrl}
              srcLang="de"
              label={de.content.captions}
              default
            />
          )}
          {de.media.error.unsupported}
        </video>

        {failure === undefined ? null : (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80 p-4">
            <Failure
              message={de.media.error[failure]}
              onRetry={
                failure === "network"
                  ? () => {
                      setFailure(undefined);
                      // A new key remounts the element, which re-runs source
                      // selection. `load()` alone keeps a source the browser has
                      // already given up on.
                      setReloads((n) => n + 1);
                    }
                  : undefined
              }
            />
          </div>
        )}

        {state.buffering && failure === undefined ? (
          <p
            className="absolute inset-x-0 top-2 text-center text-xs text-white/90"
            role="status"
          >
            {de.media.buffering}
          </p>
        ) : null}

        {/* The layout's centred play button, over the poster. */}
        {!state.playing && failure === undefined ? (
          <button
            type="button"
            onClick={togglePlay}
            aria-label={state.ended ? de.media.replay : de.media.play}
            className="absolute inset-0 flex items-center justify-center"
          >
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/90 text-brand-700 shadow-lg">
              <PlayIcon className="h-8 w-8" />
            </span>
          </button>
        ) : null}
      </div>

      <Controls
        state={state}
        duration={duration}
        buffered={buffered}
        watchedSegments={props.watchedSegments}
        seekLimitSec={seekLimit}
        captionsAvailable={props.captionsUrl !== null}
        captionsOn={captionsOn}
        fullscreen={fullscreen}
        onTogglePlay={togglePlay}
        onSeek={seekTo}
        onToggleMute={() =>
          withVideo((video) => {
            video.muted = !video.muted;
          })
        }
        onVolume={(volume) =>
          withVideo((video) => {
            video.volume = clampVolume(volume);
            video.muted = volume === 0;
          })
        }
        onCycleRate={() =>
          withVideo((video) => {
            video.playbackRate = nextPlaybackRate(video.playbackRate);
          })
        }
        onToggleCaptions={() => setCaptionsOn((on) => !on)}
        onToggleFullscreen={() => void toggleFullscreen()}
        onPictureInPicture={() =>
          withVideo((video) => {
            void (document.pictureInPictureElement === null
              ? video.requestPictureInPicture?.().catch(() => undefined)
              : document.exitPictureInPicture?.().catch(() => undefined));
          })
        }
      />

      <details className="text-xs text-gray-500">
        <summary className="cursor-pointer">{de.media.shortcuts}</summary>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          {de.media.shortcutList.map(([keys, what]) => (
            <div key={keys} className="contents">
              <dt className="font-mono">{keys}</dt>
              <dd>{what}</dd>
            </div>
          ))}
        </dl>
      </details>
    </div>
  );
}

function Controls(props: {
  state: PlaybackState;
  duration: number;
  buffered: ReadonlyArray<readonly [number, number]>;
  watchedSegments: readonly WatchedSegment[];
  seekLimitSec: number;
  captionsAvailable: boolean;
  captionsOn: boolean;
  fullscreen: boolean;
  onTogglePlay: () => void;
  onSeek: (positionSec: number) => void;
  onToggleMute: () => void;
  onVolume: (volume: number) => void;
  onCycleRate: () => void;
  onToggleCaptions: () => void;
  onToggleFullscreen: () => void;
  onPictureInPicture: () => void;
}) {
  const { state, duration } = props;
  const position = clockTime(state.positionSec);
  const total = clockTime(duration);

  return (
    <div className="space-y-2">
      <SeekBar
        positionSec={state.positionSec}
        durationSec={duration}
        buffered={props.buffered}
        watchedSegments={props.watchedSegments}
        seekLimitSec={props.seekLimitSec}
        onSeek={props.onSeek}
      />

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
        <IconButton
          label={
            state.playing ? de.media.pause : state.ended ? de.media.replay : de.media.play
          }
          onClick={props.onTogglePlay}
        >
          {state.playing ? <PauseIcon /> : <PlayIcon />}
        </IconButton>

        {/*
          The elapsed/total pair lives in the progress panel above the player
          (layout §4.3), so repeating it here would put two identical clocks a
          hundred pixels apart. In fullscreen that panel is not on screen, and
          the control bar is the only thing that can carry it — which is the one
          case where it belongs here.

          `noch 11:10` is shown either way: it is the reading the panel does not
          have, and "how much is left" is the question a learner deciding
          whether to start a module actually asks.
        */}
        {props.fullscreen ? (
          <p className="tabular-nums text-gray-700">
            {de.player.position(position, total)}
          </p>
        ) : null}
        <p className="tabular-nums text-gray-500">
          {de.media.remaining(clockTime(remainingSec(state.positionSec, duration)))}
        </p>

        <div className="flex items-center gap-1">
          <IconButton
            label={state.muted || state.volume === 0 ? de.media.unmute : de.media.mute}
            onClick={props.onToggleMute}
          >
            {state.muted || state.volume === 0 ? <MutedIcon /> : <VolumeIcon />}
          </IconButton>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={state.muted ? 0 : state.volume}
            aria-label={de.media.volume}
            onChange={(event) => props.onVolume(Number(event.target.value))}
            /*
              `h-6`, not `h-1`. The track still draws thin — the browser
              centres it in the element's box — but the box is what a thumb
              hits, and at `h-1` this was the one control on any of the seven
              screens below WCAG 2.2 AA's 24 x 24 target size (80 x 4). Measured
              in Chromium during the P19-03 pass, not assumed.
            */
            className="h-6 w-20 accent-brand-600"
          />
        </div>

        {/*
          A cycling button rather than a menu: six rates, one control, and it
          keeps the whole player operable from the keyboard without a popup to
          trap focus in. The current value is the button's own text, so it is
          announced on every press.
        */}
        <button
          type="button"
          onClick={props.onCycleRate}
          aria-label={`${de.media.speed}: ${de.media.speedValue(state.rate)}`}
          className="rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700"
        >
          {de.media.speedValue(state.rate)}
        </button>

        {props.captionsAvailable ? (
          <button
            type="button"
            onClick={props.onToggleCaptions}
            aria-pressed={props.captionsOn}
            className={`rounded border px-2 py-1 text-xs font-medium ${
              props.captionsOn
                ? "border-brand-600 bg-brand-50 text-brand-700"
                : "border-gray-300 text-gray-700"
            }`}
          >
            {props.captionsOn ? de.media.captionsOff : de.media.captionsOn}
          </button>
        ) : null}

        <div className="ml-auto flex items-center gap-1">
          {/*
            Offered only where it exists. A Picture-in-Picture button that does
            nothing on Firefox-with-it-disabled is worse than no button.
          */}
          {typeof document !== "undefined" && document.pictureInPictureEnabled ? (
            <IconButton
              label={de.media.pictureInPicture}
              onClick={props.onPictureInPicture}
            >
              <PipIcon />
            </IconButton>
          ) : null}
          <IconButton
            label={props.fullscreen ? de.media.exitFullscreen : de.media.fullscreen}
            onClick={props.onToggleFullscreen}
          >
            <FullscreenIcon />
          </IconButton>
        </div>
      </div>
    </div>
  );
}

/**
 * The scrub bar, with four layers.
 *
 * Bottom to top: **buffered** (what the browser has), **locked** (what may not
 * be reached yet), **covered** (what the *server* has credited), **position**
 * (where the playhead is). The covered layer is the interesting one and it is
 * drawn from `watchedSegments` — the merged union the API returned — never from
 * anything accumulated locally. A learner looking at this bar is looking at
 * what the CME gate will count.
 *
 * The locked layer exists so the restriction is *visible*. A bar that simply
 * declines to move when dragged reads as a broken control, and the learner's
 * next move is to reload the page; a hatched remainder with a sentence under it
 * reads as a rule, which is what it is.
 *
 * `role="slider"` with real key handling rather than an `<input type=range>`:
 * a range input cannot render the four layers, and reimplementing the ARIA
 * contract is a smaller cost than reimplementing the visuals on top of one.
 * `aria-valuemax` follows the *limit* rather than the duration, because the
 * ARIA contract is about what the control can be set to — a screen reader that
 * announced a maximum the slider refuses to reach would be describing a
 * different widget.
 */
function SeekBar(props: {
  positionSec: number;
  durationSec: number;
  buffered: ReadonlyArray<readonly [number, number]>;
  watchedSegments: readonly WatchedSegment[];
  seekLimitSec: number;
  onSeek: (positionSec: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const noteId = useId();
  const fraction = positionFraction(props.positionSec, props.durationSec);

  const limited =
    Number.isFinite(props.seekLimitSec) &&
    props.durationSec > 0 &&
    props.seekLimitSec < props.durationSec;
  const limitFraction = limited
    ? positionFraction(props.seekLimitSec, props.durationSec)
    : 1;

  const seekFromPointer = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (rect === undefined) return;
    props.onSeek(seekPositionSec(seekFraction(clientX, rect), props.durationSec));
  };

  return (
    <>
      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label={de.media.seek}
        aria-valuemin={0}
        aria-valuemax={Math.max(
          0,
          Math.floor(limited ? props.seekLimitSec : props.durationSec) || 0,
        )}
        aria-valuenow={Math.floor(props.positionSec)}
        aria-valuetext={
          limited
            ? de.media.seekValueLimited(
                clockTime(props.positionSec),
                clockTime(props.durationSec),
                clockTime(props.seekLimitSec),
              )
            : de.media.seekValue(
                clockTime(props.positionSec),
                clockTime(props.durationSec),
              )
        }
        aria-describedby={limited ? noteId : undefined}
        onClick={(event) => seekFromPointer(event.clientX)}
        onKeyDown={(event) => {
          const step =
            event.key === "ArrowLeft"
              ? -SEEK_STEP_SEC
              : event.key === "ArrowRight"
                ? SEEK_STEP_SEC
                : event.key === "Home"
                  ? -props.durationSec
                  : event.key === "End"
                    ? props.durationSec
                    : 0;
          if (step === 0) return;
          event.preventDefault();
          props.onSeek(nudgePositionSec(props.positionSec, step, props.durationSec));
        }}
        className="relative h-2 w-full cursor-pointer rounded-full bg-gray-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
      >
        {bufferedBars(props.buffered, props.durationSec).map((bar) => (
          <span
            key={`b${bar.startPercent}`}
            aria-hidden="true"
            className="absolute inset-y-0 rounded-full bg-gray-300"
            style={{ left: `${bar.startPercent}%`, width: `${bar.widthPercent}%` }}
          />
        ))}

        {/*
        The locked remainder. Hatched rather than merely darker: the bar already
        uses four shades to mean four things, and a fifth grey would be one
        distinction too many for a bar two pixels tall — and, per WCAG 1.4.1,
        one that colour alone would carry.
      */}
        {limited ? (
          <span
            aria-hidden="true"
            className="absolute inset-y-0 right-0 rounded-r-full bg-gray-400/70"
            style={{
              left: `${limitFraction * 100}%`,
              backgroundImage:
                "repeating-linear-gradient(45deg, rgba(255,255,255,.6) 0 2px, transparent 2px 4px)",
            }}
          />
        ) : null}

        {coverageBars(props.watchedSegments, props.durationSec).map((bar) => (
          <span
            key={`c${bar.startPercent}`}
            aria-hidden="true"
            className="absolute inset-y-0 rounded-full bg-brand-300"
            style={{ left: `${bar.startPercent}%`, width: `${bar.widthPercent}%` }}
          />
        ))}

        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-0 rounded-full bg-brand-600"
          style={{ width: `${fraction * 100}%` }}
        />
        <span
          aria-hidden="true"
          className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-700"
          style={{ left: `${fraction * 100}%` }}
        />
      </div>

      {/*
        Rendered only while the restriction is actually biting. A permanent
        notice would still be on screen for the learner who has watched the
        whole video, telling them off for nothing.
      */}
      {limited ? (
        <p id={noteId} className="text-xs text-gray-600">
          {de.media.seekLocked}
        </p>
      ) : null}
    </>
  );
}

function IconButton(props: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      aria-label={props.label}
      title={props.label}
      className="inline-flex h-8 w-8 items-center justify-center rounded text-gray-700 hover:bg-brand-50"
    >
      {props.children}
    </button>
  );
}

function Failure(props: { message: string; onRetry: (() => void) | undefined }) {
  return (
    <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm" role="alert">
      <p className="text-red-800">{props.message}</p>
      {props.onRetry === undefined ? null : (
        <button
          type="button"
          onClick={props.onRetry}
          className="mt-2 rounded border border-red-300 px-3 py-1 font-medium text-red-800"
        >
          {de.media.error.retry}
        </button>
      )}
    </div>
  );
}

/* Icons. Decorative throughout — every one sits inside a labelled control. */

function PlayIcon(props: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={props.className ?? "h-5 w-5"}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M8 5.14v13.72a.5.5 0 0 0 .77.42l10.5-6.86a.5.5 0 0 0 0-.84L8.77 4.72a.5.5 0 0 0-.77.42Z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true">
      <path d="M7 4h4v16H7zM13 4h4v16h-4z" />
    </svg>
  );
}

function VolumeIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true">
      <path d="M4 9v6h4l5 4V5L8 9H4Zm12.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4Zm-2.5 6.9a7 7 0 0 0 0-13.8v2.06a5 5 0 0 1 0 9.68v2.06Z" />
    </svg>
  );
}

function MutedIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true">
      <path d="M4 9v6h4l5 4V5L8 9H4Zm12.7 3 2.3-2.3-1.4-1.4-2.3 2.3-2.3-2.3-1.4 1.4 2.3 2.3-2.3 2.3 1.4 1.4 2.3-2.3 2.3 2.3 1.4-1.4-2.3-2.3Z" />
    </svg>
  );
}

function PipIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true">
      <path d="M3 5h18v14H3V5Zm2 2v10h14V7H5Zm6 4h6v4h-6v-4Z" />
    </svg>
  );
}

function FullscreenIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true">
      <path d="M4 4h6v2H6v4H4V4Zm10 0h6v6h-2V6h-4V4ZM4 14h2v4h4v2H4v-6Zm14 0h2v6h-6v-2h4v-4Z" />
    </svg>
  );
}
