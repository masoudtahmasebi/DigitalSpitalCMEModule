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
    vnr: "2761234202512345678",
    status: "queued",
    attemptCount: 0,
    eventEndAt: "2026-08-24T10:00:00.000Z",
    reportDueAt: "2026-09-01T10:00:00.000Z",
    nextAttemptAt: null,
    firstSubmittedAt: null,
    externalReference: null,
    lastError: null,
    failureKind: null,
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
    // P121-01. Default to the safe reading: a fixture that files by default
    // would make every unrelated case exercise the warning banner.
    reporting: { submissionsEnabled: false, tier: "mock", willFile: false },
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
    expect(await screen.findByText(/2761234202512345678/u)).toBeTruthy();
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

/**
 * P119-03. `permanent_rejection` in `lastError` was the answer to two different
 * questions and no answer to either: it collapses a refused EFN, a blocked VNR
 * and a missing credential into one word, and each of those sends the operator
 * somewhere else. Migration 0048 keeps EIV's own answer; this is the screen
 * saying it in the operator's language.
 *
 * The case that matters most is `validation`, where the correct instruction is
 * **do not go looking for a fix** — support cannot set another person's EFN
 * (ADR-0004), and a screen that stayed silent would send them hunting for a
 * control that does not and must not exist (§9.2, §9.4).
 */
describe("what EIV actually said", () => {
  it("names the operator's own next step for a refused event", async () => {
    mount({ items: [row({ status: "failed_permanent", failureKind: "business" })] });

    await waitFor(() =>
      expect(screen.getByText(de.eivQueue.failureKind.business)).toBeTruthy(),
    );
  });

  it("names the setting to fill for a credential failure", async () => {
    mount({ items: [row({ status: "failed_permanent", failureKind: "auth" })] });

    await waitFor(() =>
      expect(screen.getByText(de.eivQueue.failureKind.auth)).toBeTruthy(),
    );
  });

  it("tells the operator a refused EFN is not theirs to fix", async () => {
    mount({ items: [row({ status: "failed_permanent", failureKind: "validation" })] });

    await waitFor(() =>
      expect(screen.getByText(de.eivQueue.failureKind.validation)).toBeTruthy(),
    );
  });

  /*
   * The control. A row with no kind — everything written before P119-01, where
   * EIV's answer was discarded before it was stored — must not acquire a
   * sentence it has no evidence for. Saying nothing is the honest outcome, and
   * `lastError` below it is still there for whoever is debugging the worker.
   */
  it("invents nothing for a row from before the kind was kept", async () => {
    mount({
      items: [
        row({
          status: "failed_permanent",
          failureKind: null,
          lastError: "permanent_rejection",
        }),
      ],
    });

    await waitFor(() => expect(screen.getByText(de.eivQueue.lastError)).toBeTruthy());
    expect(screen.queryByText(de.eivQueue.failureKind.validation)).toBeNull();
    expect(screen.queryByText(de.eivQueue.failureKind.business)).toBeNull();
  });
});

/**
 * Whether this installation will file anything (P121-01).
 *
 * The screen could not say. Both inputs sat in the API's configuration and
 * reached a screen only inside an EIV-Abgleich result — a check somebody has to
 * know to run, on a course that already has a VNR. Anybody without a shell on
 * the host had no way to establish it, which is exactly the person doing the
 * testing: a completion on an accredited course queues a Punktemeldung against
 * a real VNR, and this posture is the only thing between a test EFN and a
 * statutory filing.
 */
describe("the reporting posture", () => {
  it("says so when nothing will be sent", async () => {
    mount({ reporting: { submissionsEnabled: false, tier: "mock", willFile: false } });

    await waitFor(() =>
      expect(screen.getByText(de.eivQueue.reporting.offTitle)).toBeTruthy(),
    );
    expect(
      screen.getByText(new RegExp(de.eivQueue.reporting.off.slice(0, 40))),
    ).toBeTruthy();
  });

  it("warns when completions will reach a real Ärztekammer", async () => {
    mount({ reporting: { submissionsEnabled: true, tier: "live", willFile: true } });

    await waitFor(() =>
      expect(screen.getByText(de.eivQueue.reporting.liveTitle)).toBeTruthy(),
    );
  });

  /*
   * The half that is easy to leave out. `willFile` is the API's answer, and a
   * screen that re-derived it from the other two would be a second opinion
   * about what the worker does — so the enabled-but-pointed-at-a-mock case must
   * read as *off*, because that is what the worker will do.
   */
  it("follows willFile rather than the enabled flag", async () => {
    mount({ reporting: { submissionsEnabled: true, tier: "mock", willFile: false } });

    await waitFor(() =>
      expect(screen.getByText(de.eivQueue.reporting.offTitle)).toBeTruthy(),
    );
    expect(screen.queryByText(de.eivQueue.reporting.liveTitle)).toBeNull();
  });

  it("names which endpoint the installation points at", async () => {
    mount({ reporting: { submissionsEnabled: true, tier: "test", willFile: true } });

    await waitFor(() =>
      expect(
        screen.getByText(new RegExp(de.eivQueue.reporting.endpoint.test)),
      ).toBeTruthy(),
    );
  });
});
