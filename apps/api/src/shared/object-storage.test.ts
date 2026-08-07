/**
 * The upload path, driven end to end against a bucket that checks the signature.
 *
 * `s3-presigner.test.ts` proves the arithmetic against AWS's published vector.
 * This proves the two things that vector cannot: that a PUT with **signed
 * headers** verifies at a server which recomputes from the request it received,
 * and that a mismatch between what we approved and what was stored is caught
 * and removed rather than stored.
 *
 * The fake bucket is a real HTTP server on a real socket, and it refuses a bad
 * signature the way Hetzner would — see `test/support/fake-s3.ts` for why it is
 * written from the specification rather than from the presigner.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startFakeS3, type FakeS3 } from "../../test/support/fake-s3.js";
import { ObjectStorage } from "./object-storage.js";
import { S3Presigner } from "./s3-presigner.js";

const NOW = new Date("2026-08-07T09:00:00.000Z");
const CUSTOMER = "0198f4c1-7a2e-7000-8000-000000000001";
const OTHER_CUSTOMER = "0198f4c1-7a2e-7000-8000-000000000002";
const COURSE = "0198f4c1-7a2e-7000-8000-0000000000aa";

let bucket: FakeS3;
let storage: ObjectStorage;

beforeEach(async () => {
  bucket = await startFakeS3();
  storage = new ObjectStorage(
    new S3Presigner({
      endpoint: bucket.endpoint,
      region: bucket.region,
      bucket: bucket.bucket,
      accessKeyId: bucket.accessKeyId,
      secretAccessKey: bucket.secretAccessKey,
      forcePathStyle: true,
    }),
    900,
  );
});

afterEach(async () => {
  await bucket.close();
});

function acceptedPlan(mimeType = "video/mp4", sizeBytes = 11) {
  const plan = storage.plan({ purpose: "video", mimeType, sizeBytes });
  if (!plan.ok) throw new Error(`expected an accepted plan, got ${plan.reason}`);
  return plan;
}

/** PUT the bytes the way a browser would: the ticket's headers, verbatim. */
async function upload(
  ticket: { url: string; headers: Readonly<Record<string, string>> },
  body: Buffer,
): Promise<Response> {
  return fetch(ticket.url, { method: "PUT", headers: ticket.headers, body });
}

describe("a minted ticket is accepted by a bucket that verifies it", () => {
  it("round-trips: PUT, then verify, then the object is readable", async () => {
    const body = Buffer.from("hello video");
    const ticket = storage.mint(
      acceptedPlan("video/mp4", body.byteLength),
      {
        customerId: CUSTOMER,
        courseId: COURSE,
      },
      NOW,
    );

    const put = await upload(ticket, body);
    expect(put.status, JSON.stringify(bucket.requests)).toBe(200);

    const verified = await storage.verifyUpload(
      ticket.key,
      { contentType: "video/mp4", sizeBytes: body.byteLength },
      NOW,
    );
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.upload.reference).toBe(`s3://${ticket.key}`);
      expect(verified.upload.sizeBytes).toBe(body.byteLength);
      expect(verified.upload.contentType).toBe("video/mp4");
    }
  });

  it("stores the content type we approved, because it is signed", async () => {
    const body = Buffer.from("hello video");
    const ticket = storage.mint(
      acceptedPlan("video/mp4", body.byteLength),
      {
        customerId: CUSTOMER,
        courseId: COURSE,
      },
      NOW,
    );

    await upload(ticket, body);

    // This is the whole reason binding the type into the signature is worth
    // anything: the object is served back as the type we allowed, not as
    // whatever the uploader would have preferred.
    expect(bucket.objects.get(ticket.key)?.contentType).toBe("video/mp4");
  });

  it("signs content-type, content-length and host, and nothing else", async () => {
    const ticket = storage.mint(
      acceptedPlan(),
      {
        customerId: CUSTOMER,
        courseId: COURSE,
      },
      NOW,
    );

    expect(new URL(ticket.url).searchParams.get("X-Amz-SignedHeaders")).toBe(
      "content-length;content-type;host",
    );
  });
});

