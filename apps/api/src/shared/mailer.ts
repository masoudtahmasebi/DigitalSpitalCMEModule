/**
 * Sending one message, now, and finding out whether it left (P40-01).
 *
 * ## Why this is not the certificate delivery queue
 *
 * `DeliveryChannel` and its SMTP implementation already exist, and this uses
 * them — `sendNow` builds an `OutboundMessage` and hands it to the same
 * `SmtpDeliveryChannel` a certificate goes through. What is different is
 * everything around it.
 *
 * A certificate is *durable*: it is written to a queue, retried on a schedule,
 * and a physician who does not get one today gets one tomorrow. A password
 * reset is the opposite. It is worth nothing an hour later
 * (`RESET_VALID_MINUTES`), the person is sitting in front of the screen, and
 * the only useful answers are "check your inbox" and "we could not send it".
 * Putting it on the retry queue would mean a reset link arriving after it has
 * expired, which is worse than none.
 *
 * ## What the caller may not learn
 *
 * `sendNow` reports whether the send succeeded. The *endpoints* deliberately do
 * not pass that on: `POST …/password-reset` answers 202 whether the address
 * exists or not, because a different answer for a known address turns the form
 * into an account-enumeration oracle. So the outcome here goes to the log, and
 * the person gets a sentence that is true in every case — "if there is an
 * account for this address, a link is on its way".
 */

import { SmtpDeliveryChannel, SMTP_KEYS } from "@ds/mail";
import type { DeliveryOutcome } from "@ds/plugin-api";

/**
 * Where a message leaves from. Structurally the same shape whether it came
 * from `platform_smtp` or from a project row — which is the point, since the
 * two planes' resets differ only in that lookup.
 */
export interface MailSender {
  readonly host: string;
  readonly port: number | null;
  readonly username: string | null;
  /** Already decrypted by the caller, for this one send. */
  readonly password: string | null;
  readonly secure: boolean;
  readonly fromAddress: string;
  readonly fromName: string | null;
}

export interface OutboundLetter {
  readonly to: string;
  readonly subject: string;
  /** Plain text. Never an EFN, a quiz result or a password — see docs/gdpr.md. */
  readonly body: string;
}

const channel = new SmtpDeliveryChannel();

/**
 * Whether these settings are complete enough to send anything.
 *
 * Host and sender address, and nothing else is required: an unauthenticated
 * relay on the same network is a legitimate configuration, and demanding a
 * username would refuse it. What is *not* legitimate is a half-filled form
 * saved by somebody who then wonders why no mail arrives, which is why the
 * console shows this same verdict rather than letting it be discovered by a
 * physician who never got their link.
 */
export function canSend(sender: {
  host: string | null;
  fromAddress: string | null;
}): boolean {
  return (
    sender.host !== null &&
    sender.host.trim() !== "" &&
    sender.fromAddress !== null &&
    sender.fromAddress.trim() !== ""
  );
}

/**
 * Send it, and say what happened.
 *
 * Never throws for a delivery failure — a caller that must answer 202 whatever
 * happens should not have to wrap this in a `try`. A programming error still
 * throws, as it should.
 */
export async function sendNow(
  sender: MailSender,
  letter: OutboundLetter,
): Promise<DeliveryOutcome> {
  const transport: Record<string, string> = {
    [SMTP_KEYS.host]: sender.host,
    [SMTP_KEYS.secure]: sender.secure ? "true" : "false",
  };
  if (sender.port !== null) transport[SMTP_KEYS.port] = String(sender.port);
  if (sender.username !== null) transport[SMTP_KEYS.username] = sender.username;
  if (sender.password !== null) transport[SMTP_KEYS.password] = sender.password;

  const from =
    sender.fromName === null || sender.fromName.trim() === ""
      ? sender.fromAddress
      : `${sender.fromName} <${sender.fromAddress}>`;

  try {
    return await channel.deliver({
      to: letter.to,
      from,
      subject: letter.subject,
      body: letter.body,
      transport,
    });
  } catch (error) {
    // `deliver` classifies SMTP failures itself; this is the case it cannot —
    // DNS, a refused connection, a TLS error. Transient by default, because
    // the alternative is calling a network blip permanent.
    return {
      status: "transient",
      reason: error instanceof Error ? error.message : "unknown transport failure",
    };
  }
}
