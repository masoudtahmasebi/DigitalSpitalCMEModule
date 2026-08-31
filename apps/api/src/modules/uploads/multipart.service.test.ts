/**
 * The security properties of the multipart path (P129-04).
 *
 * `signParts` is the endpoint worth testing hardest, and it is new in kind: it
 * is the only route in the platform that mints capabilities **repeatedly** for
 * an upload already in flight. A single PUT is authorised once and then either
 * happens or does not; a 5 GiB upload asks for signatures thirty times over an
 * hour, and the client holds the `uploadId` between those calls.
 *
 * So the question each case asks is the same one: *what stops this call from
 * being the one that signs something it should not?* Three answers, and none of
 * them may be skippable, because "we checked at `begin`" is not a property the
 * later calls can rely on.
 */

import { describe, expect, it, vi } from "vitest";
import type { StorageAuditPort, UploadRepositoryPort } from "./upload.repository.js";
import { UploadService } from "./upload.service.js";

const CUSTOMER = "11111111-0000-4000-8000-000000000001";
const OTHER_CUSTOMER = "99999999-0000-4000-8000-000000000009";
const COURSE = "33333333-0000-4000-8000-000000000003";
const USER = "22222222-0000-4000-8000-000000000002";

/** 96 parts at 32 MiB — the client's own 3 GB lecture. */
const SIZE = 3 * 1024 * 1024 * 1024;
const KEY = `${CUSTOMER}/courses/${COURSE}/video-9f2c3d.mp4`;
const NOW = new Date("2026-08-31T10:00:00Z");
const ACTOR = { customerId: CUSTOMER, userId: USER };

function harness(
  options: {
    findMint?: UploadRepositoryPort["findMint"];
    storage?: Partial<Record<string, unknown>>;
  } = {},
) {
  const audited: string[] = [];

  const repository = {
    findCourseId: async () => COURSE,
    findMint:
      options.findMint ??
      (async () => ({ courseId: COURSE, sizeBytes: SIZE, mimeType: "video/mp4" })),
    listAssets: async () => [],
    findAsset: async () => undefined,
    describeAsset: async () => false,
    countAssetUses: async () => 0,
    countUsesFor: async () => new Map(),
    forgetAsset: async () => false,
    rememberAsset: async () => undefined,
  } as unknown as UploadRepositoryPort;

  const audit: StorageAuditPort = {
    record: async (event) => {
      audited.push(`${event.action}:${event.detail ?? ""}`);
    },
  };

  const signParts = vi.fn(
    (_key: string, _uploadId: string, partNumbers: readonly number[], now: Date) => ({
      parts: partNumbers.map((partNumber) => ({
        partNumber,
        url: `https://bucket.test/part/${String(partNumber)}`,
      })),
      expiresAt: new Date(now.getTime() + 600_000),
    }),
  );

  const storage = {
    plan: () => ({
      ok: true,
      purpose: "video",
      mimeType: "video/mp4",
      sizeBytes: SIZE,
      extension: "mp4",
    }),
    signParts,
    listParts: async () => ({
      ok: true,
      parts: [{ partNumber: 1, etag: '"a"', sizeBytes: 1 }],
    }),
    completeMultipart: async () => ({ ok: true }),
    abortMultipart: vi.fn(async () => ({ ok: true })),
    verifyUpload: async () => ({
      ok: true,
      upload: {
        key: KEY,
        reference: `s3://${KEY}`,
        sizeBytes: SIZE,
        contentType: "video/mp4",
      },
    }),
    ...options.storage,
  };

  const service = new UploadService(
    repository,
    audit,
    storage as unknown as ConstructorParameters<typeof UploadService>[2],
    { warn: vi.fn() },
  );

  return { service, storage, signParts, audited };
}

