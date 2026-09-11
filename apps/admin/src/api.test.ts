/**
 * Which rejections the console announces, and which it does not.
 *
 * `announcing()` in `api.ts` is the floor under 48 hand-written error channels:
 * a screen may show its own message, and a screen that shows nothing is no
 * longer silent. The rule it applies is small and, until this file, untested —
 * it lived inside a `Proxy` where answering "does a font 404 raise a toast?"
 * needed a browser and a signed-in console.
 *
 * It shipped wrong for exactly that reason. See `ANSWERS_WITH_NOT_FOUND`.
 */

import { describe, expect, it } from "vitest";
import { announceable } from "./api.js";

describe("announceable", () => {
  it("says nothing about the two statuses the console already routes", () => {
    // 401 goes to the sign-in form, 403 to the "not an admin" screen. A toast
    // as well would be a second message about a thing already handled.
    expect(announceable("listCourses", 401)).toBe(false);
    expect(announceable("listCourses", 403)).toBe(false);
  });

  it("announces everything else, including a 404 that really is one", () => {
    // The reason the net exists: a course opened from a stale link, a
    // participant deleted in another tab. These must not be silent.
    expect(announceable("getCourseBySlug", 404)).toBe(true);
    expect(announceable("adminDeleteCourse", 409)).toBe(true);
    expect(announceable("adminSetFont", 500)).toBe(true);
    // Not a problem-details failure at all — a network drop. The most
    // important case for the net, and the one with no status to key on.
    expect(announceable("listCourses", undefined)).toBe(true);
  });

  it("stays quiet about the font that was never uploaded", () => {
    /*
     * `GET /admin/branding/font` 404s deliberately when a project has no font,
     * and `BrandingSettings` has caught that since P22-08 and rendered an empty
     * upload form. The net then announced it anyway, one layer up — so every
     * customer who had not uploaded a font (which is all of them) opened
     * Erscheinungsbild to "Bitte versuchen Sie es später erneut", and the toast
     * outlives the screen, so it followed them onto Texte, Sicherheit and
     * Mediathek.
     *
     * This case fails on the previous rule.
     */
    expect(announceable("adminGetFont", 404)).toBe(false);
  });

  it("still announces a font request that failed for a real reason", () => {
    // The exemption is one status on one method, not a blanket silence: a 500
    // from the same route is a fault and has to say so.
    expect(announceable("adminGetFont", 500)).toBe(true);
    expect(announceable("adminGetFont", undefined)).toBe(true);
  });
});
