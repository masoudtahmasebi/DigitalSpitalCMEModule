/**
 * The certificate delivery worker against real Postgres (P8-03).
 *
 * The service unit tests use a faked repository, so they prove the retry policy
 * is wired correctly. This suite proves the parts only the database can:
 *
 * - `claim_due_certificate_deliveries` actually runs, leases what it hands out,
 *   and — the property the whole SECURITY DEFINER design exists for — returns
 *   rows the `ds_app` role could not have selected for itself.
 * - The status values the repository writes exist in the enum.
 * - The recipient really is read live from `users`, so nulling the address
 *   (which is what erasure does) really does stop delivery.
 *
 * The delivery channel is faked here, deliberately: standing up an SMTP server
 * would test nodemailer, and the classification logic that is genuinely ours is
 * unit-tested in `@ds/mail`.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { createPool } from "@ds/postgres";
import type { DeliveryChannel, DeliveryOutcome, OutboundMessage } from "@ds/plugin-api";
import { AuditService } from "../../src/audit/audit.service.js";
import { PlaintextSecretCipher } from "../../src/shared/secret-cipher.js";
import { DeliveryRepository } from "../../src/modules/certificate/delivery.repository.js";
import { CertificateDeliveryService } from "../../src/modules/certificate/delivery.service.js";
import { CertificateAttachments } from "../../src/modules/certificate/delivery.attachment.js";
import { seedLearner } from "./support/seed-learner.js";
import { requireEnv } from "./support/env.js";
import { publishAccredited } from "./support/accredited-course.js";

const SUPERUSER_URL = requireEnv("POSTGRES_SUPERUSER_URL");
const DATABASE_URL = requireEnv("DATABASE_URL");

const SMTP_PASSWORD = "integration-smtp-password";
const cipher = new PlaintextSecretCipher("test");

/** 1×1 PNG — a real image, which is what the renderer's magic-byte check wants. */
const PLACEHOLDER_IMAGE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

let seedPool: Pool;
let appPool: Pool;

let customerId: string;
let courseId: string;
let bareCourseId: string;
let suffix: string;

