/**
 * The two second-factor screens, and the one thing they have in common
 * (P251-06).
 *
 * ## Why this file exists at all
 *
 * Nothing drove `SignIn` before it. The screen standing between a stolen
 * password and every customer's data was covered only through
 * `apps/e2e/support/console.ts`, by a helper that reached it and then had to
 * guess which of the two states it was looking at.
 *
 * It guessed with a `Promise.race` between the enrolment heading and the code
 * field, and those are **both** on the enrolment screen — one form, one field,
 * the panel above it. So the winner was whichever locator Playwright resolved
 * first, and when the field won the helper skipped the key it was being offered
 * and failed with "was asked for a code this harness has no secret for" on the
 * screen that was showing the secret three lines up. It passed most runs.
 *
 * ## What these assert, and why it is this and not more
 *
 * The overlap itself, as a property of the product rather than an assumption in
 * a harness:
 *
 * 1. the enrolment panel offers a key **and** the code field;
 * 2. an ordinary code prompt offers the field and **no key**;
 * 3. so the field alone cannot tell them apart, and the heading can.
 *
 * That is the whole fact the harness depends on, stated where it can go red in
 * a second rather than in a browser run. If the panel is ever reworked so the
 * key is on its own screen, (1) fails here and the helper's assumption is
 * re-examined deliberately instead of by a flake.
 *
 * The password step, the lockout message and the forgot-password flow are not
 * covered here. They are not what P251-06 was about, and a file that grows to
 * cover a component because it happens to be open is how a suite stops saying
 * what it is for.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { de } from "../locale/de.js";

const signIn = vi.fn();
const beginEnrolment = vi.fn();
const submitCode = vi.fn();
const requestPasswordReset = vi.fn();

vi.mock("../staff-auth.js", () => ({
  signIn: (...args: unknown[]) => signIn(...args),
  beginEnrolment: (...args: unknown[]) => beginEnrolment(...args),
  submitCode: (...args: unknown[]) => submitCode(...args),
  requestPasswordReset: (...args: unknown[]) => requestPasswordReset(...args),
}));

const { SignIn } = await import("./SignIn.js");

/**
 * A secret shaped exactly like the one the server issues: 32 base32 characters,
 * which is what `console.ts` reads off the page with `/\b[A-Z2-7]{32}\b/`.
 *
 * Deliberately a readable run of letters rather than something random-looking,
 * for the reason `problem-details.filter.test.ts` gives about its token: a
 * realistic secret in a committed file is a secret scanner's problem, and the
 * assertions only need the shape.
 */
const SECRET = "AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHH";
const OTPAUTH = `otpauth://totp/DS?secret=${SECRET}&issuer=DS`;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** Sign in, with whatever `signIn` has been told to answer. */
async function arriveAtSecondFactor(): Promise<void> {
  render(<SignIn apiBase="http://api.test" onSignedIn={() => undefined} />);

  const { fireEvent } = await import("@testing-library/react");
  fireEvent.change(screen.getByLabelText(de.auth.email), {
    target: { value: "operator@example.test" },
  });
  fireEvent.change(screen.getByLabelText(de.auth.password), {
    target: { value: "a-password" },
  });
  fireEvent.click(screen.getByRole("button", { name: de.auth.signIn }));

  await waitFor(() => {
    expect(screen.getByLabelText(de.auth.codeLabel)).toBeTruthy();
  });
}

describe("the second factor a console account is asked for", () => {
  it("offers the key and the code field on the same enrolment screen", async () => {
    signIn.mockResolvedValue({ kind: "enrolment_required", challenge: "c1" });
    beginEnrolment.mockResolvedValue(OTPAUTH);

    await arriveAtSecondFactor();

    // The heading, which is what tells the two screens apart.
    expect(screen.getByText(de.auth.enrolTitle)).toBeTruthy();
    // The key, in the base32 form an authenticator app takes.
    expect(screen.getByText(SECRET)).toBeTruthy();
    // And the field — on this screen as well, which is the whole point.
    expect(screen.getByLabelText(de.auth.codeLabel)).toBeTruthy();
  });

  it("offers the code field and no key when a factor is already enrolled", async () => {
    signIn.mockResolvedValue({ kind: "code_required", challenge: "c2" });

    await arriveAtSecondFactor();

    expect(screen.getByLabelText(de.auth.codeLabel)).toBeTruthy();
    expect(screen.queryByText(de.auth.enrolTitle)).toBeNull();
    // No base32 key of the length the harness reads, anywhere on the screen.
    expect(document.body.textContent ?? "").not.toMatch(/\b[A-Z2-7]{32}\b/u);
    expect(beginEnrolment).not.toHaveBeenCalled();
  });

  it("is why the code field alone cannot say which screen this is", async () => {
    // The two states, driven through the same component, asserting the thing
    // `console.ts` got wrong: the field is present either way, so a race
    // between it and the heading is a race between two witnesses to one state.
    for (const kind of ["enrolment_required", "code_required"] as const) {
      signIn.mockResolvedValue({ kind, challenge: "c3" });
      beginEnrolment.mockResolvedValue(OTPAUTH);

      await arriveAtSecondFactor();

      expect(screen.getByLabelText(de.auth.codeLabel)).toBeTruthy();
      cleanup();
    }
  });
});
