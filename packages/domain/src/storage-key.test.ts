import { describe, expect, it } from "vitest";
import {
  courseAssetKey,
  customerPrefix,
  InvalidStorageKeyError,
  isStorageReference,
  keyBelongsToCustomer,
  storageKeyOf,
} from "./storage-key.js";

const CUSTOMER = "0198f4c1-7a2e-7000-8000-000000000001";
const OTHER_CUSTOMER = "0198f4c1-7a2e-7000-8000-000000000002";
const COURSE = "f47ac10b-58cc-4372-a567-0e02b2c3d479";

describe("courseAssetKey", () => {
  it("puts the customer first, because that is the isolation", () => {
    expect(
      courseAssetKey({ customerId: CUSTOMER, courseId: COURSE, filename: "modul-1.mp4" }),
    ).toBe(`${CUSTOMER}/courses/${COURSE}/modul-1.mp4`);
  });

  it("lower-cases the ids so two spellings cannot become two prefixes", () => {
    expect(
      courseAssetKey({
        customerId: CUSTOMER.toUpperCase(),
        courseId: COURSE.toUpperCase(),
        filename: "a.pdf",
      }),
    ).toBe(`${CUSTOMER}/courses/${COURSE}/a.pdf`);
  });

  it("refuses a filename that would climb out of the prefix", () => {
    for (const filename of ["../secrets", "..", "a/../../b", "/etc/passwd", "a/b"]) {
      expect(() =>
        courseAssetKey({ customerId: CUSTOMER, courseId: COURSE, filename }),
      ).toThrow(InvalidStorageKeyError);
    }
  });

  it("refuses a filename that would confuse a URL or a signature", () => {
    for (const filename of ["a?b", "a#b", "a b", "a\nb", "a%2fb", "a\\b", ""]) {
      expect(() =>
        courseAssetKey({ customerId: CUSTOMER, courseId: COURSE, filename }),
      ).toThrow(InvalidStorageKeyError);
    }
  });

  it("refuses a leading dot, which is a hidden file and often a mistake", () => {
    expect(() =>
      courseAssetKey({ customerId: CUSTOMER, courseId: COURSE, filename: ".env" }),
    ).toThrow(InvalidStorageKeyError);
  });

  it("refuses ids that are not uuids", () => {
    expect(() =>
      courseAssetKey({ customerId: "medice", courseId: COURSE, filename: "a.mp4" }),
    ).toThrow(InvalidStorageKeyError);
    expect(() =>
      courseAssetKey({ customerId: CUSTOMER, courseId: "adhs", filename: "a.mp4" }),
    ).toThrow(InvalidStorageKeyError);
  });

  it("bounds the filename, which bounds the key", () => {
    // 128 is the cap; the resulting key is ~210 characters, well inside S3's
    // 1024-byte limit, which is why there is no separate key-length check.
    expect(() =>
      courseAssetKey({
        customerId: CUSTOMER,
        courseId: COURSE,
        filename: "a".repeat(128),
      }),
    ).not.toThrow();
    expect(() =>
      courseAssetKey({
        customerId: CUSTOMER,
        courseId: COURSE,
        filename: "a".repeat(129),
      }),
    ).toThrow(InvalidStorageKeyError);
  });

  it("accepts the filenames a course actually has", () => {
    for (const filename of ["modul-1.mp4", "Handout_2.PDF", "a.b.c.pdf", "1.mp4"]) {
      expect(() =>
        courseAssetKey({ customerId: CUSTOMER, courseId: COURSE, filename }),
      ).not.toThrow();
    }
  });
});

describe("keyBelongsToCustomer — the check that makes a bad row harmless", () => {
  it("accepts this customer's own key", () => {
    const key = courseAssetKey({
      customerId: CUSTOMER,
      courseId: COURSE,
      filename: "a.mp4",
    });
    expect(keyBelongsToCustomer(key, CUSTOMER)).toBe(true);
  });

  it("refuses another customer's key", () => {
    const key = courseAssetKey({
      customerId: OTHER_CUSTOMER,
      courseId: COURSE,
      filename: "a.mp4",
    });
    expect(keyBelongsToCustomer(key, CUSTOMER)).toBe(false);
  });

  it("does not match on a partial id — the easy mistake", () => {
    // A plain `startsWith(customerId)` without the separator would let
    // `…0001` read `…00012`'s objects. The trailing slash is the whole point.
    const sneaky = `${CUSTOMER}2/courses/${COURSE}/a.mp4`;
    expect(keyBelongsToCustomer(sneaky, CUSTOMER)).toBe(false);
  });

  it("refuses a key containing a traversal even under the right prefix", () => {
    expect(keyBelongsToCustomer(`${CUSTOMER}/../${OTHER_CUSTOMER}/a.mp4`, CUSTOMER)).toBe(
      false,
    );
  });

  it("refuses an absolute key", () => {
    expect(keyBelongsToCustomer(`/${CUSTOMER}/a.mp4`, CUSTOMER)).toBe(false);
  });

  it("is case-insensitive on the id, since the prefix is normalised", () => {
    expect(keyBelongsToCustomer(`${CUSTOMER.toUpperCase()}/a.mp4`, CUSTOMER)).toBe(true);
  });

  it("refuses when the customer id is not a uuid, rather than matching loosely", () => {
    expect(keyBelongsToCustomer("anything/a.mp4", "not-a-uuid")).toBe(false);
  });
});

describe("storage references and plain URLs coexist", () => {
  it("recognises an s3 reference", () => {
    expect(isStorageReference(`s3://${CUSTOMER}/courses/${COURSE}/a.mp4`)).toBe(true);
    expect(storageKeyOf(`s3://${CUSTOMER}/a.mp4`)).toBe(`${CUSTOMER}/a.mp4`);
  });

  it("leaves an ordinary URL alone", () => {
    // A customer already serving media from their own CDN keeps doing so;
    // migrating is a data change, not a code change.
    expect(isStorageReference("https://cdn.medice.de/a.mp4")).toBe(false);
    expect(storageKeyOf("https://cdn.medice.de/a.mp4")).toBeUndefined();
  });

  it("treats an empty reference as no reference", () => {
    expect(storageKeyOf("s3://")).toBeUndefined();
  });
});

describe("customerPrefix", () => {
  it("is the complete answer to 'everything belonging to this customer'", () => {
    // Which is what a deletion on offboarding, or a per-customer lifecycle
    // rule, needs.
    expect(customerPrefix(CUSTOMER)).toBe(`${CUSTOMER}/`);
  });

  it("refuses a non-uuid rather than returning a prefix that matches everything", () => {
    expect(() => customerPrefix("")).toThrow(InvalidStorageKeyError);
    expect(() => customerPrefix("../")).toThrow(InvalidStorageKeyError);
  });
});