beforeAll(async () => {
  seedPool = createPool({ connectionString: SUPERUSER_URL });
  appPool = createPool({ connectionString: DATABASE_URL, max: 5 });

  suffix = randomUUID().slice(0, 8);

  customerId = await insert(
    "INSERT INTO customers (slug, name) VALUES ($1,$2) RETURNING id",
    [`cert-customer-${suffix}`, "Certificate GmbH"],
  );
  const departmentId = await insert(
    "INSERT INTO departments (customer_id, slug, name) VALUES ($1,$2,$3) RETURNING id",
    [customerId, "default", "Default"],
  );
  const projectId = await insert(
    `INSERT INTO projects (customer_id, department_id, slug, name,
                           smtp_host, smtp_port, smtp_username, smtp_password_enc,
                           smtp_from_address, smtp_from_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [
      customerId,
      departmentId,
      `cert-project-${suffix}`,
      "Certificate project",
      "smtp.example.de",
      587,
      "medice",
      cipher.encrypt(SMTP_PASSWORD),
      "fortbildung@example.de",
      "MEDICE",
    ],
  );
  // Furnished with everything the Bescheid requires, because the message this
  // sweep sends is *about* the PDF: a course missing its VNR or its stamp
  // renders nothing, and every assertion below would then be describing the
  // fallback rather than the ordinary case (P59-02).
  courseId = await insert(
    `INSERT INTO courses (customer_id, project_id, slug, title, required_watch_percent,
                          pass_threshold_percent, vnr, cme_points, cme_category,
                          organizer, event_location, accreditation_body,
                          scientific_lead_name, scientific_lead_title,
                          certificate_issue_place,
                          stamp_image, stamp_image_mime,
                          signature_image, signature_image_mime, status)
     VALUES ($1,$2,$3,$4,100,70,$5,4,'D',$6,'online',$7,$8,'Prof. Dr. med.','Iserlohn',
             $9,'image/png',$9,'image/png','draft') RETURNING id`,
    [
      customerId,
      projectId,
      `cert-course-${suffix}`,
      "ADHS Akademie adult",
      "2760552025919300018",
      "Medice Arzneimittel Pütter GmbH & Co. KG, Iserlohn",
      "Ärztekammer Westfalen-Lippe",
      "Muster-Leitung",
      PLACEHOLDER_IMAGE,
    ],
  );
  // Draft-then-publish: `courses_published_cme_is_complete` refuses a published
  // point-awarding course with no VNR password, which is the one field this
  // fixture never set (P62-02). COALESCE leaves everything above untouched.
  await publishAccredited(seedPool, courseId);

  // The same course without its certificate assets — an authoring gap, and the
  // one case where the e-mail must go out carrying nothing.
  bareCourseId = await insert(
    `INSERT INTO courses (customer_id, project_id, slug, title, required_watch_percent,
                          pass_threshold_percent, status)
     VALUES ($1,$2,$3,$4,100,70,'published') RETURNING id`,
    [customerId, projectId, `cert-course-bare-${suffix}`, "Kurs ohne Stempel"],
  );

  // The sweep is global by design — it drains every tenant's queue. Other
  // suites leave rows behind, so park anything not belonging to this customer
  // before starting, or the tallies below count somebody else's work.
  await seedPool.query(
    `UPDATE certificates SET delivery_abandoned_reason = 'parked_by_test'
      WHERE status = 'issued' AND delivered_at IS NULL
        AND delivery_abandoned_reason IS NULL AND customer_id <> $1`,
    [customerId],
  );
}, 30_000);

afterAll(async () => {
  await seedPool.end();
  await appPool.end();
});

async function insert(sql: string, values: unknown[]): Promise<string> {
  const { rows } = await seedPool.query<{ id: string }>(sql, values);
  const id = rows[0]?.id;
  if (id === undefined) throw new Error(`seed insert returned no id: ${sql}`);
  return id;
}

/** An issued certificate waiting to be delivered. */
async function queueCertificate(
  over: { email?: string | null; attemptCount?: number; bare?: boolean } = {},
): Promise<{ certificateId: string; enrolmentId: string; userId: string }> {
  const unique = randomUUID().slice(0, 8);

  const { id: userId } = await seedLearner(seedPool, {
    realm: `http://127.0.0.1/realms/cert-${suffix}`,
    subject: `cert-sub-${unique}`,
    email: over.email === undefined ? `learner-${unique}@example.de` : over.email,
    firstName: "Hans",
    lastName: "Mustermann",
  });

  // `vnr`, `cme_points` and `cme_category` are snapshotted onto the enrolment
  // (P3-01) and the certificate is rendered from the snapshot, not the course —
  // so a fixture that leaves them null renders nothing, whatever the course row
  // says.
  const enrolmentId = await insert(
    `INSERT INTO enrolments (customer_id, course_id, user_id, required_watch_percent,
                             pass_threshold_percent, completed_at, vnr, cme_points,
                             cme_category)
     VALUES ($1,$2,$3,100,70,now(),$4,$5,$6) RETURNING id`,
    over.bare === true
      ? [customerId, bareCourseId, userId, null, null, null]
      : [customerId, courseId, userId, "2760552025919300018", 4, "D"],
  );

  const certificateId = await insert(
    `INSERT INTO certificates (customer_id, enrolment_id, status, participant_name,
                               issued_at, delivery_attempt_count)
     VALUES ($1,$2,'issued',$3,now(),$4) RETURNING id`,
    [customerId, enrolmentId, "Dr. med. Hans Mustermann", over.attemptCount ?? 0],
  );

  return { certificateId, enrolmentId, userId };
}

