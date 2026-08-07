/**
 * The operator's view of a bucket, against one that verifies the signature.
 *
 * `retention.test.ts` covers what to delete. This covers the two operations
 * that decide whether that policy is applied to reality or to a partial
 * listing, plus the one S3 behaviour that has cost more people more data than
 * any other: a failed copy that answers **200**.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startFakeS3, type FakeS3 } from "../../test/support/fake-s3.js";
import { S3Presigner } from "../shared/s3-presigner.js";
import { BackupStore, ObjectStoreError } from "./store.js";

const NOW = new Date("2026-08-07T03:00:00.000Z");

let bucket: FakeS3;
let store: BackupStore;

beforeEach(async () => {
  bucket = await startFakeS3();
  store = new BackupStore(
    new S3Presigner({
      endpoint: bucket.endpoint,
      region: bucket.region,
      bucket: bucket.bucket,
      accessKeyId: bucket.accessKeyId,
      secretAccessKey: bucket.secretAccessKey,
      forcePathStyle: true,
    }),
  );
});

afterEach(async () => {
  await bucket.close();
});

function seed(...keys: string[]): void {
  for (const key of keys) {
    bucket.objects.set(key, {
      body: Buffer.from(key),
      contentType: "application/octet-stream",
    });
  }
}

describe("listing", () => {
  it("returns the keys under a prefix and nothing else", async () => {
    seed("backups/database/a.dump.enc", "backups/objects/x.mp4", "other/y.mp4");

    expect(await store.list("backups/database/", NOW)).toEqual([
      "backups/database/a.dump.enc",
    ]);
  });

  it("is empty for a prefix with nothing under it", async () => {
    expect(await store.list("backups/", NOW)).toEqual([]);
  });

  it("follows continuation tokens to the end", async () => {
    // A retention decision taken over the first page only would delete against
    // a list that is missing everything after it — which is both wrong and
    // silent, since a short list looks exactly like a small bucket.
    const keys = Array.from(
      { length: 2500 },
      (_, index) => `backups/database/${String(index).padStart(4, "0")}.dump.enc`,
    );
    seed(...keys);

    const listed = await store.list("backups/database/", NOW);

    expect(listed).toHaveLength(2500);
    expect([...listed].sort()).toEqual([...keys].sort());
  });

  it("unescapes the entities S3 escapes", async () => {
    seed("backups/objects/a&b.mp4", "backups/objects/c<d>.mp4");

    expect((await store.list("backups/objects/", NOW)).sort()).toEqual([
      "backups/objects/a&b.mp4",
      "backups/objects/c<d>.mp4",
    ]);
  });

  it("signs the listing, so a wrong prefix is a different signature", async () => {
    seed("backups/database/a.dump.enc");
    await store.list("backups/database/", NOW);

    // The fake refuses anything that does not verify; a listing that arrived is
    // a listing whose query parameters were part of the canonical request.
    expect(bucket.requests.at(-1)?.refusal).toBeUndefined();
    expect(bucket.requests.at(-1)?.status).toBe(200);
  });
});

describe("head and delete", () => {
  it("reports a stored object's size", async () => {
    seed("backups/database/a.dump.enc");
    expect(await store.size("backups/database/a.dump.enc", NOW)).toBe(
      "backups/database/a.dump.enc".length,
    );
  });

  it("reports nothing for an object that is not there", async () => {
    expect(await store.size("backups/database/missing", NOW)).toBeUndefined();
  });

  it("removes an object", async () => {
    seed("backups/database/a.dump.enc");
    await store.remove("backups/database/a.dump.enc", NOW);

    expect(bucket.objects.has("backups/database/a.dump.enc")).toBe(false);
  });

  it("treats deleting something already gone as success", async () => {
    // The object we wanted gone is gone. Failing here would turn a retried
    // prune into a job that can never finish.
    await expect(store.remove("backups/database/missing", NOW)).resolves.toBeUndefined();
  });
});

describe("server-side copy", () => {
  it("copies without the bytes passing through this process", async () => {
    seed("0198f4c1/courses/abc/video-1.mp4");

    await store.copyFrom(
      bucket.bucket,
      "0198f4c1/courses/abc/video-1.mp4",
      "backups/objects/0198f4c1/courses/abc/video-1.mp4",
      NOW,
    );

    expect(
      bucket.objects
        .get("backups/objects/0198f4c1/courses/abc/video-1.mp4")
        ?.body.toString(),
    ).toBe("0198f4c1/courses/abc/video-1.mp4");
    // No GET: the copy was server-side.
    expect(bucket.requests.some((r) => r.method === "GET")).toBe(false);
  });

  it("refuses a copy that answered 200 with an error document", async () => {
    // The trap. S3 streams a long copy and can only report a failure after the
    // headers are gone, so it puts the error in the body — and a caller that
    // checks `response.ok` records a backup that does not exist.
    await expect(
      store.copyFrom(bucket.bucket, "not-there", "backups/objects/not-there", NOW),
    ).rejects.toThrow(ObjectStoreError);

    expect(bucket.objects.has("backups/objects/not-there")).toBe(false);
    // Asserted, because the first version of this test passed on a 403 from a
    // signature bug and proved nothing about the error document at all.
    expect(bucket.requests.at(-1)?.status).toBe(200);
  });

  it("names no URL in its error, because a URL carries a signature", async () => {
    const error = await store
      .copyFrom(bucket.bucket, "not-there", "backups/objects/not-there", NOW)
      .then(() => undefined)
      .catch((thrown: unknown) => thrown as Error);

    expect(error).toBeInstanceOf(Error);
    expect(error?.message).not.toContain("X-Amz-Signature");
    expect(error?.message).not.toContain(bucket.secretAccessKey);
  });
});
