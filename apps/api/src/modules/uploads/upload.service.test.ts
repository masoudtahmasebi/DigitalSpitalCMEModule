/**
 * The media library, at the moment a file enters it (P81-02).
 *
 * ## Why these four cases and not a round-trip
 *
 * The library's whole value is that a file uploaded once can be found later.
 * That depends on exactly one thing happening at exactly one moment — a
 * verified upload writing a row — and on three properties of that write which
 * are easy to get wrong and invisible when they are:
 *
 *   * it uses the **author's** filename, because a list of `video-9f2c….mp4`
 *     is a list nobody can read;
 *   * it does not fail the upload when it fails, because the object is in the
 *     bucket and the reference is valid whether or not we managed to index it;
 *   * and it does not fail **silently**, because "the library is empty" and
 *     "indexing has been broken for a month" look identical from a screen.
 *
 * The last is why `UploadService` takes a logger rather than swallowing.
 */

import { describe, expect, it, vi } from "vitest";

import type {
  LibraryEntry,
  StorageAuditPort,
  UploadRepositoryPort,
} from "./upload.repository.js";
import { UploadService } from "./upload.service.js";

const CUSTOMER = "11111111-0000-4000-8000-000000000001";
const USER = "22222222-0000-4000-8000-000000000002";
const COURSE = "33333333-0000-4000-8000-000000000003";
const KEY = `${CUSTOMER}/courses/${COURSE}/video-9f2c3d.mp4`;
const REFERENCE = `s3://${KEY}`;

const NOW = new Date("2026-08-17T10:00:00Z");

function harness(
  overrides: {
    rememberAsset?: (entry: LibraryEntry) => Promise<void>;
    listAssets?: UploadRepositoryPort["listAssets"];
    findAsset?: UploadRepositoryPort["findAsset"];
    describeAsset?: UploadRepositoryPort["describeAsset"];
    countAssetUses?: UploadRepositoryPort["countAssetUses"];
    countUsesFor?: UploadRepositoryPort["countUsesFor"];
    forgetAsset?: UploadRepositoryPort["forgetAsset"];
  } = {},
) {
  const remembered: LibraryEntry[] = [];

  const repository: UploadRepositoryPort = {
    findCourseId: async () => COURSE,
    findMint: async () => ({ courseId: COURSE, sizeBytes: 1024, mimeType: "video/mp4" }),
    listAssets: overrides.listAssets ?? (async () => []),
    // Not exercised by the cases in this file; declared so the port stays
    // whole rather than cast away, which is what keeps a new method from
    // silently going untested everywhere at once.
    findAsset: overrides.findAsset ?? (async () => undefined),
    describeAsset: overrides.describeAsset ?? (async () => false),
    countAssetUses: overrides.countAssetUses ?? (async () => 0),
    // The page-wide count behind `usedByCount` (P88-01). Empty by default,
    // which the service reads as zero uses for every row.
    countUsesFor: overrides.countUsesFor ?? (async () => new Map()),
    forgetAsset: overrides.forgetAsset ?? (async () => false),
    rememberAsset:
      overrides.rememberAsset ??
      (async (entry) => {
        remembered.push(entry);
      }),
  };

  const audit: StorageAuditPort = { record: async () => undefined };

  const storage = {
    verifyUpload: async () => ({
      ok: true as const,
      upload: {
        key: KEY,
        reference: REFERENCE,
        sizeBytes: 1024,
        contentType: "video/mp4",
      },
    }),
  };

  const warn = vi.fn();

  const service = new UploadService(
    repository,
    audit,
    storage as unknown as ConstructorParameters<typeof UploadService>[2],
    { warn },
  );

  return { service, remembered, warn };
}

const ACTOR = { customerId: CUSTOMER, userId: USER };

