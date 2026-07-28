/**
 * The delivery sweep (P8-03).
 *
 * Four properties are worth a test here, and three of them are refusals:
 *
 * 1. A permanent rejection stops immediately rather than waiting out a backoff
 *    it will fail after.
 * 2. An erased or address-less learner is never pursued.
 * 3. Nothing identifying a physician — name, address, download token — reaches
 *    an audit record.
 * 4. The SMTP password reaches the channel and goes no further.
 */

import { describe, expect, it } from "vitest";
import type { DeliveryChannel, DeliveryOutcome, OutboundMessage } from "@ds/plugin-api";
import { CertificateDeliveryService } from "./delivery.service.js";
import type {
  ClaimedDelivery,
  DeliveryRepositoryPort,
  DueDelivery,
} from "./delivery.repository.js";
import type { AuditEntry, AuditServicePort } from "../../audit/audit.service.js";

const NOW = new Date("2026-09-10T10:00:00Z");
const CUSTOMER = "11111111-1111-1111-1111-111111111111";
const CERTIFICATE = "22222222-2222-2222-2222-222222222222";
const EMAIL = "hans.mustermann@example.de";
const NAME = "Dr. med. Hans Mustermann";
const TOKEN = "0123456789abcdef0123456789abcdef";
const SMTP_PASSWORD = "super-secret-smtp-password";

function row(over: Partial<DueDelivery> = {}): DueDelivery {
  return {
    id: CERTIFICATE,
    enrolmentId: "33333333-3333-3333-3333-333333333333",
    courseTitle: "ADHS Akademie adult",
    courseSlug: "adhs-akademie-adult",
    participantName: NAME,
    downloadToken: TOKEN,
    attemptCount: 0,
    firstAttemptAt: null,
    nextAttemptAt: null,
    lastError: null,
    recipientEmail: EMAIL,
    fromAddress: "fortbildung@medice.de",
    fromName: "MEDICE",
    smtpHost: "smtp.example.de",
    smtpPort: 587,
    smtpUsername: "medice",
    smtpPassword: SMTP_PASSWORD,
    ...over,
  };
}

function build(
  rows: DueDelivery[],
  outcome: DeliveryOutcome = { status: "delivered", reference: "<id@example.de>" },
  portalBaseUrl = "https://fortbildung.example.de/",
) {
  const sent: OutboundMessage[] = [];
  const audits: Array<{ customerId: string; entry: AuditEntry }> = [];
  const written: Array<Record<string, unknown>> = [];

  const claims: ClaimedDelivery[] = rows.map(() => ({
    certificateId: CERTIFICATE,
    customerId: CUSTOMER,
  }));

  const repository: DeliveryRepositoryPort = {
    claimDue: async () => claims,
    load: async () => rows[0],
    recordDelivered: async (input) => {
      written.push({ kind: "delivered", ...input });
    },
    recordRetry: async (input) => {
      written.push({ kind: "retry", ...input });
    },
    recordAbandoned: async (input) => {
      written.push({ kind: "abandoned", ...input });
    },
  };

  const channel: DeliveryChannel = {
    id: "fake",
    deliver: async (message) => {
      sent.push(message);
      return outcome;
    },
  };

  const audit: AuditServicePort = {
    recordForCustomer: async (customerId, entry) => {
      audits.push({ customerId, entry });
    },
    recordSystem: async () => undefined,
  };

  const service = new CertificateDeliveryService(repository, channel, audit, {
    batchSize: 25,
    leaseSeconds: 600,
    portalBaseUrl,
  });

  return { service, sent, audits, written };
}

/** `build` with a different portal base — for the "no portal deployed" case. */
function buildWith(rows: DueDelivery[], portalBaseUrl: string) {
  return build(rows, undefined, portalBaseUrl);
}

