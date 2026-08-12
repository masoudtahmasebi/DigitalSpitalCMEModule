/**
 * Does this course's media host actually let a browser seek? (P62-03)
 *
 * ## The failure this exists to name
 *
 * A media host that does not answer `Range` with `206` leaves the browser
 * unable to seek at all. The playhead snaps back — which is **exactly** what
 * the anti-skip gate does when a learner drags past what they have watched.
 *
 * Two causes, one symptom, and the wrong one is the one people assume: the
 * player has "Vorspulen ist nicht möglich" on screen, so a misconfigured server
 * reads as a working feature. Section 9 lost an hour to it with the evidence in
 * front of it. Nothing in the product could have told the difference, because
 * nothing had ever asked the host a question.
 *
 * So this asks: one byte, one `Range` header, per distinct source URL.
 *
 * ## Why an admin route and not a startup check
 *
 * Media URLs are per course and are edited by authors, so "at startup" is the
 * wrong moment — the URL that breaks is the one somebody pastes on a Tuesday.
 * And the answer names a URL, which §9.5 keeps away from a learner and §9.10
 * says belongs with the audience already entitled to it: an operator.
 *
 * ## Why it does not refuse a publish
 *
 * Deliberately. A host can be reachable at publish time and unreachable an hour
 * later; a check that gated publishing would imply a guarantee it cannot make,
 * and would block an author whose CDN is briefly slow. It reports. The
 * publish-time guarantee is P62-02, and it is about fields, which do not move.
 */

import { isStorageReference } from "@ds/domain";

/** One byte. The question is whether the server understands the header. */
const PROBE_RANGE = "bytes=0-0";

/** Long enough for a CDN cold start; short enough that a wedged host cannot hold a request. */
const TIMEOUT_MS = 8_000;

export type MediaCheckVerdict =
  /** `206` with a `Content-Range` — a browser can seek. */
  | "seekable"
  /** Answered, but with `200` or no `Content-Range`: seeking will not work. */
  | "no_range"
  /** Answered with an error status. */
  | "unreachable"
  /** DNS, TLS, connection refused, timeout. */
  | "failed"
  /**
   * An `s3://` reference. Signed at read time by the API, so the question does
   * not apply — and probing it would mean minting a signature to throw away.
   */
  | "signed_by_us";

export interface MediaCheckResult {
  readonly url: string;
  readonly verdict: MediaCheckVerdict;
  /** The HTTP status, when there was one. */
  readonly status?: number;
  /** A short technical reason written by us. Never a server's body. */
  readonly detail?: string;
}

export class MediaCheckService {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  /**
   * Probe every distinct URL, in order, and say what each one did.
   *
   * Distinct because a five-module course usually points at one host, and
   * asking it five times tells nobody anything new. Order preserved so the
   * report reads like the course.
   */
  async check(urls: readonly string[]): Promise<readonly MediaCheckResult[]> {
    const seen = new Set<string>();
    const results: MediaCheckResult[] = [];

    for (const url of urls) {
      if (seen.has(url)) continue;
      seen.add(url);
      results.push(await this.probe(url));
    }

    return results;
  }

  private async probe(url: string): Promise<MediaCheckResult> {
    if (isStorageReference(url)) {
      // The API signs these itself and the bucket is S3-compatible, which is
      // to say Range-capable by definition. Probing would mint a signature
      // for no answer.
      return { url, verdict: "signed_by_us" };
    }

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "GET",
        headers: { range: PROBE_RANGE },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      return {
        url,
        verdict: "failed",
        // The error's class, not its message: a fetch failure can quote a URL
        // with a query string, and some of ours are signed.
        detail: error instanceof Error ? error.name : "unknown",
      };
    }

    if (response.status === 206 && response.headers.get("content-range") !== null) {
      return { url, verdict: "seekable", status: 206 };
    }

    // A `200` here is the whole point: the server ignored the header and sent
    // the entire file, which is what a browser sees as "cannot seek".
    if (response.ok) {
      return {
        url,
        verdict: "no_range",
        status: response.status,
        detail:
          response.status === 200
            ? "answered 200 and ignored the Range header"
            : "answered without a Content-Range",
      };
    }

    return { url, verdict: "unreachable", status: response.status };
  }
}

/** True when every probed source can be sought. Empty counts as fine. */
export function allSeekable(results: readonly MediaCheckResult[]): boolean {
  return results.every(
    (result) => result.verdict === "seekable" || result.verdict === "signed_by_us",
  );
}
