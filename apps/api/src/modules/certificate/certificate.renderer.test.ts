import { describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { buildCertificateData } from "@ds/domain";
import {
  CertificateAssetsMissingError,
  renderCertificatePdf,
  type CertificateAssets,
} from "./certificate.renderer.js";

/** 1×1 opaque PNG. Small enough to inline, real enough for pdf-lib to embed. */
const MINIMAL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/** 1×1 baseline JPEG, validated to have real SOI/EOI markers. */
const MINIMAL_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oACAEBAAA/AP38ooooA//Z",
  "base64",
);

const data = buildCertificateData({
  vnr: "9999999999999999999",
  courseTitle: "ADHS Akademie adult",
  completedAt: new Date("2026-07-28T14:35:00Z"),
  eventLocation: "online",
  organizer: "Medice Arzneimittel Pütter GmbH & Co. KG, Iserlohn",
  cmePoints: 4,
  cmeCategory: "D",
  accreditationBody: "Ärztekammer Westfalen-Lippe",
  participantName: "Dr. med. Anna Müller",
  scientificLeadName: "Prof. Dr. med. Beispiel",
});

const assets: CertificateAssets = {
  stampImage: MINIMAL_PNG,
  stampImageMime: "image/png",
  signatureImage: MINIMAL_PNG,
  signatureImageMime: "image/png",
  issuePlace: "Iserlohn",
};

describe("the rendered PDF", () => {
  it("produces a single-page A4 document", async () => {
    const bytes = await renderCertificatePdf(data, assets);
    const parsed = await PDFDocument.load(bytes);

    expect(parsed.getPageCount()).toBe(1);
    const page = parsed.getPage(0);
    expect(Math.round(page.getWidth())).toBe(595);
    expect(Math.round(page.getHeight())).toBe(842);
  });

  it("starts with the PDF magic bytes", async () => {
    const bytes = await renderCertificatePdf(data, assets);
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
  });

  it("carries the course and VNR in its metadata", async () => {
    const parsed = await PDFDocument.load(await renderCertificatePdf(data, assets));

    expect(parsed.getTitle()).toContain("ADHS Akademie adult");
    expect(parsed.getSubject()).toContain("9999999999999999999");
  });

  it("embeds both barcodes plus the stamp and signature", async () => {
    const bytes = await renderCertificatePdf(data, assets);
    const parsed = await PDFDocument.load(bytes);

    // Four images: Code 39, Datamatrix, stamp, signature.
    const images = parsed.context
      .enumerateIndirectObjects()
      .filter(([, object]) => JSON.stringify(object.toString()).includes("/Image"));

    expect(images.length).toBeGreaterThanOrEqual(4);
  });

  it("is deterministic for the same input, whatever the clock says", async () => {
    // Two downloads of the same certificate must be the same document — a
    // physician filing one and their Kammer receiving another would be a
    // needless discrepancy. Both PDF timestamps come from `completedAt`, never
    // from the clock.
    //
    // **The clock is moved between the two renders**, and that is the whole
    // test. It used to render twice back to back, which passed whenever both
    // landed in the same second — and pdf-lib was stamping `ModDate` with the
    // wall clock, so the property was false while the assertion held. It failed
    // only when the pair happened to straddle a tick, which read as flakiness
    // rather than as the defect it was.
    //
    // Rendering hundreds of times until a second elapses would also catch it,
    // and was tried: it is slow enough to time out under a parallel test run,
    // which is its own kind of flake. Advancing the clock states the property
    // directly and costs two renders.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-07-28T14:35:00Z"));
      const first = await renderCertificatePdf(data, assets);

      vi.setSystemTime(new Date("2027-01-01T09:00:00Z"));
      const later = await renderCertificatePdf(data, assets);

      expect(Buffer.from(first).equals(Buffer.from(later))).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("it refuses rather than issuing an invalid document", () => {
  it("throws when the stamp is missing", async () => {
    // The Bescheid: the certificate is only valid with the stamp of the
    // Wissenschaftliche Leitung. Rendering without it would hand a physician
    // something that looks like a certificate and is not one.
    await expect(
      renderCertificatePdf(data, { ...assets, stampImage: null }),
    ).rejects.toBeInstanceOf(CertificateAssetsMissingError);
  });

  it("throws when the signature is missing", async () => {
    await expect(
      renderCertificatePdf(data, { ...assets, signatureImage: null }),
    ).rejects.toBeInstanceOf(CertificateAssetsMissingError);
  });

  it("names every missing asset, not just the first", async () => {
    const error = (await renderCertificatePdf(data, {
      ...assets,
      stampImage: null,
      signatureImage: null,
    }).catch((e) => e)) as CertificateAssetsMissingError;

    expect(error.missing).toEqual(["stampImage", "signatureImage"]);
  });
});

describe("the creditability sentence is never hardcoded", () => {
  it("renders whatever the course's own points and category say", async () => {
    // A different course with different points must not print "4 Punkten
    // (Kategorie D)". The sentence is templated in @ds/domain and the renderer
    // only lays it out.
    const other = buildCertificateData({
      ...data,
      cmePoints: 1,
      cmeCategory: "A",
      accreditationBody: "Ärztekammer Nordrhein",
    });

    expect(other.creditSentence).toContain("1 Punkt (Kategorie A)");
    expect(other.creditSentence).toContain("Ärztekammer Nordrhein");
    // And it renders without complaint.
    await expect(renderCertificatePdf(other, assets)).resolves.toBeDefined();
  });
});

describe("image handling", () => {
  it("accepts a JPEG stamp as well as a PNG", async () => {
    // The column constraint permits both, so the renderer must handle both.
    await expect(
      renderCertificatePdf(data, {
        ...assets,
        stampImage: MINIMAL_JPEG,
        stampImageMime: "image/jpeg",
      }),
    ).resolves.toBeDefined();
  });

  it("sniffs the format when the stored mime type is absent", async () => {
    // Rows written before the mime column existed have null there; falling
    // back to the magic bytes keeps those certificates downloadable.
    await expect(
      renderCertificatePdf(data, { ...assets, stampImageMime: null }),
    ).resolves.toBeDefined();
  });
});
