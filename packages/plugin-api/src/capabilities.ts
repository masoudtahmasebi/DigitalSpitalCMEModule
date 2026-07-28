/**
 * What a plugin may replace — and, more importantly, what it may not.
 *
 * ## The rule, first
 *
 * **A capability may carry out a decision. It may never make one.**
 *
 * Every contract below receives a decision the platform has already reached and
 * turns it into an effect in the outside world: bytes, an HTTP call, an email.
 * None of them is asked whether a learner passed, how much of a video counts as
 * watched, which chapter is unlocked, or when a Punktemeldung is due. Those
 * answers come from `@ds/domain` and nowhere else (CLAUDE.md §4 invariant 1),
 * because a CME point is a legal claim about a physician's education and the
 * platform has to be able to say why it made every one of them.
 *
 * That is not a stylistic boundary. Concretely, the following are **not**
 * extension points and adding one would be a defect, not a feature:
 *
 * | Not extensible | Because |
 * | --- | --- |
 * | Quiz scoring | Decides whether a physician earns a point |
 * | Watched percentage / segment union | Same, and a max-position variant makes any gate skippable |
 * | Chapter gating and completion | Same |
 * | The progress rollup | One rollup path — two would eventually disagree on a CME record |
 * | EIV deadline arithmetic | A missed 8-day window cannot be reopened |
 * | Token validation and tenant resolution | The whole of ADR-0002 and ADR-0003 |
 * | Certificate *content* | The Anerkennungsbescheid prescribes it; only the rendering varies |
 *
 * ## Why plugins are compile-time, not loaded at runtime
 *
 * There is no `plugins/` directory scanned at boot, no manifest, no dynamic
 * `import()` of a path from configuration. An implementation is a workspace
 * package that some composition root imports and registers by name.
 *
 * The usual argument for runtime loading is that a customer can extend the
 * platform without a deploy. In this platform that argument runs the wrong way:
 * the process being extended holds a database connection whose role deliberately
 * cannot bypass row-level security, decrypts VNR passwords with the application
 * KMS key, and writes an append-only audit log that is the evidence behind
 * reported CME points. Code that can be introduced without review can read all
 * three. A deploy is a small price for every extension having gone through the
 * same review as the rest of the API.
 *
 * So "adding a plugin" means: write a package implementing one of these
 * interfaces, register it, deploy. The seam is real — the EIV reporter is
 * already on the other side of it — but it is a seam in the source, not a hole
 * in the running process.
 */

// ---------------------------------------------------------------------------
// Accreditation reporting
// ---------------------------------------------------------------------------

/**
 * A completed participation, as the platform decided it.
 *
 * Note what is *not* here: no watched percentage, no quiz score, no pass flag.
 * By the time a reporter sees this, the question "did this person complete the
 * Fortbildung" has been answered, audited, and written down. A reporter that
 * received the raw evidence would be a second place capable of reaching a
 * different conclusion.
 */
export interface ParticipationReport {
  /** 15 digits. The physician's Einheitliche Fortbildungsnummer. */
  readonly efn: string;
  /** The course's Veranstaltungsnummer, as issued by the Ärztekammer. */
  readonly vnr: string;
  /** When the learner completed. The deadline clock has already been applied. */
  readonly completedAt: Date;
  /** Where to send it. Per deployment, never compiled into a reporter. */
  readonly endpoint: string;
  /**
   * Credentials for the receiving authority, decrypted by the caller for this
   * one call.
   *
   * A bag of strings rather than named fields because what a credential *is*
   * differs per authority — EIV-FOBI wants a password bound to the VNR, another
   * interface might want a client certificate's passphrase or an API key. The
   * reporter knows which keys it needs; the platform knows only that these are
   * secrets.
   *
   * **Never log this, in whole or in part, and never include it in an error
   * message.** The caller writes every attempt to the audit log, including
   * failures, and a reporter that put a password into the message it threw
   * would put it there too (CLAUDE.md §4 invariants 7 and 8).
   */
  readonly credentials: Readonly<Record<string, string>>;
}

export interface ReportOutcome {
  readonly accepted: boolean;
  /** The receiving system's identifier, when it issued one. */
  readonly reference?: string;
}

/**
 * Transports a decided participation to an accreditation authority.
 *
 * EIV-FOBI is the implementation that exists (`@ds/eiv-client`). A second
 * Ärztekammer with its own interface, or a customer whose Landesärztekammer
 * takes a different format, is the case this exists for.
 *
 * **A reporter must be idempotent per `(efn, vnr, completedAt)`.** The
 * submission worker retries on transport failure and cannot distinguish "the
 * request never arrived" from "the response never came back"; a reporter that
 * double-counted on retry would report a physician twice.
 *
 * A reporter must **not** decide whether to send. Deadlines, the retry budget
 * and permanent-failure classification are `@ds/domain`'s, and every attempt —
 * including every failure — is written to the audit log by the caller
 * (CLAUDE.md §4 invariant 8).
 */
