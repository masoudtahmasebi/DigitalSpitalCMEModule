/**
 * The EIV connection check, as two people read it (P103-01).
 *
 * ## What is under test
 *
 * 1. **The headline tells the three outcomes apart.** "Works", "your password
 *    is wrong" and "the Ärztekammer did not answer" send an operator to three
 *    different places. Collapsing the last two into "failed" — which is what a
 *    boolean would do — sends half of them to retype a password that was never
 *    the problem.
 * 2. **The technical detail is *behind* the headline, not instead of it.** The
 *    client asked for this explicitly, and it is right: a screen that opens
 *    with `kind: rate_limited` has told the wrong person first.
 * 3. **The password never comes back.** Not in the response, not rendered, not
 *    left in the field after a successful check.
 * 4. **No VNR, no button** — §9.2, since the endpoint would 409.
 *
 * The client is a plain object rather than a mock proxy: a method the component
 * starts calling and this file does not provide is a `TypeError` here, not a
 * silently recorded call that passes.
 */

import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ApiClient, EivConnectionReport } from "@ds/sdk";
import { EivCheckPanel } from "./EivCheck.js";
import { de } from "../locale/de.js";

afterEach(cleanup);

const WORKING: EivConnectionReport = {
  endpoint: "https://backend.eiv-fobi.de",
  /*
   * `live` with the worker **off** is the default fixture on purpose: it is the
   * state the client was asked to deploy in, and it is the one where the screen
   * must be informative without raising an alarm. The armed case gets its own
   * test below, so a warning that rendered unconditionally would fail here
   * rather than pass everywhere.
   */
  tier: "live",
  submissionsEnabled: false,
  vnr: "2760552025919300018",
  usedStoredPassword: true,
  steps: [
    { step: "authenticate", ok: true },
    { step: "event", ok: true },
    { step: "reported", ok: true },
  ],
  event: {
    title: "ADHS Akademie adult",
    validFrom: "2025-10-13",
    validUntil: "2026-10-12",
    category: "D",
    attendancePoints: 4,
    assessmentPoints: 0,
    locked: false,
  },
  reportedCount: 0,
};

function mount(report: EivConnectionReport, over: { claimsLernerfolg?: boolean } = {}) {
  const adminCheckEivConnection = vi.fn().mockResolvedValue(report);
  render(
    <EivCheckPanel
      client={{ adminCheckEivConnection } as unknown as ApiClient}
      courseSlug="adhs-akademie-adult"
      hasVnr
      claimsLernerfolg={over.claimsLernerfolg ?? false}
    />,
  );
  return { adminCheckEivConnection };
}

it("does not call anybody until somebody asks", () => {
  // Opening a settings screen must not make an authenticated request to a third
  // party's system on the customer's credential.
  const { adminCheckEivConnection } = mount(WORKING);
  expect(adminCheckEivConnection).not.toHaveBeenCalled();
});

it("leads with a sentence a project manager can act on", async () => {
  mount(WORKING);
  fireEvent.click(screen.getByRole("button", { name: de.eivCheck.action }));

  expect(await screen.findByText(de.eivCheck.resultOk)).toBeTruthy();
  // And the per-step wording is present but folded away behind a disclosure.
  expect(screen.getByText(de.eivCheck.detailToggle)).toBeTruthy();
});

/*
 * P107-01 — which register, and is it armed.
 *
 * The client set `EIV_BASE_URL=https://backend.eiv-fobi.de` and reported
 * *"i updated this, still shows with test in verwaltung"*: they were reading
 * the previous value (the deploy had not run), and they had no way to tell
 * `backend-test.eiv-fobi.de` from `backend.eiv-fobi.de` in the first place.
 * One word separates EIV's sandbox from the Ärztekammer's live register, and
 * the screen printed only the URL.
 *
 * The armed state matters more than the address. It lived in `config.env` and
 * appeared nowhere in the product, so the one person entitled to decide whether
 * to go live could not see the current state of that decision (§9.4, §9.10).
 */
it("says in words which register the address is", async () => {
  mount(WORKING);
  fireEvent.click(screen.getByRole("button", { name: de.eivCheck.action }));

  // Both: the literal string for an operator reconciling against config.env,
  // and the sentence for one deciding whether to go live.
  expect(await screen.findByText("https://backend.eiv-fobi.de")).toBeTruthy();
  expect(screen.getByText(de.eivCheck.tier.live)).toBeTruthy();
});

