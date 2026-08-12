/**
 * The certificate archive (P60-01).
 *
 * Four properties, and three of them are about not lying:
 *
 * 1. The key is under the customer's own prefix — the bucket has no RLS.
 * 2. The digest is of the bytes actually sent, so it can be verified later.
 * 3. A bucket that refuses answers `undefined`, so nothing is recorded as
 *    archived that is not.
 * 4. Nothing that names a physician, and no signed URL, reaches a log line.
 */

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CertificateArchive } from "./certificate.archive.js";
import type { Presigner } from "../../shared/s3-presigner.js";

const CUSTOMER = "0198f4c1-7a2e-7000-8000-000000000001";
const OTHER = "0198f4c1-7a2e-7000-8000-000000000002";
const COURSE = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
const CERTIFICATE = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]); // "%PDF-1"

function build(
  respond: (url: string, init: RequestInit) => Response | Promise<Response>,
): {
  archive: CertificateArchive;
  calls: Array<{ url: string; init: RequestInit }>;
  logs: string[];
} {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const logs: string[] = [];

  const presigner = {
    presignPut: (key: string) => `https://bucket.example/${key}?X-Amz-Signature=abc`,
    presignGet: () => "",
    presignHead: () => "",
    presignDelete: () => "",
  } as unknown as Presigner;

  const archive = new CertificateArchive(
    presigner,
    { warn: (m) => logs.push(m) },
    (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return respond(url, init);
    }) as unknown as typeof fetch,
  );

  return { archive, calls, logs };
}

const ok = () => new Response(null, { status: 200 });

describe("storing an issued certificate", () => {
  it("puts it under the customer's own prefix", async () => {
    // The bucket has no row-level security, so the isolation is the key. This
    // is ADR-0002 carried into object storage.
    const { archive, calls } = build(ok);

    const stored = await archive.store({
      customerId: CUSTOMER,
      courseId: COURSE,
      certificateId: CERTIFICATE,
      bytes: BYTES,
    });

    expect(stored?.objectKey).toBe(
      `${CUSTOMER}/certificates/${COURSE}/${CERTIFICATE}.pdf`,
    );
    expect(stored?.objectKey.startsWith(`${OTHER}/`)).toBe(false);
    expect(calls[0]?.init.method).toBe("PUT");
  });

  it("digests the bytes it actually sent", async () => {
    // The digest is what makes the archive evidence rather than a copy: an
    // object that does not hash to this has been altered.
    const { archive } = build(ok);

    const stored = await archive.store({
      customerId: CUSTOMER,
      courseId: COURSE,
      certificateId: CERTIFICATE,
      bytes: BYTES,
    });

    expect(stored?.sha256).toBe(createHash("sha256").update(BYTES).digest("hex"));
    expect(stored?.sizeBytes).toBe(BYTES.length);
  });

  it("declares the type and length the signature covers", async () => {
    const { archive, calls } = build(ok);
    await archive.store({
      customerId: CUSTOMER,
      courseId: COURSE,
      certificateId: CERTIFICATE,
      bytes: BYTES,
    });

    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers["content-type"]).toBe("application/pdf");
    expect(headers["content-length"]).toBe(String(BYTES.length));
  });
});

describe("when the archive cannot be written", () => {
  it("answers undefined for a bucket that refuses, rather than a key", async () => {
    // The caller records the key only when this returns one. A row that claims
    // an archive which is not there is worse than an unarchived row, because
    // the second is a state somebody can query for.
    const { archive } = build(() => new Response("<Error/>", { status: 403 }));

    const stored = await archive.store({
      customerId: CUSTOMER,
      courseId: COURSE,
      certificateId: CERTIFICATE,
      bytes: BYTES,
    });

    expect(stored).toBeUndefined();
  });

  it("answers undefined when the network is gone", async () => {
    const { archive } = build(() => {
      throw new TypeError("fetch failed");
    });

    expect(
      await archive.store({
        customerId: CUSTOMER,
        courseId: COURSE,
        certificateId: CERTIFICATE,
        bytes: BYTES,
      }),
    ).toBeUndefined();
  });

  it("refuses an id that is not a uuid instead of building a key from it", async () => {
    // `../` in a customer id would otherwise be a path outside the tenant's
    // prefix. The check is in `@ds/domain`; this is the assertion that the
    // adapter honours it rather than catching and continuing.
    const { archive, calls } = build(ok);

    expect(
      await archive.store({
        customerId: "../../other",
        courseId: COURSE,
        certificateId: CERTIFICATE,
        bytes: BYTES,
      }),
    ).toBeUndefined();
    expect(calls).toHaveLength(0);
  });
});

describe("what reaches the log", () => {
  it("names the certificate and never the URL or the bytes", async () => {
    // The presigned URL carries a signature; the bucket's error document
    // echoes the key, which names a customer and a course.
    const { archive, logs } = build(
      () => new Response("<Error><Key>secret/key.pdf</Key></Error>", { status: 403 }),
    );

    await archive.store({
      customerId: CUSTOMER,
      courseId: COURSE,
      certificateId: CERTIFICATE,
      bytes: BYTES,
    });

    const line = logs.join("\n");
    expect(line).toContain(CERTIFICATE);
    expect(line).toContain("403");
    expect(line).not.toContain("X-Amz-Signature");
    expect(line).not.toContain("secret/key.pdf");
  });
});
