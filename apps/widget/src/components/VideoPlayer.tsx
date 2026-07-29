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
 * | Whether the video is complete | the **server** — never inferred here |
 *
 * The last two are the ones that matter. This component never accumulates its
 * own coverage: the bar it draws is the server's merged union, redrawn from
 * every `recordProgress` response. An optimistic local bar would show credit
 * for segments the server rejected as implausible, which is precisely the
 * disagreement `CLAUDE.md` §4 invariant 6 exists to prevent.
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

import { useCallback, useEffect, useRef, useState } from "react";
import {
  bufferedBars,
  clampVolume,
  clockTime,
  coverageBars,
  nextPlaybackRate,
  nudgePositionSec,
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
  /** Where the learner left off. A convenience, never a gate input. */
  readonly startAtSec: number;
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

    onTick(video.currentTime, !video.paused && !video.seeking);

    const second = Math.floor(video.currentTime);
    if (second === lastSecond.current) return;
    lastSecond.current = second;
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

  const seekTo = (positionSec: number) =>
    withVideo((video) => {
      video.currentTime = positionSec;
    });

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
      video.currentTime = nudgePositionSec(video.currentTime, deltaSec, duration);
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
          onPlay={() => withVideo(() => {})}
          onPlaying={() => withVideo(() => {})}
          onWaiting={() => withVideo(() => {})}
          onPause={() => {
            onStop("pause");
            withVideo(() => {});
          }}
          onSeeking={() => {
            onStop("seek");
            withVideo(() => {});
          }}
          onSeeked={() => withVideo(() => {})}
          onEnded={() => {
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
            className="h-1 w-20 accent-brand-600"
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
 * The scrub bar, with three layers.
 *
 * Bottom to top: **buffered** (what the browser has), **covered** (what the
 * *server* has credited), **position** (where the playhead is). The middle one
 * is the interesting one and it is drawn from `watchedSegments` — the merged
 * union the API returned — never from anything accumulated locally. A learner
 * looking at this bar is looking at what the CME gate will count.
 *
 * `role="slider"` with real key handling rather than an `<input type=range>`:
 * a range input cannot render the three layers, and reimplementing the ARIA
 * contract is a smaller cost than reimplementing the visuals on top of one.
 */
function SeekBar(props: {
  positionSec: number;
  durationSec: number;
  buffered: ReadonlyArray<readonly [number, number]>;
  watchedSegments: readonly WatchedSegment[];
  onSeek: (positionSec: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const fraction = positionFraction(props.positionSec, props.durationSec);

  const seekFromPointer = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (rect === undefined) return;
    props.onSeek(seekPositionSec(seekFraction(clientX, rect), props.durationSec));
  };

  return (
    <div
      ref={trackRef}
      role="slider"
      tabIndex={0}
      aria-label={de.media.seek}
      aria-valuemin={0}
      aria-valuemax={Math.max(0, Math.floor(props.durationSec) || 0)}
      aria-valuenow={Math.floor(props.positionSec)}
      aria-valuetext={de.media.seekValue(
        clockTime(props.positionSec),
        clockTime(props.durationSec),
      )}
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