describe("signParts — the tenant boundary", () => {
  it("refuses a key outside the caller's prefix without asking the bucket", async () => {
    /*
     * The cheapest check, and it must come first: another customer's key is
     * answered from the string alone, with no database round trip and no
     * request to the store. It is also answered as *not found* rather than
     * *forbidden* — distinguishing the two would confirm that somebody else's
     * object exists (§9.5).
     */
    const { service, signParts } = harness();
    const foreign = `${OTHER_CUSTOMER}/courses/${COURSE}/video-aaaa.mp4`;

    await expect(
      service.signParts(
        "slug",
        { key: foreign, uploadId: "u1", partNumbers: [1] },
        ACTOR,
        NOW,
      ),
    ).rejects.toMatchObject({ kind: "not_found" });

    expect(signParts, "nothing was signed").not.toHaveBeenCalled();
  });

  it("refuses a key inside the prefix that we never minted", async () => {
    /*
     * The prefix check alone is not enough. A caller who knows their own
     * customer id can construct a well-formed key for an object that was never
     * approved — `findMint` runs under RLS and is what turns "looks like mine"
     * into "was issued to me".
     */
    const { service, signParts } = harness({ findMint: async () => undefined });

    await expect(
      service.signParts(
        "slug",
        { key: KEY, uploadId: "u1", partNumbers: [1] },
        ACTOR,
        NOW,
      ),
    ).rejects.toMatchObject({ kind: "not_found" });

    expect(signParts, "nothing was signed").not.toHaveBeenCalled();
  });
});

describe("signParts — the capability ceiling", () => {
  it("refuses a part number outside the recorded plan", async () => {
    /*
     * The plan comes from the size the server **approved**, never from this
     * request. A 3 GB upload is 96 parts; asking for part 9,000 is asking for a
     * capability that should not exist, and the bucket would create it happily.
     */
    const { service, signParts } = harness();

    await expect(
      service.signParts(
        "slug",
        { key: KEY, uploadId: "u1", partNumbers: [1, 9000] },
        ACTOR,
        NOW,
      ),
    ).rejects.toMatchObject({ kind: "validation" });

    expect(signParts, "not even the valid part was signed").not.toHaveBeenCalled();
  });

  it("signs exactly the parts asked for, and no more", async () => {
    const { service, signParts } = harness();

    const result = await service.signParts(
      "slug",
      { key: KEY, uploadId: "u1", partNumbers: [4, 5, 6] },
      ACTOR,
      NOW,
    );

    expect(result.parts.map((part) => part.partNumber)).toEqual([4, 5, 6]);
    expect(signParts).toHaveBeenCalledTimes(1);
  });

  it("records a refusal without echoing the numbers back", async () => {
    // §9.5: an error names the field, never the value. The audit detail is
    // written by us and is not a place to reflect a request.
    const { service, audited } = harness();

    await service
      .signParts("slug", { key: KEY, uploadId: "u1", partNumbers: [9000] }, ACTOR, NOW)
      .catch(() => undefined);

    expect(audited.join(" ")).toContain("refuse");
    expect(audited.join(" "), "the rejected number is not echoed").not.toContain("9000");
  });
});

describe("completeMultipart", () => {
  it("verifies the assembled object against the recorded mint", async () => {
    // The same verification a single PUT goes through. An assembly that
    // produced the wrong size is refused for the same reason a short upload is:
    // the reference this returns is what a course will point at.
    const verifyUpload = vi.fn(async () => ({
      ok: false as const,
      refusal: { kind: "unreachable" as const, reason: "size mismatch" },
    }));
    const { service } = harness({ storage: { verifyUpload } });

    await expect(
      service.completeMultipart("slug", { key: KEY, uploadId: "u1" }, ACTOR, NOW),
    ).rejects.toMatchObject({ kind: "validation" });

    expect(verifyUpload).toHaveBeenCalled();
  });

  it("gives the storage back when assembly fails", async () => {
    /*
     * A failed assembly leaves every part behind — billed, and invisible to any
     * object listing (P129-03). The lifecycle rule reaches them in a day; this
     * reaches them now.
     */
    const abortMultipart = vi.fn(async () => ({ ok: true }));
    const { service } = harness({
      storage: {
        completeMultipart: async () => ({
          ok: false,
          refusal: { kind: "unreachable", reason: "InvalidPart" },
        }),
        abortMultipart,
      },
    });

    await expect(
      service.completeMultipart("slug", { key: KEY, uploadId: "u1" }, ACTOR, NOW),
    ).rejects.toMatchObject({ kind: "upstream_unavailable" });

    expect(abortMultipart, "the parts were released").toHaveBeenCalled();
  });

  it("refuses a foreign key before touching the bucket", async () => {
    const listParts = vi.fn();
    const { service } = harness({ storage: { listParts } });

    await expect(
      service.completeMultipart(
        "slug",
        { key: `${OTHER_CUSTOMER}/courses/${COURSE}/x.mp4`, uploadId: "u1" },
        ACTOR,
        NOW,
      ),
    ).rejects.toMatchObject({ kind: "not_found" });

    expect(listParts).not.toHaveBeenCalled();
  });
});