describe("complete", () => {
  it("remembers the file under the name the author gave it", async () => {
    const { service, remembered } = harness();

    await service.complete(
      "adhs",
      { key: KEY, fileName: "Intro Modul 1.mp4" },
      ACTOR,
      NOW,
    );

    expect(remembered).toHaveLength(1);
    expect(remembered[0]).toMatchObject({
      customerId: CUSTOMER,
      storageKey: REFERENCE,
      fileName: "Intro Modul 1.mp4",
      mimeType: "video/mp4",
      byteSize: 1024,
      uploadedBy: USER,
    });
  });

  it("falls back to the key's own last segment when no name was sent", async () => {
    // An older console, or a client that does not bother. Less friendly than
    // the author's own name and still better than a blank row.
    const { service, remembered } = harness();

    await service.complete("adhs", { key: KEY }, ACTOR, NOW);

    expect(remembered[0]?.fileName).toBe("video-9f2c3d.mp4");
  });

  it("stores the size and type the bucket reported, not what was requested", async () => {
    // The same rule the verification itself follows: the client must not get to
    // choose both sides. A library that recorded the declared type would
    // disagree with the object it points at.
    const { service, remembered } = harness();

    await service.complete("adhs", { key: KEY, fileName: "x.mp4" }, ACTOR, NOW);

    expect(remembered[0]?.mimeType).toBe("video/mp4");
    expect(remembered[0]?.byteSize).toBe(1024);
  });

  it("still confirms the upload when the library write fails, and says so", async () => {
    /*
     * The object is in the bucket and the reference is valid. Failing the
     * request here would tell an author their upload did not work when it did,
     * and they would upload it again — which is the exact duplication the
     * library exists to prevent.
     *
     * The `warn` assertion is the other half: a bare `catch {}` would make
     * months of broken indexing indistinguishable from a customer who has not
     * uploaded anything.
     */
    const { service, warn } = harness({
      rememberAsset: async () => {
        throw new Error('relation "media_assets" does not exist');
      },
    });

    const result = await service.complete("adhs", { key: KEY }, ACTOR, NOW);

    expect(result.reference).toBe(REFERENCE);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("media library");
  });
});

describe("list", () => {
  it("hands the console a reference it can store, and the filter it asked for", async () => {
    const listAssets = vi.fn(async () => [
      {
        id: "aaaaaaaa-0000-4000-8000-00000000000a",
        storageKey: REFERENCE,
        fileName: "Intro Modul 1.mp4",
        mimeType: "video/mp4",
        byteSize: 1024,
        title: null,
        altText: null,
        createdAt: NOW,
      },
    ]);

    const { service } = harness({ listAssets });

    const rows = await service.list({ kind: "video", limit: 20 });

    expect(listAssets).toHaveBeenCalledWith({ kind: "video", limit: 20 });
    expect(rows[0]?.reference).toBe(REFERENCE);
    // The same string `complete` returned, so reusing a file is assigning this
    // to a content's field and nothing else.
    expect(rows[0]?.createdAt).toBe(NOW.toISOString());
    // Never set is `null`, not `""`: an empty alt claims the image is
    // decorative, and the console has to be able to tell the difference.
    expect(rows[0]?.altText).toBeNull();
  });
});

describe("forget", () => {
  it("refuses while a course content still points at the file, and says how many", async () => {
    /*
     * The content would keep rendering it — the object is still in the bucket —
     * while the operator lost the only place the file is listed and described,
     * having been told it was deleted. The count is in the message because that
     * is what somebody needs in order to go and unpick it.
     */
    const forgetAsset = vi.fn(async () => true);
    const { service } = harness({
      findAsset: async () => ({
        id: "a",
        storageKey: REFERENCE,
        fileName: "x.mp4",
        mimeType: "video/mp4",
        byteSize: 1,
        title: null,
        altText: null,
        createdAt: NOW,
      }),
      countAssetUses: async () => 2,
      forgetAsset,
    });

    /*
     * `clientDetail`, not `message`. `AppError` keeps the technical reason for
     * logs and the German for the operator, and it is the German that has to
     * carry the count — asserting on `message` would pass while the screen
     * showed something nobody can act on.
     */
    await expect(service.forget("a", ACTOR)).rejects.toMatchObject({
      kind: "conflict",
      clientDetail: expect.stringContaining("2 Inhalten"),
    });
    expect(forgetAsset).not.toHaveBeenCalled();
  });

  it("forgets an unused entry", async () => {
    // The control: without it the refusal above would pass on a method that
    // refused everything.
    const forgetAsset = vi.fn(async () => true);
    const { service } = harness({
      findAsset: async () => ({
        id: "a",
        storageKey: REFERENCE,
        fileName: "x.mp4",
        mimeType: "video/mp4",
        byteSize: 1,
        title: null,
        altText: null,
        createdAt: NOW,
      }),
      countAssetUses: async () => 0,
      forgetAsset,
    });

    await service.forget("a", ACTOR);
    expect(forgetAsset).toHaveBeenCalledWith("a");
  });

  it("answers the same for an unknown id and another customer's file", async () => {
    // Distinguishing them would confirm that somebody else's file exists
    // (§9.5).
    const { service } = harness({ findAsset: async () => undefined });
    await expect(service.forget("a", ACTOR)).rejects.toThrow(/not visible in tenant/u);
  });
});
