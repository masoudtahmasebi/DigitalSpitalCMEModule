/**
 * The S3 operations backups need, and only those (P23-03). Infrastructure.
 *
 * `ObjectStorage` (shared/) is the upload path's view of a bucket: mint, verify,
 * discard. It cannot list and it cannot copy, and it should not — the code that
 * runs on every author's upload has no business enumerating a whole bucket.
 * This is the operator's view, and it is used by exactly one process that runs
 * on a timer with credentials the API container does not hold.
 *
 * ## Why the XML is parsed with two regular expressions
 *
 * `ListObjectsV2` answers in XML, and the answer this needs from it is a list
 * of `<Key>` elements plus one continuation token. An XML parser is a
 * dependency, a parser configuration, and an entity-expansion surface, for a
 * document we produced the request for and whose shape is fixed by the S3 API.
 * The keys are XML-escaped on the way out and unescaped here for the five
 * entities the specification defines; anything else in a key would already have
 * been refused by `courseAssetKey`.
 *
 * If this ever needs the rest of a listing — sizes, etags, versions — it should
 * grow a real parser rather than a third regular expression.
 */

import { createHash } from "node:crypto";
import { withDeadline, TRANSFER_DEADLINE_MS } from "../shared/deadline-fetch.js";
import { openAsBlob } from "node:fs";
import type { S3Presigner } from "../shared/s3-presigner.js";

/** Long enough for a multi-gigabyte server-side copy; still an expiry. */
const OPERATION_TTL_SEC = 900;

export class ObjectStoreError extends Error {
  constructor(operation: string, status: number | string) {
    // Never the URL: it carries a signature, and this message reaches a log.
    super(`object storage refused ${operation} (${status})`);
    this.name = "ObjectStoreError";
  }
}

export class BackupStore {
  constructor(
    private readonly presigner: S3Presigner,
    /*
     * A deadline by default (P144-01).
     *
     * These hold no database connection, so they cannot take the API down —
     * the failure is quieter and, for a backup, not much better: a job that
     * hangs finishes never, reports nothing, and pings no heartbeat. P140's
     * watchdog notices the *absence* of a successful run; this is what makes
     * an unreachable bucket produce one.
     */
    private readonly fetchImpl: typeof fetch = withDeadline(),
  ) {}

  /**
   * Every key under a prefix, following continuation tokens to the end.
   *
   * Deliberately not a generator. Every caller here needs the whole list before
   * it can decide anything — retention compares keys against each other, and the
   * mirror needs a set to test membership — so streaming would only move the
   * accumulation into each caller.
   */
  async list(prefix: string, now: Date): Promise<string[]> {
    const keys: string[] = [];
    let token: string | undefined;

    do {
      const response = await this.fetchImpl(
        this.presigner.presignList(prefix, token, OPERATION_TTL_SEC, now),
      );
      if (!response.ok) throw new ObjectStoreError("list", response.status);

      const xml = await response.text();
      for (const match of xml.matchAll(/<Key>([^<]*)<\/Key>/g)) {
        keys.push(unescapeXml(match[1] ?? ""));
      }

      const next = /<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(xml);
      token = next === null ? undefined : unescapeXml(next[1] ?? "");

      // A truncated listing with no token would loop for ever. Treating it as
      // the end is wrong in a different way — a partial list drives a retention
      // decision — so it is an error.
      if (/<IsTruncated>true<\/IsTruncated>/.test(xml) && token === undefined) {
        throw new ObjectStoreError("list", "truncated with no continuation token");
      }
    } while (token !== undefined);

    return keys;
  }

  /**
   * Upload a file from disk.
   *
   * `openAsBlob` rather than a stream: a Blob carries its own size, so `fetch`
   * sends a real `Content-Length` instead of chunked encoding, which S3 does
   * not accept for a plain PUT. It streams from disk either way — the file is
   * never held in memory, which matters when it is a database dump.
   */
  async putFile(key: string, path: string, now: Date): Promise<void> {
    const body = await openAsBlob(path, { type: "application/octet-stream" });
    const response = await this.fetchImpl(
      this.presigner.presignPutStream(key, OPERATION_TTL_SEC, now),
      // The dump itself goes up this call, so it gets the transfer budget
      // rather than the control one.
      { method: "PUT", body, signal: AbortSignal.timeout(TRANSFER_DEADLINE_MS) },
    );

    if (!response.ok) throw new ObjectStoreError("put", response.status);
  }

  /** The object's size, or undefined when it is not there. */
  async size(key: string, now: Date): Promise<number | undefined> {
    const response = await this.fetchImpl(
      this.presigner.presignHead(key, OPERATION_TTL_SEC, now),
      { method: "HEAD" },
    );

    if (response.status === 404) return undefined;
    if (!response.ok) throw new ObjectStoreError("head", response.status);

    const length = Number(response.headers.get("content-length"));
    return Number.isSafeInteger(length) ? length : undefined;
  }

  async remove(key: string, now: Date): Promise<void> {
    const response = await this.fetchImpl(
      this.presigner.presignDelete(key, OPERATION_TTL_SEC, now),
      { method: "DELETE" },
    );

    // 404 is success: the object we wanted gone is gone. Anything else is not.
    if (!response.ok && response.status !== 404) {
      throw new ObjectStoreError("delete", response.status);
    }
  }

  /** Server-side copy. The bytes never reach this process. */
  async copyFrom(
    sourceBucket: string,
    sourceKey: string,
    destinationKey: string,
    now: Date,
  ): Promise<void> {
    const copy = this.presigner.presignCopy(
      destinationKey,
      sourceBucket,
      sourceKey,
      OPERATION_TTL_SEC,
      now,
    );
    // The headers come back with the URL rather than being written again here:
    // `x-amz-copy-source` is a *signed* header, so a second spelling of it
    // would be a 403 that reads like a credential problem.
    const response = await this.fetchImpl(copy.url, {
      method: "PUT",
      headers: copy.headers,
    });

    if (!response.ok) throw new ObjectStoreError("copy", response.status);

    // S3 answers a failed copy with **200 and an error document**, which is the
    // single most notorious trap in the API: a caller that checks only the
    // status records a copy that did not happen. The success body contains
    // `<CopyObjectResult>`; an error body contains `<Error>`.
    const body = await response.text();
    if (!body.includes("<CopyObjectResult")) {
      const code = /<Code>([^<]*)<\/Code>/.exec(body)?.[1] ?? "unknown";
      throw new ObjectStoreError("copy", `200 with an error document: ${code}`);
    }
  }
}

/** SHA-256 of a file, streamed. Recorded so a restore can be checked. */
export async function fileDigest(path: string): Promise<string> {
  const { createReadStream } = await import("node:fs");
  const hash = createHash("sha256");

  await new Promise<void>((resolve, reject) => {
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", resolve);
  });

  return hash.digest("hex");
}

/** The five entities S3 escapes in a key. */
function unescapeXml(value: string): string {
  return (
    value
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">")
      .replaceAll("&quot;", '"')
      .replaceAll("&apos;", "'")
      // Last, or an escaped `&amp;lt;` would be unescaped twice.
      .replaceAll("&amp;", "&")
  );
}
