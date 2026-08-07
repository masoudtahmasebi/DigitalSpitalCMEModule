/**
 * Every header the guard reads must survive a CORS preflight (P22-06).
 *
 * ## Why this test exists
 *
 * `x-ds-customer` was added to the guard and to the SDK and **not** to
 * `allowedHeaders`. The console failed with
 *
 *     Request header field x-ds-customer is not allowed by
 *     Access-Control-Allow-Headers in preflight response
 *
 * which is a *browser* message. The request never left the browser, so the API
 * saw nothing, logged nothing, and no integration test could have failed —
 * they call the API directly and there is no preflight to get wrong.
 *
 * That is the whole trap: a header missing from the allow-list is invisible
 * from the server side. The only place the two facts can be compared is here,
 * before either is deployed.
 *
 * ## Why it reads the source rather than importing the config
 *
 * `configureApp` needs a Nest application to run. Reading the two lists out of
 * the file is uglier and has one property that matters more: it fails when
 * somebody writes a literal `"x-ds-…"` into the guard instead of using the
 * shared constant, which is exactly how the original mistake was made.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TENANT_HEADERS } from "../configure-app.js";

const guardSource = readFileSync(
  fileURLToPath(new URL("./auth.guard.ts", import.meta.url)),
  "utf8",
);
const configureSource = readFileSync(
  fileURLToPath(new URL("../configure-app.ts", import.meta.url)),
  "utf8",
);

/** Every `x-ds-*` string literal in a file, whatever it is used for. */
function tenantHeaderLiterals(source: string): readonly string[] {
  return [...source.matchAll(/"(x-ds-[a-z-]+)"/g)]
    .map((match) => match[1] ?? "")
    .filter((name) => name !== "");
}

describe("the guard's headers and the CORS allow-list", () => {
  it("names both tenant headers in the shared constant", () => {
    // Not an implementation detail: this constant is what stops the two lists
    // drifting, so it has to actually contain them.
    expect([...TENANT_HEADERS]).toEqual(["x-ds-project", "x-ds-customer"]);
  });

  it("reads no tenant header the preflight would refuse", () => {
    const allowed = new Set<string>([...TENANT_HEADERS, "x-ds-csrf"]);

    for (const header of tenantHeaderLiterals(guardSource)) {
      // A header the guard reads but CORS does not allow never arrives from a
      // browser, and nothing on this side of the wire can tell.
      expect(
        allowed.has(header),
        `${header} is read by auth.guard.ts but is not in the CORS allow-list`,
      ).toBe(true);
    }
  });

  it("allows no header nothing reads, so the list cannot rot", () => {
    // The converse is weaker — an extra allowed header costs nothing at
    // runtime — but it is how a rename leaves a dead entry behind, which is the
    // state that makes the list untrustworthy the next time somebody reads it.
    const read = new Set(tenantHeaderLiterals(guardSource));
    for (const header of TENANT_HEADERS) {
      expect(
        read.has(header),
        `${header} is allowed by CORS but no longer read by auth.guard.ts`,
      ).toBe(true);
    }
  });

  it("builds the allow-list from the constant rather than repeating it", () => {
    // A literal list would pass every assertion above on the day it was written
    // and drift the day after. Spreading the constant is what makes the checks
    // above continue to mean something.
    expect(configureSource).toContain("...TENANT_HEADERS");
  });
});
