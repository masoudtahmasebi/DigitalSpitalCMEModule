/**
 * The lesson screen — video, text or details (P3-03, P5-04).
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
 * anything, and does not display its own computed percentage. The number shown
 * is the one the API returned from the last report — the same figure the
 * completion gate uses, so what the learner reads and what the server enforces
 * cannot disagree.
 *
 * Seeking is not blocked. The union of watched intervals makes blocking
 * pointless: skipping ahead simply leaves a hole and the percentage never
 * reaches the threshold. Disabling the scrub bar would punish the learner who
 * legitimately rewinds while stopping nobody.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient, LessonContent } from "@ds/sdk";
import { de } from "../locale/de.js";
import { coalesce, WatchTracker } from "../watch-tracker.js";
import { Button } from "./primitives.js";

/** How often watched intervals are sent while playing. */
const FLUSH_INTERVAL_MS = 15_000;

export function LessonScreen(props: {
  client: ApiClient;
  courseSlug: string;
  lesson: LessonContent;
  onProgress: () => void;
  onBack: () => void;
}) {
  const { client, courseSlug, lesson, onProgress } = props;

  return (
    <div className="space-y-4">
      {lesson.kind === "video" ? (
        <VideoLesson
          client={client}
          courseSlug={courseSlug}
          lesson={lesson}
          onProgress={onProgress}
        />
      ) : (
        <TextLesson lesson={lesson} />
      )}

      <Button variant="secondary" onClick={props.onBack}>
        {de.content.back}
      </Button>
    </div>
  );
}

function VideoLesson(props: {
  client: ApiClient;
  courseSlug: string;
  lesson: LessonContent;
  onProgress: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackerRef = useRef(new WatchTracker());
  const [watchedPercent, setWatchedPercent] = useState(props.lesson.watchedPercent);

  const { client, courseSlug, lesson, onProgress } = props;

  const flush = useCallback(async () => {
    const tracker = trackerRef.current;
    if (!tracker.hasPending) return;

    const segments = coalesce(tracker.drain());
    if (segments.length === 0) return;

    try {
      const result = await client.recordProgress(courseSlug, lesson.id, {
        segments,
        lastPositionSec: videoRef.current?.currentTime ?? 0,
      });
      setWatchedPercent(result.watchedPercent);
      onProgress();
    } catch {
      // Deliberately silent. A failed heartbeat is not something a learner can
      // act on, and an error banner mid-video would alarm them about a request
      // the next flush retries anyway. The intervals are lost, not the watch:
      // the server recomputes the union from everything ever reported, so a
      // learner who keeps watching still converges on the true percentage.
    }
  }, [client, courseSlug, lesson.id, onProgress]);

  // Resume where they left off. `lastPositionSec` is a convenience, never a
  // gate input — the server ignores it when computing coverage.
  useEffect(() => {
    const video = videoRef.current;
    if (video === null || lesson.lastPositionSec <= 0) return;
    video.currentTime = lesson.lastPositionSec;
  }, [lesson.id, lesson.lastPositionSec]);

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

  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (video === null) return;
    trackerRef.current.observe(video.currentTime, !video.paused && !video.seeking);
  };

  const handleStop = () => trackerRef.current.closeOpen();

  const handleEnded = () => {
    trackerRef.current.closeOpen();
    void flush();
  };

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-gray-900">{lesson.title}</h2>
        <span className="text-sm text-gray-600">
          {de.content.watched(watchedPercent)}
        </span>
      </div>

      {lesson.videoUrl === null ? (
        <p className="rounded-md bg-gray-50 p-4 text-sm text-gray-600">
          {de.content.videoUnsupported}
        </p>
      ) : (
        // Captions warn rather than error: a <track> is a content-authoring
        // obligation on the course, and the schema has no caption field in this
        // budget. The warning is the reminder that it is owed, not noise to
        // silence — see docs/backlog/P5.md.
        <video
          ref={videoRef}
          src={lesson.videoUrl}
          controls
          preload="metadata"
          className="w-full rounded-lg bg-black"
          onTimeUpdate={handleTimeUpdate}
          onPause={handleStop}
          onSeeking={handleStop}
          onEnded={handleEnded}
        >
          {de.content.videoUnsupported}
        </video>
      )}
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