describe("the signature is a constraint, not a decoration", () => {
  it("refuses a body of a different length", async () => {
    // The browser computes Content-Length from the body and script cannot set
    // it, so a client that declared 11 bytes and sends 12 produces a request
    // the bucket will not verify. That is the size limit's real enforcement.
    const ticket = storage.mint(
      acceptedPlan("video/mp4", 11),
      {
        customerId: CUSTOMER,
        courseId: COURSE,
      },
      NOW,
    );

    const put = await upload(ticket, Buffer.from("hello videos"));

    expect(put.status).toBe(403);
    expect(bucket.objects.has(ticket.key)).toBe(false);
    expect(bucket.requests.at(-1)?.refusal).toBe("signature does not match");
  });

  it("refuses a different content type", async () => {
    const body = Buffer.from("hello video");
    const ticket = storage.mint(
      acceptedPlan("video/mp4", body.byteLength),
      {
        customerId: CUSTOMER,
        courseId: COURSE,
      },
      NOW,
    );

    const put = await fetch(ticket.url, {
      method: "PUT",
      headers: { "Content-Type": "text/html" },
      body,
    });

    expect(put.status).toBe(403);
    expect(bucket.objects.has(ticket.key)).toBe(false);
  });

  it("refuses a PUT to a key other than the one signed", async () => {
    const body = Buffer.from("hello video");
    const ticket = storage.mint(
      acceptedPlan("video/mp4", body.byteLength),
      {
        customerId: CUSTOMER,
        courseId: COURSE,
      },
      NOW,
    );

    // The attempt that matters: take a legitimate signature and point it at
    // another customer's prefix. The key is in the canonical request, so the
    // signature simply stops verifying.
    const elsewhere = ticket.url.replace(CUSTOMER, OTHER_CUSTOMER);
    const put = await fetch(elsewhere, {
      method: "PUT",
      headers: ticket.headers,
      body,
    });

    expect(put.status).toBe(403);
    expect([...bucket.objects.keys()].some((key) => key.startsWith(OTHER_CUSTOMER))).toBe(
      false,
    );
  });

  it("refuses an upload signature replayed as a read", async () => {
    const body = Buffer.from("hello video");
    const ticket = storage.mint(
      acceptedPlan("video/mp4", body.byteLength),
      {
        customerId: CUSTOMER,
        courseId: COURSE,
      },
      NOW,
    );
    await upload(ticket, body);

    // The method is the first line of the canonical request, so a PUT
    // capability cannot be spent on a GET.
    expect((await fetch(ticket.url)).status).toBe(403);
  });
});

describe("the key belongs to the tenant, and the tenant does not choose it", () => {
  it("prefixes the key with the customer and the course", () => {
    const ticket = storage.mint(
      acceptedPlan(),
      {
        customerId: CUSTOMER,
        courseId: COURSE,
      },
      NOW,
    );

    expect(ticket.key.startsWith(`${CUSTOMER}/courses/${COURSE}/`)).toBe(true);
    expect(ticket.reference).toBe(`s3://${ticket.key}`);
  });

  it("names the purpose and our extension, never the uploader's filename", () => {
    const ticket = storage.mint(
      acceptedPlan(),
      {
        customerId: CUSTOMER,
        courseId: COURSE,
      },
      NOW,
    );

    expect(ticket.key).toMatch(/\/video-[0-9a-f]{32}\.mp4$/);
  });

  it("gives two uploads different keys", () => {
    const scope = { customerId: CUSTOMER, courseId: COURSE };
    const a = storage.mint(acceptedPlan(), scope, NOW);
    const b = storage.mint(acceptedPlan(), scope, NOW);

    expect(a.key).not.toBe(b.key);
  });

  it("expires the ticket, and says when", () => {
    const ticket = storage.mint(
      acceptedPlan(),
      {
        customerId: CUSTOMER,
        courseId: COURSE,
      },
      NOW,
    );

    expect(ticket.expiresAt.toISOString()).toBe("2026-08-07T09:15:00.000Z");
  });
});

