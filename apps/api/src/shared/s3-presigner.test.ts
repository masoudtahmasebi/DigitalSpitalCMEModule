/**
 * The signature is checked against AWS's own published test vector.
 *
 * Hand-rolled crypto that is only tested against itself proves nothing — it
 * proves the implementation is self-consistent, which a wrong implementation
 * also is. The first suite below reproduces the example from AWS's
 * "Signature Version 4 — Query parameters" documentation, byte for byte. If
 * the canonical request, the scope or the key derivation drifts, that fixture
 * stops matching.
 */

import { describe, expect, it } from "vitest";
import { S3ConfigurationError, S3Presigner } from "./s3-presigner.js";

/**
 * AWS's documented example: GET on `examplebucket/test.txt`, 86400 seconds,
 * `20130524T000000Z`, us-east-1, with the well-known example credentials.
 */
const AWS_EXAMPLE = {
  endpoint: "https://s3.amazonaws.com",
  // Amazon signs its documented example virtual-hosted style.
  forcePathStyle: false,
  region: "us-east-1",
  bucket: "examplebucket",
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
};

const AWS_EXAMPLE_SIGNATURE =
  "aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404";

const NOW = new Date("2026-07-28T10:00:00.000Z");

describe("the signature matches AWS's published vector", () => {
  it("reproduces the documented example exactly", () => {
    const url = new S3Presigner(AWS_EXAMPLE).presignGet(
      "test.txt",
      86_400,
      new Date("2013-05-24T00:00:00.000Z"),
    );

    expect(new URL(url).searchParams.get("X-Amz-Signature")).toBe(AWS_EXAMPLE_SIGNATURE);
  });

  it("addresses it virtual-hosted style, as the vector does", () => {
    const url = new URL(new S3Presigner(AWS_EXAMPLE).presignGet("test.txt", 60, NOW));
    expect(url.host).toBe("examplebucket.s3.amazonaws.com");
    expect(url.pathname).toBe("/test.txt");
  });

  it("signs path-style differently — the host is part of the signature", () => {
    // Which is why the two styles cannot be confused silently: a path-style
    // config against a virtual-hosted endpoint fails to verify rather than
    // fetching the wrong object.
    const virtualHosted = new S3Presigner(AWS_EXAMPLE).presignGet("test.txt", 60, NOW);
    const path = new S3Presigner({ ...AWS_EXAMPLE, forcePathStyle: true }).presignGet(
      "test.txt",
      60,
      NOW,
    );

    expect(new URL(virtualHosted).searchParams.get("X-Amz-Signature")).not.toBe(
      new URL(path).searchParams.get("X-Amz-Signature"),
    );
  });
});

