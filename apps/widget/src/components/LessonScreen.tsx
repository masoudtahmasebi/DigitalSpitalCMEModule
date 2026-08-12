/**
 * The lesson screen — video, text or details (P3-03, P5-04, P5-12).
 *
 * This is the **reporting** half of watching a video. `VideoPlayer` owns the
 * media element and the controls; this owns the conversation with the API, and
 * the two are separate because they fail differently: a bug in the player is a
 * control that does not respond, a bug here is watch credit a physician earned
 * and did not receive.
 *
 * ## What it sends and when
 *
 * Watched intervals are flushed on a timer while playing, on pause, on ended,
 * and when the page is being hidden or unloaded. The last of those matters
 * most: a learner who closes the tab after twenty minutes must not lose twenty
 * minutes of watch credit, and `visibilitychange` is the only event that fires
 * reliably on mobile Safari when an app is backgrounded.
 *
 * ## What it does not do
 *
 * It does not decide whether the video counts as watched, does not unlock
 * anything, and does not compute a percentage. Both numbers it shows — the
 * credited percentage and the shaded passages on the scrub bar — are the
 * server's answer to the last report, so what the learner sees and what the
 * completion gate enforces cannot disagree.
 *
 * The coverage the bar draws is likewise the server's merged union, replaced
 * wholesale on every response. Accumulating it locally would show credit for
 * segments the server rejected as implausible — a bar that disagrees with the
 * gate it is meant to depict.
 *
 * ## Seeking and resuming are the server's answers
 *
 * Both arrive as numbers on the lesson — `resumeAtSec` and `seekCeilingSec` —
 * and are passed through untouched. Neither is computed here.
 *
 * That was not always so: forward seeking used to be unrestricted, on the
 * reasoning that the union of intervals makes skipping self-defeating anyway.
 * The reasoning still holds — a skipped passage leaves a hole the percentage
 * never fills — but it answers the wrong question. The accreditation requires
 * the material to have been *seen*, and a scrub bar that lets a physician drag
 * to the end and then quietly withholds the points is a worse experience than
 * one that will not drag there. So the ceiling is enforced in the interface and
 * the union remains the gate; the first is courtesy, the second is compliance.
 *
 * Backwards is still unrestricted, for the original reason: re-watching is
 * legitimate and free, and punishing it would stop nobody.
 *
 * ## Playback state belongs to the player chrome
 *
 * The layout puts the timeline reading and the **Fortbildung pausieren**
 * control outside the video, in the panel above it (§4.3). So playback is
 * *controlled*: the player reports its real state upward and takes `paused`
 * back down. The alternative — the chrome reaching in through a ref to call
 * `.pause()` — would give one fact two owners, and the panel would eventually
 * say "paused" over a video that was still running.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { WatchedSegment } from "@ds/domain";
import type { ApiClient, LessonContent } from "@ds/sdk";
import { isSessionExpired } from "../session.js";
import { de } from "../locale/de.js";
import { coalesce, WatchTracker } from "../watch-tracker.js";
import { VideoPlayer, type PlaybackState } from "./VideoPlayer.js";

/** How often watched intervals are sent while playing. */
const FLUSH_INTERVAL_MS = 15_000;

export type { PlaybackState } from "./VideoPlayer.js";

export function LessonScreen(props: {
  client: ApiClient;
  courseSlug: string;
  lesson: LessonContent;
  onProgress: () => void;
  /** The session ended and no flush will succeed again (P62-05). */
  onAuthLost: () => void;
  /** Set true by the chrome's **Fortbildung pausieren**. */
  paused: boolean;
  onPlayback: (state: PlaybackState) => void;
}) {
  const { client, courseSlug, lesson, onProgress } = props;

  return lesson.kind === "video" ? (
    <VideoLesson
      client={client}
      courseSlug={courseSlug}
      lesson={lesson}
      onProgress={onProgress}
      onAuthLost={props.onAuthLost}
      paused={props.paused}
      onPlayback={props.onPlayback}
    />
  ) : (
    <TextLesson lesson={lesson} />
  );
}