it("tells EIV's test system apart from the live register", async () => {
  // The distinction the whole ticket is about. Same shape of URL, opposite
  // consequence.
  mount({ ...WORKING, endpoint: "https://backend-test.eiv-fobi.de", tier: "test" });
  fireEvent.click(screen.getByRole("button", { name: de.eivCheck.action }));

  expect(await screen.findByText(de.eivCheck.tier.test)).toBeTruthy();
  expect(screen.queryByText(de.eivCheck.tier.live)).toBeNull();
});

it("says whether the worker is armed, either way", async () => {
  mount(WORKING);
  fireEvent.click(screen.getByRole("button", { name: de.eivCheck.action }));
  expect(await screen.findByText(de.eivCheck.submissionsOff)).toBeTruthy();

  cleanup();
  mount({ ...WORKING, submissionsEnabled: true });
  fireEvent.click(screen.getByRole("button", { name: de.eivCheck.action }));
  expect(await screen.findByText(de.eivCheck.submissionsOn)).toBeTruthy();
});

it("warns only when a real Punktemeldung is actually possible", async () => {
  /*
   * Four states, and only one of them is dangerous. A warning on the live
   * endpoint alone would fire during exactly the credential test the client was
   * told to run first — and a warning nobody can avoid is a warning nobody
   * reads (§9.2's cousin).
   */
  for (const report of [
    WORKING, // live, worker off — the credential test
    { ...WORKING, tier: "test" as const, submissionsEnabled: true },
    { ...WORKING, tier: "mock" as const, submissionsEnabled: true },
  ]) {
    mount(report);
    fireEvent.click(screen.getByRole("button", { name: de.eivCheck.action }));
    await screen.findByText(de.eivCheck.endpoint);
    expect(screen.queryByText(de.eivCheck.liveArmed)).toBeNull();
    cleanup();
  }

  mount({ ...WORKING, submissionsEnabled: true });
  fireEvent.click(screen.getByRole("button", { name: de.eivCheck.action }));
  expect(await screen.findByText(de.eivCheck.liveArmed)).toBeTruthy();
});

it("treats an unrecognised host as live, as every other guard does", async () => {
  // `requiresLiveConsent` fails closed on an unknown host. A warning that
  // stopped at the recognised one would be quieter than the rule it describes.
  mount({
    ...WORKING,
    endpoint: "https://eiv-proxy.internal",
    tier: "unknown",
    submissionsEnabled: true,
  });
  fireEvent.click(screen.getByRole("button", { name: de.eivCheck.action }));

  expect(await screen.findByText(de.eivCheck.liveArmed)).toBeTruthy();
  expect(screen.getByText(de.eivCheck.tier.unknown)).toBeTruthy();
});

it("says the password is wrong when it is, and does not blame the network", async () => {
  // No `event` and no `reportedCount`: the handshake failed, so neither read
  // produced anything. Omitted rather than set to undefined — the contract
  // marks them optional and `exactOptionalPropertyTypes` holds us to it.
  mount({
    endpoint: WORKING.endpoint,
    tier: WORKING.tier,
    submissionsEnabled: false,
    vnr: WORKING.vnr,
    usedStoredPassword: true,
    steps: [
      { step: "authenticate", ok: false, kind: "auth", detail: "EIV rejected the VNR" },
      { step: "event", ok: false, kind: "auth", detail: "EIV rejected the VNR" },
      { step: "reported", ok: false, kind: "auth", detail: "EIV rejected the VNR" },
    ],
  });
  fireEvent.click(screen.getByRole("button", { name: de.eivCheck.action }));

  expect(await screen.findByText(de.eivCheck.resultAuthFailed)).toBeTruthy();
  expect(screen.queryByText(de.eivCheck.resultUnreachable)).toBeNull();
  // The advice names an action, not a diagnosis.
  // Once, not once per failed step — three identical instructions is the
  // information design P100-01 removed one screen over.
  expect(screen.getAllByText(de.eivCheck.advice.auth)).toHaveLength(1);
});