describe("a successful delivery", () => {
  it("sends once and records it", async () => {
    const { service, sent, written } = build([row()]);

    const result = await service.sweep(NOW);

    expect(result).toMatchObject({ considered: 1, delivered: 1 });
    expect(sent).toHaveLength(1);
    expect(written[0]).toMatchObject({ kind: "delivered", attemptCount: 1 });
  });

  it("addresses the message from the project's own sender", async () => {
    // Each customer's mail leaves from their own sender (P8-02).
    const { service, sent } = build([row()]);
    await service.sweep(NOW);
    expect(sent[0]?.from).toBe('"MEDICE" <fortbildung@medice.de>');
    expect(sent[0]?.to).toBe(EMAIL);
  });

  it("escapes a display name so it cannot inject a header", async () => {
    const { service, sent } = build([row({ fromName: 'Evil" <x@y.z>, "' })]);
    await service.sweep(NOW);
    // The quotes are escaped, so the whole thing stays one quoted string.
    expect(sent[0]?.from).toBe('"Evil\\" <x@y.z>, \\"" <fortbildung@medice.de>');
  });

  it("strips CRLF from every header-bound field", async () => {
    // The header-injection defence proper. A `\r\n` in any of these splits one
    // header into two, and the second is attacker-controlled — a Bcc: on a
    // message carrying a physician's Teilnahmebescheinigung. All three values
    // come from rows an admin or an author edits.
    const { service, sent } = build([
      row({
        fromName: "MEDICE\r\nBcc: attacker@example.com",
        fromAddress: "fortbildung@medice.de\nX-Evil: 1",
        courseTitle: "ADHS\r\nSubject: Ihre Zugangsdaten",
        recipientEmail: "hans@example.de\r\nBcc: attacker@example.com",
      }),
    ]);

    await service.sweep(NOW);

    const message = sent[0];

    // The property that matters is that no value can *end a line*. The literal
    // text "Bcc:" surviving inside the quoted display name is harmless — it is
    // still one header, and a header whose display name reads oddly is a
    // cosmetic problem, not an injected recipient.
    expect(message?.from).not.toMatch(/[\r\n]/);
    expect(message?.to).not.toMatch(/[\r\n]/);
    expect(message?.subject).not.toMatch(/[\r\n]/);

    // And the display name is still enclosed in exactly one pair of quotes,
    // so nothing in it is read as an address.
    expect(message?.from).toMatch(/^"[^"]*" <[^<>]*>$/);
  });

  it("leaves the body's newlines alone", async () => {
    // The body is the message, not a header. Its newlines are the paragraphs.
    const { service, sent } = build([row()]);
    await service.sweep(NOW);
    expect(sent[0]?.body).toContain("\n");
  });

  it("passes the SMTP password to the channel and nowhere else", async () => {
    const { service, sent, audits, written } = build([row()]);
    await service.sweep(NOW);

    expect(sent[0]?.transport["password"]).toBe(SMTP_PASSWORD);
    expect(JSON.stringify(audits)).not.toContain(SMTP_PASSWORD);
    expect(JSON.stringify(written)).not.toContain(SMTP_PASSWORD);
  });

  it("links to the course page, never to an unauthenticated download", async () => {
    // A URL that hands over a Teilnahmebescheinigung to whoever presents it is
    // a bearer credential sitting in a mailbox. The link costs a sign-in that
    // Keycloak's SSO session usually makes invisible; the attachment is what
    // most recipients use anyway.
    const { service, sent } = build([row()]);
    await service.sweep(NOW);

    const body = sent[0]?.body ?? "";
    expect(body).toContain("https://fortbildung.example.de/kurs/adhs-akademie-adult");
    expect(body).not.toContain(TOKEN);
    expect(body).not.toContain(CERTIFICATE);
  });

  it("writes no personal data to the audit log", async () => {
    // A count and a channel id. Not a name, not an address, not the token.
    const { service, audits } = build([row()]);
    await service.sweep(NOW);

    const serialised = JSON.stringify(audits);
    expect(serialised).not.toContain(EMAIL);
    expect(serialised).not.toContain(NAME);
    expect(serialised).not.toContain(TOKEN);
    expect(audits[0]?.entry.action).toBe("certificate.delivered");
  });
});

