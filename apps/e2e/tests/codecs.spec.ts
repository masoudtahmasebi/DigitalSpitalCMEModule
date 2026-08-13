/**
 * What the browser under test can actually decode (P71-02).
 *
 * ## The gap this exists to keep visible
 *
 * The client supplied real 1080p H.264 recordings with the instruction *"make
 * all of the data, images, videos and so on, real ones"*, and the journey was
 * pointed at one. It uploaded, it stored, it verified — and it never played,
 * with the unhelpful message "the video never played".
 *
 * The reason is that **Playwright's bundled Chromium ships no H.264 decoder.**
 * It is the open-source build; proprietary codecs are not in it:
 *
 * ```
 * canPlayType('video/mp4; codecs="avc1.42E01E')  →  ""        (cannot)
 * canPlayType('video/webm; codecs="vp8"')        →  "probably"
 * ```
 *
 * Every physician watching a Fortbildung uses Chrome, Edge or Safari, and every
 * one of those plays H.264 — which is what real course material is encoded as,
 * including the client's own `1-720.mp4` renditions. So the browser suite has
 * never played the codec the product actually serves, and could not have.
 *
 * That is worth a check of its own rather than a comment, because it is exactly
 * the shape CLAUDE.md §9.1 names: a suite that is green about video playback
 * while being structurally incapable of playing the format in use.
 *
 * ## What this asserts
 *
 * 1. **The fixture is decodable by this browser.** A fixture the browser cannot
 *    play produces a failure three acts later that names the codec last. This
 *    says it first, in one second.
 * 2. **The record of what is *not* covered.** H.264 is asserted to be
 *    unsupported. If that ever changes — a Playwright build with codecs, or a
 *    `channel: "chrome"` in the config — this test fails and whoever changed it
 *    is told to point the journey at the real MP4, which is already committed
 *    beside the WebM for that day.
 *
 * Closing the gap needs one of two things, and both are the client's call:
 * a VP9/WebM export of the same recording, or real Chrome in CI
 * (`playwright install chrome`, which this sandbox's network policy refuses).
 * See `apps/e2e/fixtures/README.md`.
 */

import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const FIXTURE = fileURLToPath(new URL("../fixtures/kurzvideo.webm", import.meta.url));

/** `canPlayType`'s three answers, as the spec defines them. */
async function support(page: Page, type: string) {
  return page.evaluate((mime) => document.createElement("video").canPlayType(mime), type);
}

test.describe("what this browser can decode", () => {
  test("plays the fixture the journey uploads", async ({ page }) => {
    await page.goto("about:blank");

    // The container is read from the file rather than assumed: a fixture
    // swapped for another format is precisely the mistake this catches, and
    // trusting the extension would not have caught it.
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- a path this file computes from its own location
    const head = await readFile(FIXTURE);
    const isWebm = head.subarray(0, 4).toString("hex") === "1a45dfa3";
    const isMp4 = head.subarray(4, 8).toString("latin1") === "ftyp";

    expect(
      isWebm || isMp4,
      "the journey's fixture is neither WebM nor MP4 — nothing here knows what it is",
    ).toBe(true);

    const type = isWebm ? 'video/webm; codecs="vp8"' : 'video/mp4; codecs="avc1.42E01E"';
    expect(
      await support(page, type),
      `this browser cannot decode the journey's fixture (${type}). ` +
        "Either the fixture changed format or the browser did. " +
        "See apps/e2e/tests/codecs.spec.ts and fixtures/README.md.",
    ).not.toBe("");
  });

  /*
   * The negative, and the one that matters. It is written as an assertion
   * rather than a comment so that the day it stops being true, somebody is
   * told — with the next step in the message.
   */
  test("still cannot decode H.264, which is what real course video is", async ({
    page,
  }) => {
    await page.goto("about:blank");

    expect(
      await support(page, 'video/mp4; codecs="avc1.42E01E"'),
      "This browser has gained an H.264 decoder. That is good news: point the " +
        "journey at apps/e2e/fixtures/fortbildung-modul.mp4 — a real 1080p " +
        "recording, already committed — and delete this expectation. Until " +
        "then the suite does not cover the codec every learner actually uses.",
    ).toBe("");
  });
});