it("distinguishes an accepted credential from a failed query", async () => {
  // The credentials were fine; EIV rate-limited the second call. Telling this
  // operator to check their password would be the wrong instruction.
  mount({
    ...WORKING,
    steps: [
      { step: "authenticate", ok: true },
      { step: "event", ok: true },
      { step: "reported", ok: false, kind: "rate_limited", detail: "429" },
    ],
  });
  fireEvent.click(screen.getByRole("button", { name: de.eivCheck.action }));

  expect(await screen.findByText(de.eivCheck.resultUnreachable)).toBeTruthy();
  expect(screen.queryByText(de.eivCheck.resultAuthFailed)).toBeNull();
});

it("names which host answered", async () => {
  // "It works" and "it works against the mock" are different sentences, and
  // only one of them means a physician's points will be reported (§9.9).
  mount(WORKING);
  fireEvent.click(screen.getByRole("button", { name: de.eivCheck.action }));

  expect(await screen.findByText("https://backend.eiv-fobi.de")).toBeTruthy();
});

it("shows the accredited period, which is what a completion date is checked against", async () => {
  mount(WORKING);
  fireEvent.click(screen.getByRole("button", { name: de.eivCheck.action }));

  expect(await screen.findByText("2025-10-13 – 2026-10-12")).toBeTruthy();
});

it("warns when the course claims a point the accreditation does not carry", async () => {
  // S25's trap: `assessmentPoints: 0` while the course reports Lernerfolg means
  // every completion is refused, one at a time, after the learner has finished.
  mount(WORKING, { claimsLernerfolg: true });
  fireEvent.click(screen.getByRole("button", { name: de.eivCheck.action }));

  expect(await screen.findByText(de.eivCheck.lernerfolgMismatch)).toBeTruthy();
});

it("stays quiet about the mismatch when the course claims nothing", async () => {
  mount(WORKING, { claimsLernerfolg: false });
  fireEvent.click(screen.getByRole("button", { name: de.eivCheck.action }));

  await screen.findByText(de.eivCheck.resultOk);
  expect(screen.queryByText(de.eivCheck.lernerfolgMismatch)).toBeNull();
});

it("sends a typed password in the body, and clears it once it has worked", async () => {
  const { adminCheckEivConnection } = mount({ ...WORKING, usedStoredPassword: false });

  const field = screen.getByLabelText(de.eivCheck.password) as HTMLInputElement;
  // `type="password"`, so it is not readable over a shoulder or by a screen
  // recorder.
  expect(field.type).toBe("password");
  fireEvent.change(field, { target: { value: "geheim" } });
  fireEvent.click(screen.getByRole("button", { name: de.eivCheck.action }));

  await waitFor(() =>
    expect(adminCheckEivConnection).toHaveBeenCalledWith("adhs-akademie-adult", {
      vnrPassword: "geheim",
    }),
  );

  // Cleared on success: it has done its job and should not sit in a DOM node
  // for the rest of the session.
  await waitFor(() => expect(field.value).toBe(""));
  // And it is nowhere on the screen.
  expect(screen.queryByText(/geheim/u)).toBeNull();
});

it("uses the stored password when the field is empty", async () => {
  const { adminCheckEivConnection } = mount(WORKING);
  fireEvent.click(screen.getByRole("button", { name: de.eivCheck.action }));

  await waitFor(() =>
    expect(adminCheckEivConnection).toHaveBeenCalledWith("adhs-akademie-adult", {}),
  );
});

it("offers no button when there is no VNR to check", () => {
  // The endpoint would answer 409. A refusal that looks like a fault when it is
  // an unfinished form one field up is worse than an absent control (§9.2).
  render(
    <EivCheckPanel
      client={{} as unknown as ApiClient}
      courseSlug="adhs-akademie-adult"
      hasVnr={false}
      claimsLernerfolg={false}
    />,
  );

  expect(screen.queryByRole("button", { name: de.eivCheck.action })).toBeNull();
  expect(screen.getByText(de.eivCheck.needsVnr)).toBeTruthy();
});

it("says plainly that it reports nobody", () => {
  // An operator who is unsure whether this files a Punktemeldung will not press
  // it; one who wrongly assumes it does not is the person we must never have.
  mount(WORKING);
  expect(screen.getByText(de.eivCheck.readOnly)).toBeTruthy();
});
