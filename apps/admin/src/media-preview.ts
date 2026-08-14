/**
 * Turning a stored reference into something this page can show (P74-03).
 *
 * ## Why the console cannot just render the value
 *
 * A content item's `videoUrl`, `posterUrl` or `fileUrl` holds one of two
 * things. An `https://…` a customer serves themselves is already loadable. An
 * `s3://<key>` is **not a URL**: it is a key in our storage, and the object
 * behind it answers 403 to anything without a signature the API minted.
 *
 * So the form could show a filename and nothing else, which is what the client
 * was looking at:
 *
 * > _"for here, can we have the preview of the video, and the preview of images
 * > uploaded?"_
 *
 * `adminViewUpload` mints a short-lived read URL for exactly one object of one
 * course. This module is the caching layer in front of it, so a form with a
 * video, a poster and a caption file does not ask three times per keystroke.
 *
 * ## Why the cache is keyed on the reference and holds an expiry
 *
 * The signature dies after ten minutes. A `<video>` still holding it then fails
 * to load on the next seek, which looks exactly like a broken upload — the
 * expensive kind of bug, because the author's conclusion is "the file did not
 * arrive". So an entry that is close to expiring is discarded and re-minted
 * rather than handed out.
 */

import { useEffect, useState } from "react";
import type { ApiClient } from "@ds/sdk";

/** Re-mint this long before the signature actually dies. */
const RENEW_MARGIN_MS = 60_000;

interface Entry {
  readonly url: string;
  readonly expiresAtMs: number;
}

/** One cache per console session. Keyed by reference, which is unique per object. */
const cache = new Map<string, Entry>();

/**
 * Requests that have not answered yet, keyed the same way.
 *
 * Without this the cache is useless in the case it exists for. A content form
 * mounts its video, poster and caption previews in the same tick, so a
 * resolved-value cache is still empty when the second and third look — three
 * signatures for what may be one object, and three rows in the storage audit
 * log. Sharing the promise makes the *first* asker the only asker.
 */
const inFlight = new Map<string, Promise<string | undefined>>();

/** Exported for tests: a cache that outlives a case is state that lies (§9.8). */
export function clearPreviewCache(): void {
  cache.clear();
  inFlight.clear();
}

export function isStorageReference(value: string): boolean {
  return value.startsWith("s3://");
}

/**
 * A URL a browser can load for this stored value, or `undefined`.
 *
 * `undefined` rather than a thrown error, and deliberately: a reference that
 * cannot be resolved is an ordinary state — the deployment may have no object
 * storage, the object may have been removed, the API may say no. Every caller
 * here is decorating a form, and none of them should fail a save because a
 * thumbnail could not be drawn.
 */
export async function readableUrl(
  client: ApiClient,
  courseSlug: string | undefined,
  value: string,
): Promise<string | undefined> {
  const trimmed = value.trim();
  if (trimmed === "") return undefined;

  // An ordinary URL is already readable. Not sent to the API: that route
  // refuses anything that is not ours, which is the right refusal — this is
  // simply not a question for it.
  if (!isStorageReference(trimmed)) {
    return /^https?:\/\//iu.test(trimmed) ? trimmed : undefined;
  }

  // No slug yet means a course that is still being created, so there is nothing
  // to resolve against and nothing has been uploaded either.
  if (courseSlug === undefined) return undefined;

  const now = Date.now();
  const hit = cache.get(trimmed);
  if (hit !== undefined && hit.expiresAtMs - RENEW_MARGIN_MS > now) return hit.url;

  const pending = inFlight.get(trimmed);
  if (pending !== undefined) return pending;

  const request = (async (): Promise<string | undefined> => {
    try {
      const view = await client.adminViewUpload(courseSlug, trimmed);
      const expiresAtMs = Date.parse(view.expiresAt);
      cache.set(trimmed, {
        url: view.url,
        // A server that sent an unparsable timestamp still gets a usable URL;
        // treating it as already expired would re-mint on every render instead.
        expiresAtMs: Number.isFinite(expiresAtMs) ? expiresAtMs : now + RENEW_MARGIN_MS,
      });
      return view.url;
    } catch {
      return undefined;
    } finally {
      // Cleared whichever way it went: a failure that stayed here would make
      // the refusal permanent for the rest of the session, so a preview that
      // failed once could never be retried by reopening the form.
      inFlight.delete(trimmed);
    }
  })();

  inFlight.set(trimmed, request);
  return request;
}

/** What a preview knows about itself while it is being worked out. */
export type ReadableUrl =
  | { readonly kind: "none" }
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly url: string }
  | { readonly kind: "failed" };

/**
 * `readableUrl` as a hook, with the two things a component needs from it.
 *
 * **It does not settle on a stale value.** The `cancelled` flag is not
 * defensive boilerplate: an author who removes one upload and adds another
 * within ten minutes has two requests in flight, and without it the slower one
 * wins and the form shows the file that was just deleted.
 *
 * **It says "failed" rather than staying blank.** A blank space where a video
 * should be is indistinguishable from a feature that was never built, which is
 * the §9.4 shape this whole ticket is about.
 */
export function useReadableUrl(
  client: ApiClient,
  courseSlug: string | undefined,
  value: string,
): ReadableUrl {
  const [state, setState] = useState<ReadableUrl>({ kind: "none" });

  useEffect(() => {
    if (value.trim() === "") {
      setState({ kind: "none" });
      return;
    }

    let cancelled = false;
    setState({ kind: "loading" });
    void readableUrl(client, courseSlug, value).then((url) => {
      if (cancelled) return;
      setState(url === undefined ? { kind: "failed" } : { kind: "ready", url });
    });

    return () => {
      cancelled = true;
    };
  }, [client, courseSlug, value]);

  return state;
}