function build(outcome: DeliveryOutcome = { status: "delivered", reference: "<a@b>" }) {
  const sent: OutboundMessage[] = [];

  const channel: DeliveryChannel = {
    id: "fake",
    deliver: async (message) => {
      sent.push(message);
      return outcome;
    },
  };

  const service = new CertificateDeliveryService(
    new DeliveryRepository(appPool, cipher),
    channel,
    new AuditService(appPool),
    {
      batchSize: 25,
      leaseSeconds: 600,
      portalBaseUrl: "https://fortbildung.example.de",
    },
    // The real adapter, not a stub. It is the caller the unit tests cannot
    // name: it opens the claimed row's tenant scope with `runInTenant` and
    // renders through `CertificateService`, and both of those are things only
    // a real database can be wrong about (CLAUDE.md §9.7, §9.6).
    new CertificateAttachments(appPool, { warn: () => undefined }),
  );

  return { service, sent };
}

async function certificateRow(id: string): Promise<{
  status: string;
  delivered_at: Date | null;
  delivery_attempt_count: number;
  delivery_next_attempt_at: Date | null;
  delivery_abandoned_reason: string | null;
  delivery_error: string | null;
  download_token: string;
}> {
  const { rows } = await seedPool.query("SELECT * FROM certificates WHERE id = $1", [id]);
  return rows[0] as never;
}

describe("the claim function", () => {
  it("hands out work the app role could not have found on its own", async () => {
    // The point of the SECURITY DEFINER design: with no `app.customer_id` set,
    // RLS shows `ds_app` zero rows — correctly. The function is the one narrow
    // way past that, and it returns routing metadata only.
    const { certificateId } = await queueCertificate();

    const direct = await appPool.query("SELECT id FROM certificates WHERE id = $1", [
      certificateId,
    ]);
    expect(direct.rowCount).toBe(0);

    const claimed = await appPool.query(
      "SELECT * FROM claim_due_certificate_deliveries($1, $2, $3)",
      [10, new Date(), 600],
    );
    expect(
      claimed.rows.map((r: { certificate_id: string }) => r.certificate_id),
    ).toContain(certificateId);

    // Routing metadata only — no name, no token, no address.
    expect(Object.keys(claimed.rows[0] as object).sort()).toEqual([
      "certificate_id",
      "customer_id",
    ]);
  });

  it("leases what it hands out, so a second sweep does not take it", async () => {
    // Without the lease a slow send could be picked up twice and the physician
    // would receive two copies.
    const { certificateId } = await queueCertificate();
    const now = new Date();

    const first = await appPool.query(
      "SELECT * FROM claim_due_certificate_deliveries($1, $2, $3)",
      [50, now, 600],
    );
    expect(first.rows.map((r: { certificate_id: string }) => r.certificate_id)).toContain(
      certificateId,
    );

    const second = await appPool.query(
      "SELECT * FROM claim_due_certificate_deliveries($1, $2, $3)",
      [50, now, 600],
    );
    expect(
      second.rows.map((r: { certificate_id: string }) => r.certificate_id),
    ).not.toContain(certificateId);
  });
});