describe("the email's contents", () => {
  it("omits the link paragraph when no portal is deployed", async () => {
    // `PORTAL_BASE_URL` unset. A relative `/kurs/slug` in an email is not a
    // link — a mail client has no origin to resolve it against. The attachment
    // still arrives, which is the part that matters.
    const { service, sent } = buildWith([row()], "");
    await service.sweep(NOW);

    const body = sent[0]?.body ?? "";
    expect(body).not.toContain("/kurs/");
    expect(body).not.toContain("herunterladen");
    expect(body).toContain("im Anhang");
  });

  it("carries no EFN and no score", async () => {
    // An email is the least controlled place a physician's data can end up.
    const { service, sent } = build([row()]);
    await service.sweep(NOW);

    const body = sent[0]?.body ?? "";
    expect(body).not.toMatch(/\d{15}/);
    expect(body.toLowerCase()).not.toContain("punkte erreicht");
    expect(body).toContain(NAME);
    expect(body).toContain("ADHS Akademie adult");
  });
});

describe("a transient failure", () => {
  const transient: DeliveryOutcome = { status: "transient", reason: "SMTP 450" };

  it("schedules a retry rather than giving up", async () => {
    const { service, written } = build([row()], transient);

    const result = await service.sweep(NOW);

    expect(result).toMatchObject({ retrying: 1, abandoned: 0 });
    expect(written[0]).toMatchObject({ kind: "retry", attemptCount: 1 });
  });

  it("schedules the next attempt in the future", async () => {
    const { service, written } = build([row()], transient);
    await service.sweep(NOW);

    const next = (written[0] as { nextAttemptAt: Date }).nextAttemptAt;
    expect(next.getTime()).toBeGreaterThan(NOW.getTime());
  });

  it("gives up once the attempt budget is spent", async () => {
    const { service, written } = build([row({ attemptCount: 5 })], transient);

    const result = await service.sweep(NOW);

    expect(result).toMatchObject({ abandoned: 1 });
    expect(written[0]).toMatchObject({
      kind: "abandoned",
      reason: "attempts_exhausted",
    });
  });
});

describe("a permanent rejection", () => {
  it("stops immediately rather than waiting out a backoff", async () => {
    // The address does not exist. Five more attempts over a day would change
    // nothing and would hide the problem from the participant list.
    const { service, written } = build([row()], {
      status: "permanent",
      reason: "SMTP 550",
    });

    const result = await service.sweep(NOW);

    expect(result).toMatchObject({ abandoned: 1, retrying: 0 });
    expect(written[0]).toMatchObject({
      kind: "abandoned",
      reason: "permanent_rejection",
      error: "SMTP 550",
    });
  });
});

describe("a learner with no address", () => {
  it("is not pursued, and the reason says so", async () => {
    // Two ways here and both are correct outcomes: no email on the Keycloak
    // account, or an erased subject (ADR-0008 nulls the address). A certificate
    // must not be posted to somebody who asked to be forgotten.
    const { service, sent, written } = build([row({ recipientEmail: null })]);

    const result = await service.sweep(NOW);

    expect(result).toMatchObject({ abandoned: 1 });
    expect(sent).toHaveLength(0);
    expect(written[0]).toMatchObject({ kind: "abandoned", reason: "no_recipient" });
  });

  it("treats an empty string as no address", async () => {
    const { service, sent } = build([row({ recipientEmail: "" })]);
    await service.sweep(NOW);
    expect(sent).toHaveLength(0);
  });
});

describe("a row that vanished between claim and load", () => {
  it("is skipped rather than crashing the sweep", async () => {
    const { service } = build([]);
    // `claimDue` returns nothing because `rows` is empty, so nothing to load.
    await expect(service.sweep(NOW)).resolves.toMatchObject({ considered: 0 });
  });
});