export interface AccreditationReporter {
  /** Stable identifier, recorded in the audit log beside each attempt. */
  readonly id: string;
  report(report: ParticipationReport): Promise<ReportOutcome>;
}

// ---------------------------------------------------------------------------
// Certificate rendering
// ---------------------------------------------------------------------------

/**
 * Turns decided certificate data into a document.
 *
 * The *content* is not extensible — the Anerkennungsbescheid prescribes the
 * fields, the mandatory sentence, and the two VNR barcodes, and a renderer that
 * omitted one would produce an invalid Teilnahmebescheinigung. What varies is
 * the presentation: a customer's letterhead, a different page size, HTML
 * instead of PDF for a preview.
 *
 * `data` is deliberately typed by the caller rather than restated here. The
 * shape is `Certificate` in `contracts/openapi.yaml`, and duplicating it in
 * this package would create a second definition that could drift from the
 * contract the API actually serves.
 */
export interface CertificateRenderer<TData = unknown> {
  readonly id: string;
  /** e.g. `application/pdf`. Used for the Content-Type and the filename. */
  readonly mediaType: string;
  render(data: TData): Promise<Uint8Array>;
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

export interface OutboundMessage {
  readonly to: string;
  /** The sender the project is configured with, not a platform-wide address. */
  readonly from: string;
  readonly subject: string;
  /** Plain text. No EFN, no quiz result — see `docs/gdpr.md`. */
  readonly body: string;
  readonly attachments?: ReadonlyArray<{
    readonly filename: string;
    readonly mediaType: string;
    readonly bytes: Uint8Array;
  }>;
  /**
   * Per-project transport settings, decrypted by the caller for this one send.
   *
   * Here for the same reason `ParticipationReport.credentials` is: a channel is
   * one object for the whole process, but SMTP is configured **per project** so
   * each customer's mail leaves from their own server with their own sender
   * (P8-02). A channel that held connection settings of its own could only
   * serve one tenant.
   *
   * A bag of strings because what a transport needs differs — SMTP wants host,
   * port, username, password and a TLS flag; a portal-inbox channel wants none
   * of them.
   *
   * **Never log this, and never put it in an error message.** The caller
   * records the failure reason against the certificate row, and a channel that
   * interpolated a password into the reason it returned would write it there.
   */
  readonly transport: Readonly<Record<string, string>>;
}

/**
 * Why a delivery failed, if it did.
 *
 * `permanent` and `transient` are separated because the caller's retry policy
 * turns on it: a full mailbox is worth retrying, a non-existent address is not,
 * and retrying the second forever is how a queue stops draining.
 */
export type DeliveryOutcome =
  | { readonly status: "delivered"; readonly reference?: string }
  | { readonly status: "transient"; readonly reason: string }
  | { readonly status: "permanent"; readonly reason: string };

/**
 * Sends a message out of the platform.
 *
 * SMTP is the implementation that exists. A customer who wants certificates in
 * their own portal inbox rather than by email is the case this exists for.
 *
 * A channel must never log the message body or the recipient: a
 * Teilnahmebescheinigung names a physician and the address identifies them
 * (ADR-0004). Returning a `reason` for the caller to record is how a failure
 * gets explained without either appearing in a log line.
 */
export interface DeliveryChannel {
  readonly id: string;
  deliver(message: OutboundMessage): Promise<DeliveryOutcome>;
}

// ---------------------------------------------------------------------------
// Content ingestion
// ---------------------------------------------------------------------------

/**
 * Imports course material from somewhere else into our canonical schema.
 *
 * The seam ADR-0007 names, and the shape any future Storyblok work has to take:
 * an **ingestion** adapter that writes into our tables, never a runtime read
 * path that serves a learner from a third-party CMS. The compliance core keeps
 * a single source of truth for what a course requires, because two sources
 * would eventually disagree, and disagreeing numbers on a CME record are a
 * compliance problem.
 *
 * Declared, deliberately unimplemented: Storyblok integration is on the
 * deferred list (roadmap §4) and this interface is not permission to build it.
 * It exists so that when somebody does, the shape is already decided and the
 * "just read it live from the CMS" version is visibly not what was agreed.
 */
export interface ContentIngestor {
  readonly id: string;
  /**
   * Pull whatever is new and write it into the canonical schema.
   *
   * Returns what it changed, for the audit log. Runs under the same tenant
   * session as everything else — an ingestor has no way to reach another
   * customer's rows, because RLS is enforced by the database and not by this
   * interface (ADR-0002).
   */
  ingest(
    customerId: string,
  ): Promise<{ readonly created: number; readonly updated: number }>;
}
