/**
 * The validity dates on the presentation form (P243-01).
 *
 * `windowFromDates` and `datesOfWindow` are tested exhaustively in
 * `@ds/domain`, and every one of those tests would stay green on a form that
 * went on slicing ISO strings and appending `T00:00:00.000Z` — which is what
 * this form did, so that "bis 12.10." ended the course at 02:00 on the 12th
 * (§9.7). These assert the wiring: what the form shows, and what it sends.
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AdminCourseDetail, ApiClient } from "@ds/sdk";
import { CoursePresentation } from "./CoursePresentation.js";
import { forgetUnsavedChanges } from "../hooks.js";

afterEach(() => {
  cleanup();
  forgetUnsavedChanges();
});

function course(over: Partial<AdminCourseDetail>): AdminCourseDetail {
  return {
    slug: "adhs",
    title: "ADHS Akademie adult",
    description: null,
    deliveryType: "on_demand",
    thema: [],
    altersgruppe: [],
    learningObjectives: [],
    targetAudience: null,
    prerequisites: null,
    heroImageUrl: null,
    cmePoints: 4,
    cmeCategory: "D",
    validFrom: null,
    validTo: null,
    ...over,
  } as unknown as AdminCourseDetail;
}

function dateField(id: string): HTMLInputElement {
  const input = document.getElementById(id);
  if (!(input instanceof HTMLInputElement)) throw new Error(`no input #${id}`);
  return input;
}

describe("CoursePresentation validity dates", () => {
  it("shows each end as its Berlin day", () => {
    render(
      <CoursePresentation
        client={{} as ApiClient}
        course={course({
          // The first instant of 13.10.2025 and the last of 12.10.2026, Berlin.
          validFrom: "2025-10-12T22:00:00.000Z",
          validTo: "2026-10-12T21:59:59.999Z",
        })}
        onSaved={() => undefined}
      />,
    );
    // Slicing the ISO string showed the start as 2025-10-12, a day early.
    expect(dateField("course-valid-from").value).toBe("2025-10-13");
    expect(dateField("course-valid-to").value).toBe("2026-10-12");
  });

  it("sends the typed days as Berlin day boundaries", async () => {
    const adminUpdateCourse = vi.fn(async () => course({}));
    render(
      <CoursePresentation
        client={{ adminUpdateCourse } as unknown as ApiClient}
        course={course({})}
        onSaved={() => undefined}
      />,
    );
    fireEvent.change(dateField("course-valid-from"), { target: { value: "2025-10-13" } });
    fireEvent.change(dateField("course-valid-to"), { target: { value: "2026-10-12" } });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));

    await waitFor(() => expect(adminUpdateCourse).toHaveBeenCalledTimes(1));
    expect(adminUpdateCourse.mock.calls[0]).toEqual([
      "adhs",
      expect.objectContaining({
        validFrom: "2025-10-12T22:00:00.000Z",
        validTo: "2026-10-12T21:59:59.999Z",
      }),
    ]);
  });
});
