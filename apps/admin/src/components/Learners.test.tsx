/**
 * The two writes on the learner list, and the guard one of them did not have
 * (P230-01).
 *
 * ## Why this file exists
 *
 * `useSaver`'s header has predicted this defect since P9-02:
 *
 *   > Written out per screen that is six copies of the same `setBusy(true) /
 *   > try / catch / finally` — and the copies drift: one forgets to clear the
 *   > previous error, **one leaves the button enabled during the request and
 *   > double-submits**, one shows "gespeichert" after a failure. So it lives
 *   > here once.
 *
 * It does not live there once. Seven files use the hook and six hand-roll the
 * triplet, and the sentence "so it lives here once" is why nobody looked —
 * §11.9, a comment is a claim rather than a fact.
 *
 * The prediction came true on this screen, on the write that matters most of
 * the two. `correct()` had no `busy` guard at all while its sibling `requeue()`
 * ten lines below sets one, so **Speichern stayed enabled for the whole round
 * trip**.
 *
 * ## Why a double-submit here is not cosmetic
 *
 * `adminCorrectLearnerName` changes the name that goes on a
 * Teilnahmebescheinigung and into a Punktemeldung. The write itself is
 * idempotent — the second request sets the same string — but
 * `moderation.service.ts` records `learner.name_corrected` in the append-only
 * audit log **per request**. So one correction, two entries, and an auditor
 * reads a record of the operator having changed a physician's name twice.
 *
 * ## What is deliberately not asserted here
 *
 * That two *concurrent* requests cannot both pass the
 * "already submitted to EIV" conflict check. They can — both read the
 * enrolment's stage before either writes — but that is a server-side
 * time-of-check/time-of-use question that exists whatever the button does, and
 * a component test is the wrong instrument for it. Named rather than absorbed.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ApiClient, LearnerRecord } from "@ds/sdk";
import { Learners } from "./Learners.js";
import { de } from "../locale/de.js";

afterEach(cleanup);

const ENROLMENT = "22222222-2222-4222-8222-222222222222";

function learner(over: Partial<LearnerRecord> = {}): LearnerRecord {
  return {
    userId: "11111111-1111-4111-8111-111111111111",
    enrolmentId: ENROLMENT,
    courseSlug: "adhs-akademie-adult",
    courseTitle: "ADHS bei Erwachsenen",
    attestedName: "Dr. med. Lorem Muster",
    maskedEfn: "••••1234",
    watchedPercent: 100,
    quizBestPercent: 90,
    completedAt: "2026-09-03T10:00:00.000Z",
    // `none` is the stage at which the API still permits a correction, which
    // is the only stage where this screen offers the control at all.
    submissionStage: "none",
    certificateStatus: null,
    ...over,
  };
}

/**
 * A client whose correction never resolves until the test says so.
 *
 * The whole property is about the window *during* the request, so a promise
 * that resolves immediately would close that window before the second click
 * and the test would pass on the broken code — §9.1, a check that cannot go
 * red. `release` is what keeps the window open.
 */
function pendingClient() {
  let release: () => void = () => undefined;
  const pending = () =>
    new Promise<void>((resolve) => {
      release = () => resolve();
    });
  const correct = vi.fn(pending);
  const erase = vi.fn(pending);
  const client = {
    adminListLearners: vi.fn(async () => [learner()]),
    adminCorrectLearnerName: correct,
    adminEraseSubject: erase,
  } as unknown as ApiClient;
  return { client, correct, erase, release: () => release() };
}

async function openTheNameEditor(): Promise<void> {
  await waitFor(() => expect(screen.getByText("Dr. med. Lorem Muster")).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: de.learners.correctName }));
  const field = await screen.findByLabelText(de.learners.name);
  fireEvent.change(field, { target: { value: "Prof. Dr. med. Lorem Muster" } });
}

describe("die Namenskorrektur", () => {
  it("sends one correction however many times Speichern is pressed", async () => {
    const { client, correct, release } = pendingClient();
    render(<Learners client={client} courseSlug="adhs-akademie-adult" />);
    await openTheNameEditor();

    const save = screen.getByRole("button", { name: de.common.save });
    fireEvent.click(save);
    fireEvent.click(save);
    fireEvent.click(save);

    expect(
      correct.mock.calls.length,
      "Speichern stayed live during the request, so one correction reached " +
        `the API ${correct.mock.calls.length} times — and every one of them ` +
        "writes its own `learner.name_corrected` entry into the append-only " +
        "audit log",
    ).toBe(1);

    release();
    await waitFor(() => expect(correct.mock.calls.length).toBe(1));
  });

  it("says it is saving, and disables the control while it is", async () => {
    const { client, release } = pendingClient();
    render(<Learners client={client} courseSlug="adhs-akademie-adult" />);
    await openTheNameEditor();

    fireEvent.click(screen.getByRole("button", { name: de.common.save }));

    /*
     * Both halves, because either alone is a half-finished affordance: a
     * disabled button that still reads "Speichern" looks broken, and a button
     * that reads "Wird gespeichert…" while still accepting clicks is a lie
     * (§9.4).
     */
    const saving = await screen.findByRole("button", { name: de.common.saving });
    expect(saving.hasAttribute("disabled")).toBe(true);

    release();
  });
});

describe("die Löschung einer betroffenen Person", () => {
  /**
   * The same property on the Art. 17 path, which is the one that cannot be
   * undone.
   *
   * It is a separate test rather than a parametrised one because the
   * *consequence* differs and the message has to say so. A repeated name
   * correction writes a second audit row; a repeated erasure finds no
   * enrolment — `moderation.service.ts` opens `eraseSubject` with
   * `findEnrolment` and throws `notFound` — so the operator is shown a failure
   * for something that has already happened, beside a row that has already
   * gone.
   *
   * And unlike `Security.removeOwn` and `Customers.remove`, this confirm
   * button is a plain `Button` inside this screen's own two-step, not a
   * `ConfirmButton`, so nothing removed it from the tree on the first click.
   */
  it("erases once however many times the confirmation is pressed", async () => {
    const { client, erase, release } = pendingClient();
    render(<Learners client={client} courseSlug="adhs-akademie-adult" />);
    await waitFor(() => expect(screen.getByText("Dr. med. Lorem Muster")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: de.learners.erase }));
    const reason = await screen.findByLabelText(de.learners.reason);
    fireEvent.change(reason, { target: { value: "Löschantrag der Betroffenen" } });

    const confirm = screen.getByRole("button", { name: de.learners.eraseConfirm });
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    expect(
      erase.mock.calls.length,
      "the confirmation stayed live during the request, so an irreversible " +
        `Art. 17 erasure was requested ${erase.mock.calls.length} times — and ` +
        "the second finds no enrolment, so the screen reports a failure for an " +
        "erasure that succeeded",
    ).toBe(1);

    release();
    await waitFor(() => expect(erase.mock.calls.length).toBe(1));
  });
});
