/**
 * Which mail server sends a customer's certificate, and under whose address
 * (P185-01).
 *
 * ## The rule, and the reason it is not a field-by-field fallback
 *
 * The client asked for the obvious thing:
 *
 *   > if the customer has not set a email delivery smtp, our own admin smtp
 *   > delivery would be used
 *
 * The obvious implementation is `COALESCE(project.x, platform.x)` per column,
 * and it produces a configuration that fails in the one way nobody can see.
 *
 * A `From:` of `noreply@medice.com` sent through **our** mail server fails SPF —
 * MEDICE's DNS does not authorise our host to send as them — and under a DMARC
 * policy of `quarantine` or `reject` the recipient's server files it as spam or
 * refuses it outright. That happens at the far end, so the SMTP transaction we
 * see succeeds: `delivered` on every row, and no physician receives anything.
 * It is the worst failure shape this platform has, the one CLAUDE.md keeps
 * naming — it looks exactly like success.
 *
 * A per-column fallback creates it the moment somebody fills in a From address
 * and leaves the host blank, which is the likeliest half-configuration there
 * is.
 *
 * So the identity moves **whole**: a project sends as itself only when it has a
 * host of its own; otherwise the host, the port, the credentials, the From
 * address and the From name are all the platform's. The two are never mixed,
 * and a customer who wants their own address on the envelope configures their
 * own server — which is also the only way that address can be authorised to
 * carry it.
 *
 * ## Why a rule and not an `??` at the call site
 *
 * Two readers: the delivery worker, which sends, and the console, which has to
 * tell an operator which sender their project will use before anything is sent
 * (§9.4). An `??` chain at the worker would leave the screen guessing, and a
 * screen that guesses about this is worse than one that says nothing.
 */

export interface SenderTransport {
  readonly host: string | null;
  readonly port: number | null;
  readonly username: string | null;
  readonly password: string | null;
  readonly fromAddress: string | null;
  readonly fromName: string | null;
  /**
   * Implicit TLS, where the sender records an answer.
   *
   * `null` means "nobody said", and the channel then infers it from the port
   * (465). `platform_smtp` has stored the flag since P40-01 and the reset mail
   * honours it; `projects` has no such column, so a project passes `null` and
   * keeps the behaviour it has always had.
   *
   * Carried on the transport rather than decided at the call site because it
   * travels with the rest of the identity: choosing the platform's server and
   * then not its TLS setting is the mixing this whole rule exists to refuse.
   */
  readonly secure: boolean | null;
}

export type DeliverySender =
  | {
      /** Whose identity is on the envelope, and whose server carries it. */
      readonly kind: "project" | "platform";
      readonly transport: SenderTransport;
    }
  /** Neither is configured. Nothing can be sent, and the screen must say so. */
  | { readonly kind: "none" };

/**
 * A sender is usable when it has both a host to send through and an address to
 * send as — which is `canSend` in `apps/api/src/shared/mailer.ts`, the answer
 * the Sicherheit screen already shows for the platform's own sender. Restated
 * here rather than imported because `@ds/domain` imports nothing; the two are
 * held together by `delivery-sender.test.ts`'s half-configured cases.
 */
function usable(transport: SenderTransport): boolean {
  // Trimmed, exactly as `canSend` trims. A host of `"  "` is not a host, and
  // the two answering differently would put "Plattform-Versand ist nicht
  // vollständig" on one screen while the worker sent through it.
  return filled(transport.host) && filled(transport.fromAddress);
}

function filled(value: string | null): boolean {
  return value !== null && value.trim() !== "";
}

export function deliverySender(input: {
  readonly project: SenderTransport;
  readonly platform: SenderTransport;
}): DeliverySender {
  if (usable(input.project)) return { kind: "project", transport: input.project };
  if (usable(input.platform)) return { kind: "platform", transport: input.platform };
  return { kind: "none" };
}
