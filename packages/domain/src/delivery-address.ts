/**
 * Where a Teilnahmebescheinigung is sent, when that differs from the account
 * address (P183-02).
 *
 * ## Why this is a rule and not a zod schema on two routes
 *
 * Two callers set it — the physician, on their own enrolment, and an operator,
 * from the support panel — and CLAUDE.md §9.10b is about exactly this: one
 * value, one home, and every reader going there. Two validators would drift,
 * and the direction that drifts silently is the permissive one: an address the
 * console accepts and the learner's route refuses is a support call, while an
 * address the learner's route accepts and delivery cannot use is a certificate
 * nobody receives and no screen explains.
 *
 * ## What it deliberately does not do
 *
 * **Decide whether an address exists.** Only the mail server knows that. A
 * regex that refuses a valid unusual address — a plus tag, a long TLD, a
 * hyphenated subdomain, an umlaut in the local part — is a physician who cannot
 * be sent their own certificate, and the failure lands on the one person who
 * cannot do anything about it. So the shape check is the same minimal one the
 * database constraint applies, and the real verdict comes from the attempt:
 * a rejection is recorded as `permanent_rejection` and shown on the row.
 *
 * ## Why `unchanged` is an answer and not a success
 *
 * Setting an address to the one already stored writes nothing and, more
 * importantly, must not present as "saved" on a screen where saving is the
 * thing somebody is trying to confirm. The same distinction `efnCorrection`
 * draws, for the same reason.
 */

/** The verdict. `field` on a rejection, never the value: it is personal data. */
export type DeliveryAddressDecision =
  | { readonly ok: true; readonly email: string | null }
  | { readonly ok: false; readonly reason: "malformed" | "unchanged" | "too_long" };

/**
 * Postgres' `text` has no length limit and an unbounded address is a row
 * somebody can make arbitrarily large through a form. 254 is the RFC 5321
 * maximum for a forward path, so nothing refused here could have been
 * deliverable anyway.
 */
export const DELIVERY_EMAIL_MAX = 254;

export function deliveryAddress(input: {
  /** What was submitted. An empty string means "clear it and use the account address". */
  readonly proposed: string;
  /** What is stored on the enrolment today, or null when nothing is. */
  readonly current: string | null;
}): DeliveryAddressDecision {
  const trimmed = input.proposed.trim();

  // Clearing is legitimate and is how somebody goes back to their account
  // address — so it is an `ok` with null rather than a rejection.
  if (trimmed === "") {
    return input.current === null
      ? { ok: false, reason: "unchanged" }
      : { ok: true, email: null };
  }

  if (trimmed.length > DELIVERY_EMAIL_MAX) {
    return { ok: false, reason: "too_long" };
  }

  /*
   * The same minimal shape as `enrolments_delivery_email_shape` and
   * `admin_users_email_shape`: an `@` with something before it. Whitespace is
   * refused separately because a pasted address routinely arrives with a
   * trailing name or a line break, and `"Dr. Muster <m@example.de>"` would
   * otherwise reach an SMTP header — which is the injection `headerSafe`
   * exists to stop one layer further on, and this is the layer that can say so
   * to the person typing.
   */
  const at = trimmed.indexOf("@");
  if (at < 1 || at === trimmed.length - 1 || /\s/u.test(trimmed)) {
    return { ok: false, reason: "malformed" };
  }
  if (trimmed.lastIndexOf("@") !== at) {
    return { ok: false, reason: "malformed" };
  }

  // Case-insensitively unchanged: `A@B.de` and `a@b.de` are one address, and
  // reporting a save for a keystroke that changed nothing is a false statement
  // about what the system now holds.
  if (input.current !== null && input.current.toLowerCase() === trimmed.toLowerCase()) {
    return { ok: false, reason: "unchanged" };
  }

  return { ok: true, email: trimmed };
}
