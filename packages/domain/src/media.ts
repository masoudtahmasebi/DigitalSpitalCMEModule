/**
 * Media sources — what a video content actually offers a browser (P5-12).
 *
 * ## Why a list and not a URL
 *
 * A single `video_url` assumes one file plays everywhere. It does not. An H.264
 * MP4 is the safe floor, but it is a single bitrate: a physician on a hospital
 * connection either buffers through a 25-minute lecture or watches a needlessly
 * large file. HLS fixes that and Safari plays it natively, while Chrome and
 * Firefox do not without a library. The web platform's own answer is several
 * `<source>` children, and the browser takes the first `type` it can play — so
 * the shape that fits is an **ordered list**, and the ordering is a real
 * decision rather than presentation.
 *
 * ## Why ordering lives here
 *
 * `orderSources` puts adaptive streams first. That is not a preference: a
 * `<source>` whose `type` the browser cannot play is skipped silently, so HLS
 * first means Safari gets adaptive bitrate and everything else falls through to
 * the progressive file with no detection code, no user agent sniffing and no
 * runtime branch. Getting the order backwards costs Safari its adaptive stream
 * and nothing visibly breaks, which is exactly the kind of bug that survives
 * review — hence a pure function with a test rather than a sorted literal in
 * JSX.
 *
 * ## What this does not do
 *
 * It does not decide whether a learner may see a source. Every URL here is
 * still resolved through the media resolver behind the sequence gate, and a
 * source list is only ever returned by an endpoint that has already agreed the
 * content is reachable. This module is arithmetic and validation over strings.
 */

/** One playable rendition of a content's media. */
export interface MediaSource {
  /** `https://…` on the customer's CDN, or `s3://<key>` in our storage. */
  readonly url: string;
  readonly mimeType: string;
  /** "720p", "Audio", … shown in the quality menu. Null when unlabelled. */
  readonly label: string | null;
}

export type StreamingKind = "hls" | "dash" | "progressive";

/**
 * The MIME types a source may declare.
 *
 * A closed list, because the value reaches a browser as a `type` attribute and
 * an author typing `video/mp4 ` or `mp4` would produce a source every browser
 * skips — a video that silently refuses to play, with nothing in the console
 * to explain it. Refusing at authoring time is the only point where the mistake
 * is cheap.
 */
export const MEDIA_MIME_TYPES: readonly string[] = [
  // Progressive.
  "video/mp4",
  "video/webm",
  "video/ogg",
  "audio/mpeg",
  "audio/mp4",
  "audio/ogg",
  // Adaptive. Both spellings of the HLS type are in the wild; Safari accepts
  // either, and rejecting one would refuse a correctly-configured CDN.
  "application/vnd.apple.mpegurl",
  "application/x-mpegurl",
  "application/dash+xml",
];

const HLS_TYPES = new Set(["application/vnd.apple.mpegurl", "application/x-mpegurl"]);

export function streamingKindOf(mimeType: string): StreamingKind {
  const normalised = mimeType.trim().toLowerCase();
  if (HLS_TYPES.has(normalised)) return "hls";
  if (normalised === "application/dash+xml") return "dash";
  return "progressive";
}

/**
 * Adaptive streams first, then progressive in the author's own order.
 *
 * The browser takes the first `type` it can play and skips the rest, so this
 * ordering is the whole of the format-negotiation logic: Safari matches the
 * HLS entry, Chrome and Firefox skip it and match the MP4. No detection, no
 * user-agent test, no fallback branch at runtime.
 *
 * Within each group the author's order is preserved rather than sorted by any
 * guess at quality — a label is free text, and inferring "720p beats 480p" from
 * it would be a parser that gets "Audio" wrong.
 *
 * Stable: equal-priority sources keep their relative positions, so re-rendering
 * cannot reshuffle the list under a playing element.
 */
export function orderSources(sources: readonly MediaSource[]): readonly MediaSource[] {
  const rank = (source: MediaSource): number =>
    streamingKindOf(source.mimeType) === "progressive" ? 1 : 0;

  return [...sources]
    .map((source, index) => ({ source, index }))
    .sort((a, b) => rank(a.source) - rank(b.source) || a.index - b.index)
    .map((entry) => entry.source);
}

/** True when at least one source is an adaptive stream. */
export function hasAdaptiveSource(sources: readonly MediaSource[]): boolean {
  return sources.some((source) => streamingKindOf(source.mimeType) !== "progressive");
}

export type MediaSourceProblem =
  "empty" | "blank_url" | "unknown_mime_type" | "duplicate_url";

export interface MediaSourceDraft {
  readonly url?: string | null | undefined;
  readonly mimeType?: string | null | undefined;
  readonly label?: string | null | undefined;
}

/**
 * What is wrong with an authored source list, if anything.
 *
 * `empty` is reported so the caller can decide: a **video** content with no
 * source is unplayable and must be refused, while a text content legitimately
 * has none. That decision belongs with the content's kind, which this function
 * deliberately does not take — it would then be two rules in one place, and the
 * kind-specific one already lives in `contentProblems`.
 *
 * `duplicate_url` matters more than it looks. The same file listed twice is
 * harmless to a browser but means the quality menu offers two identical
 * entries, and an author who meant to paste a second rendition has silently
 * shipped one. Cheap to catch, invisible otherwise.
 */
