/**
 * Reading a video's length out of the file, so nobody has to type it (P15-02).
 *
 * ## Why this exists
 *
 * `durationSec` is not a display field. The watch gate is a percentage *of it*,
 * so a course whose author typed 1500 for a 1545-second video credits full
 * coverage at 97 % watched — the last forty-five seconds become optional, and
 * nothing anywhere reports that anything is wrong. Typos in this one field are
 * silent accreditation defects, and the file already knows the answer.
 *
 * ## Why the browser probes it rather than the server
 *
 * Reading a container's duration server-side means ffprobe in the API image,
 * which is the first step of a media pipeline — and media transcoding is
 * explicitly out of scope (CLAUDE.md §3). The browser has a decoder already;
 * `preload="metadata"` fetches the header and nothing else, so this costs a
 * range request rather than a download.
 *
 * ## Why a probed number is not a trusted number
 *
 * It is filled into the field and saved like any other input, by a staff user
 * whose authoring rights this already presumes — the same trust the typed value
 * had, with fewer opportunities to be wrong. It is *not* a compliance input the
 * platform accepts from a learner's browser: the value is written by an author,
 * through the authoring API, and the server validates it there.
 *
 * ## Why it can fail, and why that is fine
 *
 * A customer's own CDN may not send CORS headers. That is ordinary and is not
 * an error the author caused, so this reports "could not read it, please type
 * it" and the field stays exactly as editable as it was.
 *
 * ## The `s3://` gap, and how it was closed (P74-04)
 *
 * A reference is a key in our storage, not something a browser can fetch, so
 * until P74-02 `probeableSourceUrl` skipped them — and the effect was that the
 * one control which gets `durationSec` right disappeared **exactly** when the
 * author used the console to upload the video, which is now the normal way to
 * attach one. The field then went back to being typed, which is the
 * accreditation defect this file exists to prevent.
 *
 * The reference is now resolved to a short-lived signed URL first, so the
 * source-picking rule below is stated over both kinds. It stays pure: choosing
 * *which* source is a rule, resolving one is I/O, and they are separate
 * functions for the same reason they always were.
 */

import type { MediaSourceWrite } from "@ds/sdk";

/** How long to wait for a header before giving up. */
const PROBE_TIMEOUT_MS = 15_000;

/**
 * The first source whose length is worth reading.
 *
 * Pure, and separate from the probe, because *which* source is a rule and the
 * probe is I/O — this is the part worth testing. Order is meaningful: the
 * source list is the player's format negotiation, so the first entry is the one
 * most learners will watch, and its length is the one the gate should measure.
 *
 * Both an `https://` URL and an `s3://` reference qualify (P74-04). The
 * reference needs resolving before it can be fetched, which is the caller's
 * job — what is decided here is only which of the rows to use.
 *
 * An adaptive manifest is **not** skipped, and that is deliberate rather than
 * an oversight: a browser reports a finite `duration` for an on-demand HLS or
 * DASH manifest it can play, and reports `NaN` or `Infinity` for one it cannot.
 * `probeDurationSec` already refuses both, so a manifest either gives the right
 * answer or gives none — and skipping it here would leave a course whose only
 * rendition is adaptive with no button at all.
 */
export function probeableSourceUrl(
  sources: readonly MediaSourceWrite[],
): string | undefined {
  for (const source of sources) {
    const url = source.url.trim();
    if (url === "") continue;
    if (/^https?:\/\//iu.test(url) || url.startsWith("s3://")) return url;
  }
  return undefined;
}

/**
 * The video's length in whole seconds, or `undefined` when it cannot be read.
 *
 * Rounded rather than truncated: a 1544.6-second file is 1545 seconds long, and
 * truncating would shorten every video by up to a second — which, on a gate
 * requiring 100 % coverage, is a second the learner can never watch.
 */
/**
 * The length to store, from what the media element reported (P78-01).
 *
 * ## Floor, never round
 *
 * `Math.round` was the original, and it is the bug the client reported: a
 * 5.5-second file was stored as `6`, so the authored length — which the watch
 * gate is a percentage of — was **longer than the file**. The scrub bar stopped
 * short, „noch 0:00" sat under a bar with a visible gap, and the section
 * completed only because the rollup's half-second endpoint tolerance happened
 * to cover the 0.5 s difference. A file 0.6 s short of its rounded length gets
 * no such rescue and is unfinishable (P76-03).
 *
 * Flooring makes `authored <= file` an invariant of every measured length, so
 * watching to the end always satisfies the gate. It gives away at most one
 * second of required watching, which on a 25-minute lecture is nothing and errs
 * in the only safe direction: a gate a fraction short is invisible, a gate a
 * fraction long is a physician who cannot finish their Fortbildung.
 *
 * ## What is not a length
 *
 * A live stream reports `Infinity`; a manifest whose header has not arrived
 * reports `NaN`. Neither is a length. Nor is anything under a second — that is
 * not a lesson, and reporting it unmeasurable leaves the editable field and its
 * explanation rather than storing a `0` that `contentProblems` would refuse at
 * publish time with a less useful message.
 *
 * Separated from the probe because the probe needs a real media pipeline and
 * this needs none. The decision is the part worth testing, and jsdom cannot
 * exercise it through a `<video>`.
 */
export function durationFromMetadata(seconds: number): number | undefined {
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  const floored = Math.floor(seconds);
  return floored >= 1 ? floored : undefined;
}

export async function probeDurationSec(url: string): Promise<number | undefined> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    let settled = false;

    const finish = (value: number | undefined) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Detach the source before dropping the element: a `<video>` left with a
      // live `src` keeps its network request open in Safari.
      video.removeAttribute("src");
      video.load();
      resolve(value);
    };

    const timer = setTimeout(() => finish(undefined), PROBE_TIMEOUT_MS);

    video.preload = "metadata";
    // Anonymous rather than absent: without it a cross-origin file loads but
    // the page may not read from it, and the failure would be silent.
    video.crossOrigin = "anonymous";
    video.muted = true;

    video.addEventListener("loadedmetadata", () => {
      finish(durationFromMetadata(video.duration));
    });
    video.addEventListener("error", () => finish(undefined));

    video.src = url;
  });
}
