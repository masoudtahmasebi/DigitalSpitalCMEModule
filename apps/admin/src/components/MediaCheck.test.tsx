/**
 * The Range check, from the author's side (P63-04).
 *
 * ## What is actually under test
 *
 * That **a host answering `200` is reported as a problem**, in words naming the
 * video server rather than the course.
 *
 * That is the whole finding. `200` is the answer a misconfigured host gives to
 * a Range request, and the symptom in the player — a scrub bar that will not
 * move — is identical to the anti-skip gate refusing a seek on the
 * accreditation's behalf. If this panel reported it as "in Ordnung", or in
 * words an author could read as "the platform is blocking seeking", the check
 * would be worse than absent: it would confirm the wrong diagnosis.
 *
 * The client is a plain object rather than a mock proxy: a method the component
 * starts calling and this file does not provide should be a `TypeError` here,
 * not a silently recorded call that passes.
 */

import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ApiClient, MediaCheckReport } from "@ds/sdk";
import { MediaCheckPanel } from "./MediaCheck.js";
import { de } from "../locale/de.js";

afterEach(cleanup);

function clientReturning(report: MediaCheckReport) {
  const adminCheckCourseMedia = vi.fn().mockResolvedValue(report);
  return {
    client: { adminCheckCourseMedia } as unknown as ApiClient,
    adminCheckCourseMedia,
  };
}

it("does not probe anything until somebody asks", async () => {
  // Fifteen round trips to a CDN on every mount is a slow screen paid for on
  // every visit, for an answer that changes only when the media changes.
  const { client, adminCheckCourseMedia } = clientReturning({
    seekable: true,
    sources: [],
  });

  render(<MediaCheckPanel client={client} courseSlug="adhs-akademie-adult" />);

  expect(adminCheckCourseMedia).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: de.structure.mediaCheck })).toBeTruthy();
});

it("calls a host that answered 200 a problem, and blames the video server", async () => {
  const { client } = clientReturning({
    seekable: false,
    sources: [
      {
        url: "https://cdn.example.org/modul-1.mp4",
        verdict: "no_range",
        status: 200,
        detail: "answered 200 and ignored the Range header",
      },
    ],
  });

  render(<MediaCheckPanel client={client} courseSlug="adhs-akademie-adult" />);
  fireEvent.click(screen.getByRole("button", { name: de.structure.mediaCheck }));

  await waitFor(() => {
    expect(screen.getByText(de.structure.mediaCheckProblems)).toBeTruthy();
  });

  /*
   * The row's own badge, and this is the assertion that matters.
   *
   * The first version of this test asserted only the sentence and the summary
   * — and both of those are handed to the component by the server, in
   * `verdict` and `seekable`. So it stayed green when the component was broken
   * to classify `no_range` as healthy. It could not go red, which means it was
   * not evidence (CLAUDE.md §9.1). The badge is the one thing on this screen
   * the component decides for itself.
   */
  expect(screen.getByText(de.structure.mediaProblem)).toBeTruthy();
  expect(screen.queryByText(de.structure.mediaOk)).toBeNull();

  // The sentence, in full. Not a substring match on "Videoserver": the property
  // is that the author is told which of the two identical symptoms this is.
  expect(screen.getByText(de.structure.mediaVerdict.no_range)).toBeTruthy();
  expect(de.structure.mediaVerdict.no_range).toContain("nicht der Fortbildung");
  expect(screen.queryByText(de.structure.mediaCheckAllGood)).toBeNull();
});

it("says so plainly when every host answers correctly", async () => {
  const { client } = clientReturning({
    seekable: true,
    sources: [
      { url: "https://cdn.example.org/modul-1.mp4", verdict: "seekable", status: 206 },
      { url: "s3://medice/courses/adhs/modul-2.mp4", verdict: "signed_by_us" },
    ],
  });

  render(<MediaCheckPanel client={client} courseSlug="adhs-akademie-adult" />);
  fireEvent.click(screen.getByRole("button", { name: de.structure.mediaCheck }));

  await waitFor(() => {
    expect(screen.getByText(de.structure.mediaCheckAllGood)).toBeTruthy();
  });

  // Every source, including the ones that passed. A list that empties itself on
  // success is a list that gives no evidence the check ran.
  expect(screen.getByText("https://cdn.example.org/modul-1.mp4")).toBeTruthy();
  expect(screen.getByText("s3://medice/courses/adhs/modul-2.mp4")).toBeTruthy();
  expect(screen.getByText(de.structure.mediaVerdict.signed_by_us)).toBeTruthy();

  // Both rows, and neither of them flagged. `signed_by_us` is the one that is
  // healthy without having been probed, so it is the one a stricter
  // classification would wrongly mark.
  expect(screen.getAllByText(de.structure.mediaOk)).toHaveLength(2);
  expect(screen.queryByText(de.structure.mediaProblem)).toBeNull();
});

it("reports that the check did not run, rather than that a host is broken", async () => {
  // A 403 or a dropped connection is about this request, not about a video
  // server. Rendering it as a verdict would name the wrong culprit.
  const adminCheckCourseMedia = vi.fn().mockRejectedValue(new Error("network"));
  const client = { adminCheckCourseMedia } as unknown as ApiClient;

  render(<MediaCheckPanel client={client} courseSlug="adhs-akademie-adult" />);
  fireEvent.click(screen.getByRole("button", { name: de.structure.mediaCheck }));

  await waitFor(() => {
    expect(screen.getByText(de.structure.mediaCheckFailed)).toBeTruthy();
  });
  expect(screen.queryByText(de.structure.mediaCheckProblems)).toBeNull();
});