/**
 * The MIME type a file's own name implies (P79-01).
 *
 * ## Why the form stopped asking
 *
 * Every media form had a `Dateityp` field — a free-text box on materials and a
 * dropdown on video sources — and the client's objection is exactly right:
 * *"there is no need to set the type anywhere"*. The file already carries the
 * answer in its extension, the uploader already returns a content type, and a
 * person typing `application/pdf` next to a `.pdf` they just uploaded is doing
 * the computer's work and can only get it wrong.
 *
 * Getting it wrong is not cosmetic on a `<source>`: a `type` the browser does
 * not recognise makes it skip that rendition silently, so the video refuses to
 * play with nothing in the console to explain it.
 *
 * ## Undeclared is a legitimate answer
 *
 * Anything not listed returns `undefined`, and `undefined` means *do not put a
 * `type` attribute on the element at all* — which makes the browser sniff the
 * container, and is what it does perfectly well for ordinary files. That is the
 * "do not limit them" half of the same request: an unusual extension is no
 * longer refused at authoring time, it is simply not described.
 *
 * Extensions only, deliberately. Reading the bytes would mean fetching the file
 * on the authoring path, and the extension is what the storage layer named the
 * object by anyway.
 */
const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  // Progressive video and audio — the `<source type>` cases.
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  ogv: "video/ogg",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  oga: "audio/ogg",
  ogg: "audio/ogg",
  // Adaptive manifests. Both spellings of the HLS type are in the wild; this
  // emits the one the registry prefers and `streamingKindOf` accepts either.
  m3u8: "application/vnd.apple.mpegurl",
  mpd: "application/dash+xml",
  // Documents, for Mediathek materials.
  pdf: "application/pdf",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  zip: "application/zip",
  // Images, for posters.
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
  // Captions.
  vtt: "text/vtt",
  srt: "application/x-subrip",
};

export function mimeTypeForUrl(url: string | null | undefined): string | undefined {
  const trimmed = (url ?? "").trim();
  if (trimmed === "") return undefined;

  // Strip a query string and fragment before looking at the extension: a signed
  // URL carries `?X-Amz-…`, and `.mp4?sig=x` must still read as an mp4.
  const withoutQuery = trimmed.split("?")[0]?.split("#")[0] ?? "";
  const lastSlash = withoutQuery.lastIndexOf("/");
  const name = lastSlash === -1 ? withoutQuery : withoutQuery.slice(lastSlash + 1);

  const dot = name.lastIndexOf(".");
  if (dot === -1 || dot === name.length - 1) return undefined;

  return MIME_BY_EXTENSION[name.slice(dot + 1).toLowerCase()];
}

export function mediaSourceProblems(
  sources: readonly MediaSourceDraft[],
): readonly MediaSourceProblem[] {
  const problems = new Set<MediaSourceProblem>();

  if (sources.length === 0) problems.add("empty");

  const seen = new Set<string>();
  for (const source of sources) {
    const url = (source.url ?? "").trim();
    if (url === "") problems.add("blank_url");
    else if (seen.has(url)) problems.add("duplicate_url");
    else seen.add(url);

    /*
     * A **blank** type is fine now (P79-01).
     *
     * The console no longer asks for one — it derives it from the file, and
     * `mimeTypeForUrl` answers `undefined` for anything it does not recognise.
     * That `undefined` reaches the player as a `<source>` with no `type`
     * attribute, which makes the browser sniff the container. Refusing it here
     * would turn "we could not name this format" into "you may not use this
     * file", which is the limitation the client asked to have removed.
     *
     * A *stated* type nobody recognises is still a problem, and for the
     * original reason: the browser skips such a source silently, so the video
     * refuses to play with nothing to explain it. That can only arrive from
     * data written before this change or from an API caller that is not the
     * console.
     */
    const mimeType = (source.mimeType ?? "").trim().toLowerCase();
    if (mimeType !== "" && !MEDIA_MIME_TYPES.includes(mimeType)) {
      problems.add("unknown_mime_type");
    }
  }

  return [...problems];
}

/**
 * Read a source list out of whatever the database column held.
 *
 * The column is `jsonb`, so nothing in the type system guarantees its shape —
 * a hand-run migration, a restored dump or a seed script can put anything
 * there. Anything unrecognised is dropped rather than rendered: a malformed
 * entry becomes one missing rendition, not a `<source>` with `undefined` in its
 * `src`.
 */
export function parseMediaSources(value: unknown): readonly MediaSource[] {
  if (!Array.isArray(value)) return [];

  const sources: MediaSource[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;

    const url = typeof record["url"] === "string" ? record["url"].trim() : "";
    const mimeType =
      typeof record["mimeType"] === "string"
        ? record["mimeType"].trim().toLowerCase()
        : "";
    if (url === "" || !MEDIA_MIME_TYPES.includes(mimeType)) continue;

    const rawLabel = record["label"];
    const label =
      typeof rawLabel === "string" && rawLabel.trim() !== "" ? rawLabel.trim() : null;

    sources.push({ url, mimeType, label });
  }

  return sources;
}