describe("verification, and what it does with what it refuses", () => {
  it("reports a missing object rather than accepting the client's word", async () => {
    const ticket = storage.mint(
      acceptedPlan(),
      {
        customerId: CUSTOMER,
        courseId: COURSE,
      },
      NOW,
    );

    // Nothing was uploaded. A console that reported success anyway would leave
    // a course pointing at an object that does not exist.
    const verified = await storage.verifyUpload(
      ticket.key,
      { contentType: "video/mp4", sizeBytes: 11 },
      NOW,
    );

    expect(verified).toEqual({ ok: false, refusal: { kind: "missing" } });
  });

  it("deletes an object whose stored size is not the approved one", async () => {
    // Reachable when a store does not enforce the signed content-length. The
    // HEAD is the backstop, and it has to remove what it refuses.
    const body = Buffer.from("hello video");
    const ticket = storage.mint(
      acceptedPlan("video/mp4", body.byteLength),
      {
        customerId: CUSTOMER,
        courseId: COURSE,
      },
      NOW,
    );
    await upload(ticket, body);

    const verified = await storage.verifyUpload(
      ticket.key,
      { contentType: "video/mp4", sizeBytes: 999 },
      NOW,
    );

    expect(verified.ok).toBe(false);
    if (!verified.ok) {
      expect(verified.refusal.kind).toBe("mismatch");
      expect(verified.refusal).toHaveProperty("reason", expect.stringContaining("999"));
    }
    expect(bucket.objects.has(ticket.key)).toBe(false);
  });

  it("deletes an object stored as a type we did not approve", async () => {
    const body = Buffer.from("hello video");
    const ticket = storage.mint(
      acceptedPlan("video/mp4", body.byteLength),
      {
        customerId: CUSTOMER,
        courseId: COURSE,
      },
      NOW,
    );
    await upload(ticket, body);

    const verified = await storage.verifyUpload(
      ticket.key,
      { contentType: "application/pdf", sizeBytes: body.byteLength },
      NOW,
    );

    expect(verified.ok).toBe(false);
    expect(bucket.objects.has(ticket.key)).toBe(false);
  });

  it("reports an unreachable bucket as unreachable, not as a missing file", async () => {
    // The two need different handling: "your upload did not arrive, try again"
    // is wrong advice when the bucket is down, and it is what an author would
    // act on for the rest of the outage.
    await bucket.close();

    const verified = await storage.verifyUpload(
      `${CUSTOMER}/courses/${COURSE}/video-x.mp4`,
      { contentType: "video/mp4", sizeBytes: 11 },
      NOW,
    );

    expect(verified.ok).toBe(false);
    if (!verified.ok) expect(verified.refusal.kind).toBe("unreachable");
  });

  it("never puts a signature in a refusal message", async () => {
    await bucket.close();

    const verified = await storage.verifyUpload(
      `${CUSTOMER}/courses/${COURSE}/video-x.mp4`,
      { contentType: "video/mp4", sizeBytes: 11 },
      NOW,
    );

    // A refusal reason reaches a log and, in some shapes, an author. A URL in
    // it is a live capability written down somewhere it will outlive its use.
    if (!verified.ok && "reason" in verified.refusal) {
      expect(verified.refusal.reason).not.toContain("X-Amz-Signature");
      expect(verified.refusal.reason).not.toContain(bucket.secretAccessKey);
    }
  });
});

describe("planning refuses before anything is signed", () => {
  it("refuses an unsupported type", () => {
    expect(
      storage.plan({ purpose: "video", mimeType: "video/quicktime", sizeBytes: 10 }),
    ).toEqual({ ok: false, reason: "unsupported_type" });
  });

  it("refuses a file over the ceiling", () => {
    expect(
      storage.plan({
        purpose: "poster",
        mimeType: "image/png",
        sizeBytes: 64 * 1024 * 1024,
      }),
    ).toEqual({ ok: false, reason: "too_large" });
  });
});
