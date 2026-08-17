/**
 * A poster taken from the video itself (P80-01).
 *
 * ## Why this exists
 *
 * Asked for directly: _"the preview picture should be automatically as the
 * first second of the video if no image is selected."_
 *
 * Without a poster the player shows a black rectangle until the first frame
 * decodes — which on a course card and on the player's own idle state is
 * indistinguishable from a video that failed to load. Every author therefore
 * *should* set one, and asking each of them to export a still from their own
 * recording is asking for work the browser can do in a second.
 *
 * ## Why one second in, and not zero
 *
 * Frame zero of a real recording is very often black: an encoder's first
 * keyframe on a fade-in, a slide deck's title animation, a camera still
 * adjusting exposure. A poster that is a black rectangle is no better than no
 * poster at all, so the capture is taken a second in — and clamped for a video
 * shorter than that, where the midpoint is the best available guess.
 *
 * ## What can go wrong, and why each answer is `undefined`
 *
 * Everything here depends on the browser being *allowed* to read the pixels.
 * If the object store answers without the CORS headers the console's origin
 * needs, the frame still renders on screen but the canvas is **tainted**, and
 * `toBlob` throws `SecurityError`. A codec the browser cannot decode fails
 * earlier, at `loadeddata`.
 *
 * Neither is an error worth interrupting an author for: a poster is a
 * convenience, and the field beside it still accepts a file. So every failure
 * path returns `undefined` and the form simply does not fill the box.
 */

/** Where the still is taken from, when the video is long enough. */
const CAPTURE_AT_SEC = 1;

/**
 * How long to wait for a browser that never fires either event.
 *
 * A dead URL, a hung range request, or a decoder that stalls would otherwise
 * leave the promise pending for the lifetime of the page, holding a detached
 * `<video>` and its buffer with it.
 */
const TIMEOUT_MS = 15_000;

/**
 * The largest edge of the captured still, in pixels.
 *
 * A poster is decoration on a card and a still behind a play button; a 4K frame
 * would be several megabytes of PNG for something displayed at a few hundred
 * pixels, uploaded over the author's connection and then over every learner's.
 * Scaled down preserving aspect ratio, and never scaled *up* — a small video
 * keeps its own size rather than being blown up and blurred.
 */
const MAX_EDGE_PX = 1280;

function scaled(width: number, height: number): { width: number; height: number } {
  const largest = Math.max(width, height);
  if (largest <= MAX_EDGE_PX) return { width, height };
  const factor = MAX_EDGE_PX / largest;
  return {
    width: Math.max(1, Math.round(width * factor)),
    height: Math.max(1, Math.round(height * factor)),
  };
}

/**
 * Grab a still from `url`, as a JPEG `File` ready for the ordinary upload path.
 *
 * A `File` rather than a `Blob` so it goes through exactly the same
 * `runUpload` the picker uses — the same presign, the same key prefix, the same
 * storage audit row. A second upload path for posters would be a second set of
 * rules to keep in step.
 */
export async function capturePosterFrame(
  url: string,
  documentRef: Document = document,
): Promise<File | undefined> {
  return new Promise<File | undefined>((resolve) => {
    const video = documentRef.createElement("video");
    let settled = false;

    const finish = (result: File | undefined): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Detach the source before dropping the element: without it some
      // browsers keep the request and its buffer alive until GC.
      video.removeAttribute("src");
      video.load();
      resolve(result);
    };

    const timer = setTimeout(() => finish(undefined), TIMEOUT_MS);

    // Anonymous, or the canvas is tainted and `toBlob` throws — the pixels
    // would be on screen and unreadable, which is the confusing failure.
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.preload = "auto";

    video.addEventListener("error", () => finish(undefined));

    video.addEventListener("loadedmetadata", () => {
      const duration = video.duration;
      const target =
        Number.isFinite(duration) && duration > 0
          ? Math.min(CAPTURE_AT_SEC, duration / 2)
          : CAPTURE_AT_SEC;
      // Seeking is what actually decodes a frame at a chosen time; `seeked`
      // below is where the pixels are guaranteed to be there.
      video.currentTime = target;
    });

    video.addEventListener("seeked", () => {
      try {
        const { width, height } = scaled(video.videoWidth, video.videoHeight);
        if (width === 0 || height === 0) {
          finish(undefined);
          return;
        }

        const canvas = documentRef.createElement("canvas");
        canvas.width = width;
        canvas.height = height;

        const context = canvas.getContext("2d");
        if (context === null) {
          finish(undefined);
          return;
        }
        context.drawImage(video, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            finish(
              blob === null
                ? undefined
                : new File([blob], "poster.jpg", { type: "image/jpeg" }),
            );
          },
          "image/jpeg",
          // Enough for a still behind a play button; the difference above this
          // is invisible at the sizes a poster is displayed and is not free.
          0.82,
        );
      } catch {
        // `SecurityError` from a tainted canvas is the expected one — the
        // bucket answered without the CORS headers this origin needs.
        finish(undefined);
      }
    });

    video.src = url;
  });
}
