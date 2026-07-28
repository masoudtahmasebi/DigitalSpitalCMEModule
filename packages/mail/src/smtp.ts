/**
 * SMTP as a `DeliveryChannel` (P8-02, P8-03, ADR-0010).
 *
 * The second implementation of a capability contract living outside
 * `apps/api` — the first being `EivAccreditationReporter`. Same shape, same
 * reason: a customer who wants certificates in their own portal inbox rather
 * than by email writes a file like this one and registers it instead.
 *
 * ## Per-project connections, and why they are not pooled
 *
 * SMTP settings come from the project row and differ per customer (P8-02), so a
 * transport is built per send from `message.transport` and closed afterwards.
 * That is a TCP connection and a TLS handshake per certificate, which sounds
 * wasteful and is not: this queue delivers a few messages an hour, and the
 * alternative — a cache of open connections keyed by customer — would hold each
 * customer's credentials in memory indefinitely for a saving nobody would
 * measure.
 *
 * ## Classifying the failure is the whole job
 *
 * Everything else here is nodemailer. What this file actually contributes is
 * deciding whether a failure is worth retrying, because the caller's queue turns
 * on that answer: a transient failure retried forever is a queue that never
 * drains, and a permanent one retried once is a physician who never gets their
 * Teilnahmebescheinigung.
 */

import { createTransport } from "nodemailer";
import type { DeliveryChannel, DeliveryOutcome, OutboundMessage } from "@ds/plugin-api";

/** The keys this channel reads out of `message.transport`. */
export const SMTP_KEYS = {
  host: "host",
  port: "port",
  username: "username",
  password: "password",
  /** `"true"` for implicit TLS on connect (port 465). Anything else is STARTTLS. */
  secure: "secure",
} as const;

const DEFAULT_PORT = 587;

/**
 * SMTP reply codes that mean "do not ask again".
 *
 * 5xx is a permanent rejection by definition (RFC 5321 §4.2.1), with two
 * carve-outs that are permanent in the code but transient in practice and are
 * deliberately **not** treated as permanent here:
 *
 * - **552** — mailbox full. RFC-permanent, operationally a quota that gets
 *   cleared. Retrying is right.
 * - **554** — used by some servers as a catch-all for greylisting.
 *
 * Everything else in 5xx stops the queue. Getting this wrong in the safe
 * direction (retrying a permanent failure) wastes six attempts and then stops;
 * getting it wrong the other way loses a certificate silently, so the list of
 * exceptions is short and each one is here for a named reason.
 */
const TRANSIENT_5XX = new Set([552, 554]);

export class SmtpDeliveryChannel implements DeliveryChannel {
  readonly id = "smtp";

  async deliver(message: OutboundMessage): Promise<DeliveryOutcome> {
    const host = message.transport[SMTP_KEYS.host];
    if (host === undefined || host === "") {
      // Not a transport failure — a project that was never configured. Told
      // apart from a connection problem so the participant list can say which.
      return { status: "permanent", reason: "no SMTP host configured" };
    }

    const port = Number(message.transport[SMTP_KEYS.port] ?? DEFAULT_PORT);
    const username = message.transport[SMTP_KEYS.username];
    const password = message.transport[SMTP_KEYS.password];

    const transport = createTransport({
      host,
      port: Number.isFinite(port) && port > 0 ? port : DEFAULT_PORT,
      // Implicit TLS on 465; STARTTLS everywhere else. `requireTLS` makes the
      // upgrade mandatory rather than best-effort — a server that does not
      // offer STARTTLS gets an error instead of a plaintext send carrying a
      // physician's name and a certificate.
      secure: message.transport[SMTP_KEYS.secure] === "true" || port === 465,
      requireTLS: true,
      ...(username === undefined || password === undefined
        ? {}
        : { auth: { user: username, pass: password } }),
      // Bounded, so one unreachable server cannot hold a sweep open.
      connectionTimeout: 15_000,
      greetingTimeout: 10_000,
      socketTimeout: 30_000,
    });

    try {
      const info = await transport.sendMail({
        from: message.from,
        to: message.to,
        subject: message.subject,
        text: message.body,
        attachments: (message.attachments ?? []).map((attachment) => ({
          filename: attachment.filename,
          contentType: attachment.mediaType,
          content: Buffer.from(attachment.bytes),
        })),
      });

      return {
        status: "delivered",
        ...(info.messageId === undefined ? {} : { reference: info.messageId }),
      };
    } catch (error) {
      return classify(error);
    } finally {
      // Releases the socket. Without it the pool keeps a connection — and the
      // credentials behind it — alive until the process exits.
      transport.close();
    }
  }
}

/**
 * Turn a nodemailer error into a retry decision.
 *
 * Exported for its own tests: this is the part with judgement in it, and the
 * alternative to testing it directly is standing up an SMTP server that can be
 * made to fail in six specific ways.
 */
export function classify(error: unknown): DeliveryOutcome {
  const code = responseCode(error);

  if (code !== undefined && code >= 500 && code < 600 && !TRANSIENT_5XX.has(code)) {
    return { status: "permanent", reason: `SMTP ${code}` };
  }

  if (code !== undefined) {
    return { status: "transient", reason: `SMTP ${code}` };
  }

  // No reply code at all: DNS failure, connection refused, TLS negotiation,
  // timeout. All worth another attempt — and none of them is a statement about
  // the address, which is what a permanent classification would claim.
  return { status: "transient", reason: transportReason(error) };
}

function responseCode(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const candidate = (error as { responseCode?: unknown }).responseCode;
  return typeof candidate === "number" ? candidate : undefined;
}

/**
 * A short, safe description of a transport failure.
 *
 * nodemailer's `code` (`ECONNREFUSED`, `ETIMEDOUT`, `EDNS`) rather than its
 * `message`, deliberately: the message can quote the server's greeting, which
 * on a misconfigured server has been known to echo the username back. The code
 * is a fixed vocabulary and cannot carry a credential or an address into the
 * `delivery_error` column somebody later reads in the console.
 */
function transportReason(error: unknown): string {
  if (typeof error !== "object" || error === null) return "unknown transport error";
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && code !== "" ? code : "unknown transport error";
}