describe("the URL is a capability, so its shape matters", () => {
  // The real shape: Hetzner Object Storage in Germany, path-style.
  const presigner = new S3Presigner({
    ...AWS_EXAMPLE,
    endpoint: "https://fsn1.your-objectstorage.com",
    region: "eu-central-1",
    bucket: "ds-education-prod",
    forcePathStyle: true,
  });
  const key = "0198f4c1-7a2e-7000-8000-000000000001/courses/abc/modul-1.mp4";

  it("carries every parameter S3 needs to verify it", () => {
    const params = new URL(presigner.presignGet(key, 300, NOW)).searchParams;

    expect(params.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    expect(params.get("X-Amz-Date")).toBe("20260728T100000Z");
    expect(params.get("X-Amz-Expires")).toBe("300");
    expect(params.get("X-Amz-SignedHeaders")).toBe("host");
    expect(params.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("never puts the secret key in the URL", () => {
    // The access key id is public and appears in the credential scope by
    // design. The secret must not appear anywhere.
    const url = presigner.presignGet(key, 300, NOW);

    expect(url).toContain(AWS_EXAMPLE.accessKeyId);
    expect(url).not.toContain(AWS_EXAMPLE.secretAccessKey);
  });

  it("scopes the credential to the day, the region and s3", () => {
    const credential = new URL(presigner.presignGet(key, 300, NOW)).searchParams.get(
      "X-Amz-Credential",
    );
    expect(credential).toBe(
      `${AWS_EXAMPLE.accessKeyId}/20260728/eu-central-1/s3/aws4_request`,
    );
  });

  it("signs the key it was asked for — a different object is a different signature", () => {
    const a = new URL(presigner.presignGet(key, 300, NOW)).searchParams.get(
      "X-Amz-Signature",
    );
    const b = new URL(
      presigner.presignGet(key.replace("modul-1", "modul-2"), 300, NOW),
    ).searchParams.get("X-Amz-Signature");

    expect(a).not.toBe(b);
  });

  it("signs the expiry too, so it cannot be extended by editing the URL", () => {
    const short = new URL(presigner.presignGet(key, 60, NOW)).searchParams.get(
      "X-Amz-Signature",
    );
    const long = new URL(presigner.presignGet(key, 86_400, NOW)).searchParams.get(
      "X-Amz-Signature",
    );

    expect(short).not.toBe(long);
  });

  it("is deterministic for the same inputs", () => {
    expect(presigner.presignGet(key, 300, NOW)).toBe(presigner.presignGet(key, 300, NOW));
  });

  it("changes daily, because the signing key is date-scoped", () => {
    const today = presigner.presignGet(key, 300, NOW);
    const tomorrow = presigner.presignGet(key, 300, new Date("2026-07-29T10:00:00.000Z"));

    expect(today).not.toBe(tomorrow);
  });
});

describe("encoding", () => {
  const presigner = new S3Presigner({ ...AWS_EXAMPLE, forcePathStyle: true });

  it("keeps slashes as path separators, so the key is not flattened", () => {
    const url = presigner.presignGet("a/b/c.mp4", 60, NOW);
    expect(new URL(url).pathname).toBe("/examplebucket/a/b/c.mp4");
  });

  it("escapes the characters AWS treats as reserved but encodeURIComponent does not", () => {
    // `!'()*` differ between the two, and getting it wrong is a 403 on a video
    // rather than a visible error.
    const url = presigner.presignGet("a!b'c(d)e*f.mp4", 60, NOW);
    const path = new URL(url).pathname;

    for (const character of ["!", "'", "(", ")", "*"]) {
      expect(path).not.toContain(character);
    }
    expect(path).toContain("%21");
  });

  it("escapes a space rather than producing an invalid URL", () => {
    expect(new URL(presigner.presignGet("a b.mp4", 60, NOW)).pathname).toContain("%20");
  });
});

describe("misconfiguration fails at construction, not at play time", () => {
  it("refuses to build without credentials", () => {
    // A presigner that returns plausible broken URLs fails per learner, mid
    // video. This fails in front of whoever deployed it.
    expect(
      () => new S3Presigner({ ...AWS_EXAMPLE, accessKeyId: "", secretAccessKey: "" }),
    ).toThrow(S3ConfigurationError);
  });

  it("names every missing field at once", () => {
    const error = (() => {
      try {
        new S3Presigner({
          endpoint: "",
          region: "",
          bucket: "",
          accessKeyId: "",
          secretAccessKey: "",
        });
        return undefined;
      } catch (thrown) {
        return thrown as S3ConfigurationError;
      }
    })();

    expect(error?.message).toContain("endpoint");
    expect(error?.message).toContain("bucket");
    expect(error?.message).toContain("secretAccessKey");
  });

  it("does not put the secret in the error message", () => {
    const error = (() => {
      try {
        new S3Presigner({ ...AWS_EXAMPLE, bucket: "" });
        return undefined;
      } catch (thrown) {
        return thrown as S3ConfigurationError;
      }
    })();

    expect(error?.message).not.toContain(AWS_EXAMPLE.secretAccessKey);
  });
});
