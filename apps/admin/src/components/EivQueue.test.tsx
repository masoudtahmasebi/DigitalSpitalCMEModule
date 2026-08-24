/**
 * The Punktemeldung queue (P110-01).
 *
 * What is worth asserting here is not that a table renders. It is the three
 * properties that make this screen safe and useful, each of which fails
 * silently:
 *
 * 1. **No EFN reaches the DOM.** The API sends `efnMasked`; a future edit that
 *    started rendering a whole number would look fine and would be a disclosure
 *    of a national identifier (ADR-0004).
 * 2. **An action is offered only where it can work.** Requeue on a row the
 *    worker is still retrying, or withdraw on a row EIV never accepted, are
 *    controls that can only produce an error (§9.2).
 * 3. **The filter reaches the server.** This screen exists to answer "what is
 *    stuck"; a filter dropped on the way out returns everything and reads as a
 *    screen with no filter rather than a broken one.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ApiClient, EivSubmissionPage, EivSubmissionRow } from "@ds/sdk";
import { EivQueue } from "./EivQueue.js";
import { de } from "../locale/de.js";

afterEach(cleanup);

function row(over: Partial<EivSubmissionRow> = {}): EivSubmissionRow {
  return {
    enrolmentId: "00000000-0000-4000-8000-000000000001",
    efnMasked: "…7314",
    courseSlug: "adhs-akademie-adult",
    courseTitle: "ADHS Akademie adult",
    vnr: "2760552025919300018",
    status: "queued",
    attemptCount: 0,
    eventEndAt: "2026-08-24T10:00:00.000Z",
    reportDueAt: "2026-09-01T10:00:00.000Z",
    nextAttemptAt: null,
    firstSubmittedAt: null,
    externalReference: null,
    lastError: null,
    dueNow: false,
    ...over,
  };
}

function mount(over: Partial<EivSubmissionPage> = {}) {
  const page: EivSubmissionPage = {
    items: [row()],
    total: 1,
    page: 1,
    perPage: 25,
    dueNow: 0,
    ...over,
  };
  const adminListEivSubmissions = vi.fn().mockResolvedValue(page);
  const adminRequeueEivSubmission = vi.fn().mockResolvedValue(undefined);
  const adminWithdrawEivSubmission = vi.fn().mockResolvedValue(undefined);

  render(
    <EivQueue
      client={
        {
          adminListEivSubmissions,
          adminRequeueEivSubmission,
          adminWithdrawEivSubmission,
        } as unknown as ApiClient
      }
    />,
  );

  return {
    adminListEivSubmissions,
    adminRequeueEivSubmission,
    adminWithdrawEivSubmission,
  };
}

describe("what the screen discloses", () => {
  it("renders the masked EFN and never a whole one", async () => {
    mount({ items: [row({ efnMasked: "…7314" })] });

    expect(await screen.findByText("…7314")).toBeTruthy();
    // The strongest form available from here: no fifteen-digit run anywhere in
    // the rendered output. The VNR is nineteen digits and is deliberately not
    // matched by this.
    expect(document.body.textContent ?? "").not.toMatch(/(?<!\d)\d{15}(?!\d)/u);
  });

  it("shows the VNR, which is not a secret and is what an operator reconciles against", async () => {
    mount();
    expect(await screen.findByText(/2760552025919300018/u)).toBeTruthy();
  });
});

describe("an action is offered only where it can work", () => {
  it("offers requeue on a row the worker has given up on", async () => {
    const client = mount({ items: [row({ status: "failed_permanent" })] });
    fireEvent.click(await screen.findByRole("button", { name: de.eivQueue.requeue }));

    await waitFor(() =>
      expect(client.adminRequeueEivSubmission).toHaveBeenCalledWith(
        "00000000-0000-4000-8000-000000000001",
      ),
    );
  });

  it("does not offer requeue while the worker is still retrying", async () => {
    // The button would do nothing an operator could observe, and would read as
    // a fix that did not work.
    mount({ items: [row({ status: "failed_retryable" })] });
    await screen.findByText("ADHS Akademie adult");
    expect(screen.queryByRole("button", { name: de.eivQueue.requeue })).toBeNull();
  });

  it("offers withdraw only on a submission the authority accepted", async () => {
    mount({ items: [row({ status: "submitted" })] });
    expect(
      await screen.findByRole("button", { name: de.eivQueue.withdrawFor("…7314") }),
    ).toBeTruthy();

    cleanup();
    mount({ items: [row({ status: "queued" })] });
    await screen.findByText("ADHS Akademie adult");
    expect(
      screen.queryByRole("button", { name: de.eivQueue.withdrawFor("…7314") }),
    ).toBeNull();
  });
});

describe("the filter reaches the server", () => {
  it("asks for one status, and starts again at page 1", async () => {
    const client = mount();
    await screen.findByText("ADHS Akademie adult");

    fireEvent.click(
      screen.getByRole("button", { name: de.eivQueue.status.failed_permanent }),
    );

    await waitFor(() =>
      expect(client.adminListEivSubmissions).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: "failed_permanent", page: 1 }),
      ),
    );
  });

  it("sends no status at all for Alle, rather than a sentinel", async () => {
    // `status: "all"` would reach the API as a value its enum does not hold and
    // come back 422 — an empty list that reads as "nothing is queued".
    const client = mount();
    await waitFor(() => expect(client.adminListEivSubmissions).toHaveBeenCalled());

    const [first] = client.adminListEivSubmissions.mock.calls[0] as [
      Record<string, unknown>,
    ];
    expect(first).not.toHaveProperty("status");
  });
});

describe("the number an operator arming the worker needs", () => {
  it("says how many the next sweep will file", async () => {
    mount({ dueNow: 3 });
    expect(await screen.findByText(de.eivQueue.dueBody(3))).toBeTruthy();
  });

  it("says nothing when none are due", async () => {
    // A standing "0 fällig" is a line somebody stops reading, and then does not
    // read on the day it says 14.
    mount({ dueNow: 0 });
    await screen.findByText("ADHS Akademie adult");
    expect(screen.queryByText(de.eivQueue.dueTitle)).toBeNull();
  });
});

describe("the deadline, in the time zone it is reckoned in", () => {
  it("renders German local time, not a UTC ISO string", async () => {
    /*
     * The EIV check screen printed raw UTC and it is how a one-day
     * accreditation window went unnoticed: `2025-10-12T22:00:00Z` does not read
     * as "13. Oktober" to anybody (§5).
     */
    mount({ items: [row({ reportDueAt: "2026-09-01T22:30:00.000Z" })] });
    await screen.findByText("ADHS Akademie adult");

    expect(document.body.textContent ?? "").not.toContain("2026-09-01T22:30");
    // 22:30 UTC on 1 September is 00:30 on the 2nd in Berlin — the case where
    // printing the UTC date would name the wrong day.
    expect(await screen.findByText(/02\.09\.2026/u)).toBeTruthy();
  });
});