describe("a successful delivery", () => {
  it("sends and marks the row delivered", async () => {
    const { certificateId } = await queueCertificate();
    const { service, sent } = build();

    const result = await service.sweep(new Date());
    expect(result.delivered).toBeGreaterThanOrEqual(1);

    const row = await certificateRow(certificateId);
    expect(row.status).toBe("delivered");
    expect(row.delivered_at).not.toBeNull();
    expect(row.delivery_attempt_count).toBe(1);
    // The lease is cleared: nothing further is due.
    expect(row.delivery_next_attempt_at).toBeNull();
    expect(sent.length).toBeGreaterThanOrEqual(1);
  });

  it("decrypts the project's SMTP password and hands it to the channel", async () => {
    await queueCertificate();
    const { service, sent } = build();
    await service.sweep(new Date());

    expect(sent[0]?.transport["password"]).toBe(SMTP_PASSWORD);
    expect(sent[0]?.from).toBe('"MEDICE" <fortbildung@example.de>');
  });

  it("links to the course page and never leaks the download token", async () => {
    const { certificateId } = await queueCertificate();
    const { service, sent } = build();
    await service.sweep(new Date());

    const row = await certificateRow(certificateId);
    expect(sent[0]?.body).toContain(
      `https://fortbildung.example.de/kurs/cert-course-${suffix}`,
    );
    // The token is the certificate's non-enumerable id, not a URL credential.
    expect(sent[0]?.body).not.toContain(row.download_token);
  });

  it("carries the certificate the copy promises, rendered inside the tenant", async () => {
    /*
     * P59-02, and the assertion that could only be made here.
     *
     * The unit test proves `compose` attaches whatever the port returns. What
     * it cannot prove is that the port returns anything against a real
     * database: `CertificateAttachments` reads `certificates` and `enrolments`,
     * both under FORCE ROW LEVEL SECURITY, and a read on the bare pool matches
     * zero rows and looks exactly like "this course has no certificate"
     * (CLAUDE.md §9.6). Missing `runInTenant` here is a silent no-attachment,
     * not an error.
     */
    await queueCertificate();
    const { service, sent } = build();
    await service.sweep(new Date());

    const attachment = sent[0]?.attachments?.[0];
    expect(attachment?.mediaType).toBe("application/pdf");
    expect(attachment?.filename).toContain("Teilnahmebescheinigung");
    expect(Buffer.from(attachment!.bytes).subarray(0, 5).toString()).toBe("%PDF-");
    expect(sent[0]?.body).toContain("im Anhang");
  });

  it("still sends when the course has no stamp, without promising an enclosure", async () => {
    // An authoring gap must not hold back the covering message: the learner can
    // download the document from their account either way, and an e-mail saying
    // "finden Sie im Anhang" over an empty envelope is worse than one that does
    // not mention it.
    const { certificateId } = await queueCertificate({ bare: true });
    const { service, sent } = build();
    await service.sweep(new Date());

    const message = sent.find((m) => m.body.includes("Kurs ohne Stempel"));
    expect(message).toBeDefined();
    expect(message?.attachments).toBeUndefined();
    expect(message?.body).not.toContain("im Anhang");
    expect((await certificateRow(certificateId)).status).toBe("delivered");
  });
});

describe("a learner whose address has been removed", () => {
  it("is abandoned rather than pursued", async () => {
    // This is the erasure path (ADR-0008 nulls `users.email`). The address is
    // read live rather than copied onto the certificate row precisely so that
    // erasure stops delivery without the erasure code knowing this queue exists.
    const { certificateId } = await queueCertificate({ email: null });
    const { service, sent } = build();

    await service.sweep(new Date());

    const row = await certificateRow(certificateId);
    expect(row.delivery_abandoned_reason).toBe("no_recipient");
    expect(row.status).toBe("bounced");
    expect(sent).toHaveLength(0);
  });

  it("stops delivery for a certificate already queued when erasure happens", async () => {
    const { certificateId, userId } = await queueCertificate();

    // Erase between queueing and the sweep.
    await seedPool.query("UPDATE users SET email = NULL WHERE id = $1", [userId]);

    const { service, sent } = build();
    await service.sweep(new Date());

    expect(sent).toHaveLength(0);
    expect((await certificateRow(certificateId)).delivery_abandoned_reason).toBe(
      "no_recipient",
    );
  });
});