function VideoLesson(props: {
  client: ApiClient;
  courseSlug: string;
  lesson: LessonContent;
  onProgress: () => void;
  /** The session ended and no flush will succeed again (P62-05). */
  onAuthLost: () => void;
  paused: boolean;
  onPlayback: (state: PlaybackState) => void;
}) {
  const trackerRef = useRef(new WatchTracker());
  const positionRef = useRef(props.lesson.lastPositionSec);

  const { client, courseSlug, lesson, onProgress, onAuthLost } = props;

  // All three are the server's, replaced on every response — never adjusted
  // locally. The ceiling is here rather than derived from `covered` so that the
  // rule deciding how far a learner may skip has exactly one implementation.
  const [watchedPercent, setWatchedPercent] = useState(lesson.watchedPercent);
  const [covered, setCovered] = useState<readonly WatchedSegment[]>(
    lesson.watchedSegments,
  );
  const [seekCeilingSec, setSeekCeilingSec] = useState(lesson.seekCeilingSec);

  // A new lesson in the same mounted component: reset to that lesson's own
  // figures rather than briefly showing the previous video's coverage.
  useEffect(() => {
    setWatchedPercent(lesson.watchedPercent);
    setCovered(lesson.watchedSegments);
    setSeekCeilingSec(lesson.seekCeilingSec);
    positionRef.current = lesson.lastPositionSec;
  }, [
    lesson.id,
    lesson.watchedPercent,
    lesson.watchedSegments,
    lesson.seekCeilingSec,
    lesson.lastPositionSec,
  ]);

  const flush = useCallback(async () => {
    const tracker = trackerRef.current;
    if (!tracker.hasPending) return;

    const segments = coalesce(tracker.drain());
    if (segments.length === 0) return;

    try {
      const result = await client.recordProgress(courseSlug, lesson.id, {
        segments,
        lastPositionSec: positionRef.current,
      });
      setWatchedPercent(result.watchedPercent);
      // The union the gate credited, not the intervals we believed we sent.
      // The difference is visible exactly when something was rejected.
      setCovered(result.watchedSegments);
      // And the ceiling that goes with it: a rejected segment must not raise
      // the limit, so the limit comes from the same answer as the union.
      setSeekCeilingSec(result.seekCeilingSec);
      onProgress();
    } catch (error) {
      /*
       * Silent for a transient failure, loud for an expired session (P62-05).
       *
       * The original reasoning still holds for a network blip: a learner
       * cannot act on it, the next flush retries, and the server recomputes
       * the union from everything ever reported, so watching on converges on
       * the truth.
       *
       * **A 401 breaks every step of that.** The SDK has already spent its one
       * refresh attempt (P5-02), so this one is unrecoverable; the next flush
       * fails identically, and it does so for as long as the learner keeps
       * watching. QA measured it: a 60-second token, a module playing on, and
       * every flush from expiry onwards refused — while the screen still said
       * "Ihr Fortschritt wird automatisch gespeichert". Twenty-five minutes of
       * a physician's evening, credited as nothing, with a reassurance on
       * screen the whole time.
       */
      if (isSessionExpired(error)) onAuthLost();
    }
  }, [client, courseSlug, lesson.id, onProgress, onAuthLost]);

  useEffect(() => {
    const timer = setInterval(() => void flush(), FLUSH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [flush]);

  // Flush when the page goes away. `visibilitychange` covers mobile
  // backgrounding, where `beforeunload` never fires.
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === "hidden") {
        trackerRef.current.closeOpen();
        void flush();
      }
    };
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", onHidden);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", onHidden);
    };
  }, [flush]);

  // And on unmount — leaving for the outline is a page-leave too.
  useEffect(() => {
    const tracker = trackerRef.current;
    return () => {
      tracker.closeOpen();
      void flush();
    };
  }, [flush]);

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-gray-900">{lesson.title}</h2>
        <span className="text-sm text-gray-600">
          {de.content.watched(watchedPercent)}
        </span>
      </div>

      <VideoPlayer
        sources={lesson.sources}
        posterUrl={lesson.posterUrl}
        captionsUrl={lesson.captionsUrl}
        title={lesson.title}
        durationSec={lesson.durationSec}
        // The server's resume point, not `lastPositionSec`: a learner who left
        // at 14:35 comes back at 14:00, and which second that is, is decided in
        // one place for every host.
        startAtSec={lesson.resumeAtSec}
        seekCeilingSec={seekCeilingSec}
        watchedSegments={covered}
        paused={props.paused}
        onPlayback={(state) => {
          positionRef.current = state.positionSec;
          props.onPlayback(state);
        }}
        onTick={(positionSec, playing) => {
          positionRef.current = positionSec;
          trackerRef.current.observe(positionSec, playing);
        }}
        onStop={(reason) => {
          trackerRef.current.closeOpen();
          // Pausing is the learner stopping, and "Ihr Fortschritt wird
          // automatisch gespeichert" is a promise the screen makes out loud.
          // A seek is not flushed: dragging the scrub bar would fire a request
          // per frame for intervals the next timer flush carries anyway.
          if (reason !== "seek") void flush();
        }}
      />
    </>
  );
}

/**
 * A text or details lesson.
 *
 * `body` is authored content from the course, written by an admin, not learner
 * input — but it is still rendered as **text, not HTML**. Injecting authored
 * markup into a shadow root would make a compromised or careless admin account
 * a scripting vector on a page that holds a bearer token, and no requirement
 * asks for rich text here (rich WYSIWYG authoring is explicitly deferred,
 * CLAUDE.md §3). Paragraph breaks are preserved; nothing else is interpreted.
 */
function TextLesson(props: { lesson: LessonContent }) {
  const paragraphs = (props.lesson.body ?? "").split(/\n{2,}/).filter((p) => p !== "");

  return (
    <>
      <h2 className="text-lg font-semibold text-gray-900">{props.lesson.title}</h2>
      <div className="space-y-3 text-sm leading-relaxed text-gray-800">
        {paragraphs.map((paragraph, index) => (
          // Paragraphs have no id and never reorder, so the index is stable.
          <p key={index}>{paragraph}</p>
        ))}
      </div>
    </>
  );
}