describe("the delivery address on the enrolment (P183-01)", () => {
  it("sends to it in preference to the account address", async () => {
    const { certificateId, enrolmentId } = await queueCertificate({
      email: "konto@example.de",
    });
    await seedPool.query("UPDATE enrolments SET delivery_email = $1 WHERE id = $2", [
      "woanders@example.de",
      enrolmentId,
    ]);

    const { service, sent } = build();
    await service.sweep(new Date());

    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe("woanders@example.de");
    expect((await certificateRow(certificateId)).status).toBe("delivered");
  });

  // The case the client reported: `users.email` is null because MEDICE's realm
  // sends no `email` claim, so before P183 the certificate was abandoned and
  // nothing on the platform could supply an address.
  it("makes a certificate deliverable that had no account address at all", async () => {
    const { certificateId, enrolmentId } = await queueCertificate({ email: null });
    await seedPool.query("UPDATE enrolments SET delivery_email = $1 WHERE id = $2", [
      "praxis@example.de",
      enrolmentId,
    ]);

    const { service, sent } = build();
    await service.sweep(new Date());

    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe("praxis@example.de");
    const row = await certificateRow(certificateId);
    expect(row.status).toBe("delivered");
    expect(row.delivery_abandoned_reason).toBeNull();
  });

  // Clearing it is how somebody goes back to their account address, so null
  // must mean "the account's" and not "none".
  it("falls back to the account address when cleared", async () => {
    const { enrolmentId } = await queueCertificate({ email: "konto@example.de" });
    await seedPool.query("UPDATE enrolments SET delivery_email = NULL WHERE id = $1", [
      enrolmentId,
    ]);

    const { service, sent } = build();
    await service.sweep(new Date());

    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe("konto@example.de");
  });

  // Erasure nulls both columns (migration 0052). If it ever stopped nulling the
  // delivery address, a subject's address would survive their erasure *and*
  // their certificate would still be sent — which is why this asserts the send
  // and not only the column.
  it("is erased with the account address, and delivery stops", async () => {
    const { certificateId, enrolmentId, userId } = await queueCertificate({
      email: "konto@example.de",
    });
    await seedPool.query("UPDATE enrolments SET delivery_email = $1 WHERE id = $2", [
      "woanders@example.de",
      enrolmentId,
    ]);

    await seedPool.query("SELECT erase_subject($1, $2)", [userId, "P183 test"]);

    const { rows } = await seedPool.query<{ delivery_email: string | null }>(
      "SELECT delivery_email FROM enrolments WHERE id = $1",
      [enrolmentId],
    );
    expect(rows[0]?.delivery_email).toBeNull();

    const { service, sent } = build();
    await service.sweep(new Date());
    expect(sent).toHaveLength(0);
    expect((await certificateRow(certificateId)).delivery_abandoned_reason).toBe(
      "no_recipient",
    );
  });
});

describe("a permanent rejection", () => {
  it("writes the reason and stops claiming the row", async () => {
    const { certificateId } = await queueCertificate();
    const { service } = build({ status: "permanent", reason: "SMTP 550" });

    await service.sweep(new Date());

    const row = await certificateRow(certificateId);
    expect(row.delivery_abandoned_reason).toBe("permanent_rejection");
    expect(row.delivery_error).toBe("SMTP 550");

    // And the claim query no longer offers it.
    const claimed = await appPool.query(
      "SELECT * FROM claim_due_certificate_deliveries($1, $2, $3)",
      [50, new Date(), 600],
    );
    expect(
      claimed.rows.map((r: { certificate_id: string }) => r.certificate_id),
    ).not.toContain(certificateId);
  });
});

describe("a transient failure", () => {
  it("schedules a retry the claim query will honour", async () => {
    const { certificateId } = await queueCertificate();
    const { service } = build({ status: "transient", reason: "SMTP 450" });

    const now = new Date();
    await service.sweep(now);

    const row = await certificateRow(certificateId);
    expect(row.status).toBe("issued");
    expect(row.delivery_attempt_count).toBe(1);
    expect(row.delivery_abandoned_reason).toBeNull();
    expect(row.delivery_next_attempt_at?.getTime()).toBeGreaterThan(now.getTime());

    // Not due yet, so a sweep right now leaves it alone.
    const claimed = await appPool.query(
      "SELECT * FROM claim_due_certificate_deliveries($1, $2, $3)",
      [50, now, 600],
    );
    expect(
      claimed.rows.map((r: { certificate_id: string }) => r.certificate_id),
    ).not.toContain(certificateId);
  });
});

describe("delivery and the download are independent", () => {
  it("leaves the download token intact whatever the outcome", async () => {
    // P8-03's central rule: a physician who has earned a Teilnahmebescheinigung
    // must not lose it to a full mailbox.
    const { certificateId } = await queueCertificate();
    const before = await certificateRow(certificateId);

    const { service } = build({ status: "permanent", reason: "SMTP 550" });
    await service.sweep(new Date());

    const after = await certificateRow(certificateId);
    expect(after.download_token).toBe(before.download_token);
    expect(after.download_token).not.toBe("");
  });
});
