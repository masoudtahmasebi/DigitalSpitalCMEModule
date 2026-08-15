/**
 * The certificate archive and its erasure, against real Postgres and a real
 * SigV4-verifying bucket (P60-01).
 *
 * The unit tests prove the adapter builds the right key and hashes the right
 * bytes. Only this can prove the three things that make the archive worth
 * having:
 *
 * 1. The signature the presigner mints actually verifies — the fake rejects a
 *    bad one exactly as Hetzner would, so "it stored" is not "it 200ed".
 * 2. `certificates` really holds the key, the digest and the timestamp, past
 *    the constraints that refuse a half-written record.
 * 3. **An erasure reaches the bucket.** This is the one that cannot be checked
 *    anywhere else: `erase_subject` queues the deletion, the sweep performs it,
 *    and until both run the PDF naming a physician is still in storage while
 *    every table says the erasure succeeded.
 */

import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { createPool } from "@ds/postgres";
import { CertificateArchive } from "../../src/modules/certificate/certificate.archive.js";
import { ObjectErasureService } from "../../src/modules/certificate/object-erasure.service.js";
import { S3Presigner } from "../../src/shared/s3-presigner.js";
import { seedLearner } from "./support/seed-learner.js";
import { startFakeS3, type FakeS3 } from "../support/fake-s3.js";
import { requireEnv } from "./support/env.js";

const SUPERUSER_URL = requireEnv("POSTGRES_SUPERUSER_URL");

const PDF = Buffer.from("%PDF-1.7\nfake certificate bytes\n%%EOF\n");
const silent = { log: () => undefined, warn: () => undefined };

let seedPool: Pool;
let s3: FakeS3;
let presigner: S3Presigner;

let customerId: string;
let courseId: string;

beforeAll(async () => {
  seedPool = createPool({ connectionString: SUPERUSER_URL });
  s3 = await startFakeS3();
  presigner = new S3Presigner({
    endpoint: s3.endpoint,
    region: s3.region,
    bucket: s3.bucket,
    accessKeyId: s3.accessKeyId,
    secretAccessKey: s3.secretAccessKey,
    forcePathStyle: true,
  });

  const suffix = randomUUID().slice(0, 8);
  customerId = await insert(
    "INSERT INTO customers (slug, name) VALUES ($1,$2) RETURNING id",
    [`arch-customer-${suffix}`, "Archive GmbH"],
  );
  const departmentId = await insert(
    "INSERT INTO departments (customer_id, slug, name) VALUES ($1,$2,$3) RETURNING id",
    [customerId, "default", "Default"],
  );
  const projectId = await insert(
    `INSERT INTO projects (customer_id, department_id, slug, name)
     VALUES ($1,$2,$3,$4) RETURNING id`,
    [customerId, departmentId, `arch-project-${suffix}`, "Archive project"],
  );
  courseId = await insert(
    `INSERT INTO courses (customer_id, project_id, slug, title, required_watch_percent,
                          pass_threshold_percent, status)
     VALUES ($1,$2,$3,$4,100,70,'published') RETURNING id`,
    [customerId, projectId, `arch-course-${suffix}`, "ADHS Akademie adult"],
  );
}, 30_000);

afterAll(async () => {
  await s3.close();
  await seedPool.end();
});

async function insert(sql: string, values: unknown[]): Promise<string> {
  const { rows } = await seedPool.query<{ id: string }>(sql, values);
  const id = rows[0]?.id;
  if (id === undefined) throw new Error(`seed insert returned no id: ${sql}`);
  return id;
}

/** A completed enrolment with an issued certificate, and the learner behind it. */
async function issuedCertificate(): Promise<{
  certificateId: string;
  userId: string;
}> {
  const unique = randomUUID().slice(0, 8);
  const { id: userId } = await seedLearner(seedPool, {
    realm: `http://127.0.0.1/realms/arch`,
    subject: `arch-sub-${unique}`,
    email: `arch-${unique}@example.de`,
    firstName: "Hans",
    lastName: "Mustermann",
  });

  const enrolmentId = await insert(
    `INSERT INTO enrolments (customer_id, course_id, user_id, required_watch_percent,
                             pass_threshold_percent, completed_at, attested_address)
     VALUES ($1,$2,$3,100,70,now(),$4) RETURNING id`,
    [customerId, courseId, userId, "Musterstraße 1, 58638 Iserlohn"],
  );

  const certificateId = await insert(
    `INSERT INTO certificates (customer_id, enrolment_id, status, participant_name, issued_at)
     VALUES ($1,$2,'issued',$3,now()) RETURNING id`,
    [customerId, enrolmentId, "Dr. med. Hans Mustermann"],
  );

  return { certificateId, userId };
}

async function archiveRow(certificateId: string): Promise<{
  pdf_object_key: string | null;
  pdf_sha256: string | null;
  pdf_archived_at: Date | null;
}> {
  const { rows } = await seedPool.query(
    "SELECT pdf_object_key, pdf_sha256, pdf_archived_at FROM certificates WHERE id = $1",
    [certificateId],
  );
  return rows[0] as never;
}

describe("storing the issued bytes", () => {
  it("signs a PUT the bucket accepts, and the object is the document", async () => {
    const { certificateId } = await issuedCertificate();
    const archive = new CertificateArchive(presigner, silent);

    const stored = await archive.store({
      customerId,
      courseId,
      certificateId,
      bytes: PDF,
    });

    expect(stored).toBeDefined();
    // The fake verifies SigV4 the way Hetzner does, so this is the assertion
    // that the signature is right rather than that a server answered 200.
    expect(s3.requests.at(-1)).toMatchObject({ method: "PUT", status: 200 });

    const object = s3.objects.get(stored!.objectKey);
    expect(object?.body.equals(PDF)).toBe(true);
    expect(object?.contentType).toBe("application/pdf");
  });

  it("records a key, a digest and a time — all three or none", async () => {
    const { certificateId } = await issuedCertificate();
    const archive = new CertificateArchive(presigner, silent);
    const stored = await archive.store({
      customerId,
      courseId,
      certificateId,
      bytes: PDF,
    });

    await seedPool.query(
      `UPDATE certificates SET pdf_object_key=$2, pdf_sha256=$3, pdf_archived_at=now()
        WHERE id=$1`,
      [certificateId, stored!.objectKey, stored!.sha256],
    );

    const row = await archiveRow(certificateId);
    expect(row.pdf_object_key).toBe(
      `${customerId}/certificates/${courseId}/${certificateId}.pdf`,
    );
    expect(row.pdf_sha256).toBe(createHash("sha256").update(PDF).digest("hex"));
    expect(row.pdf_archived_at).not.toBeNull();
  });

  it("refuses a half-written archive record", async () => {
    // `certificates_archive_all_or_nothing`. A key with no digest is an object
    // nothing can vouch for, which is worse than no archive at all.
    const { certificateId } = await issuedCertificate();

    await expect(
      seedPool.query("UPDATE certificates SET pdf_object_key = $2 WHERE id = $1", [
        certificateId,
        `${customerId}/certificates/${courseId}/${certificateId}.pdf`,
      ]),
    ).rejects.toThrow(/archive_all_or_nothing/);
  });

  it("refuses a key belonging to another customer", async () => {
    // The bucket has no RLS, so this constraint is the isolation — a
    // mis-written row cannot name another tenant's object.
    const { certificateId } = await issuedCertificate();
    const other = randomUUID();

    await expect(
      seedPool.query(
        `UPDATE certificates SET pdf_object_key=$2, pdf_sha256=repeat('a',64),
           pdf_archived_at=now() WHERE id=$1`,
        [certificateId, `${other}/certificates/${courseId}/${certificateId}.pdf`],
      ),
    ).rejects.toThrow(/archive_key_is_tenant_scoped/);
  });
});

describe("an erasure reaches the bucket", () => {
  it("deletes the archived PDF and clears the row's pointer to it", async () => {
    /*
     * The property this whole file exists for.
     *
     * Every column naming the physician is redactable in place. The PDF is
     * not: it carries the name, the Anschrift and the EFN on its face. Without
     * the queue and this sweep, the erasure returns 200, `audit_log` records
     * it, every table looks right — and the document is still in storage.
     */
    const { certificateId, userId } = await issuedCertificate();
    const archive = new CertificateArchive(presigner, silent);
    const stored = await archive.store({
      customerId,
      courseId,
      certificateId,
      bytes: PDF,
    });
    await seedPool.query(
      `UPDATE certificates SET pdf_object_key=$2, pdf_sha256=$3, pdf_archived_at=now()
        WHERE id=$1`,
      [certificateId, stored!.objectKey, stored!.sha256],
    );
    expect(s3.objects.has(stored!.objectKey)).toBe(true);

    await seedPool.query("SELECT erase_subject($1, $2)", [userId, "qa"]);

    // Queued, and the row no longer points at a document naming a person.
    const afterErase = await archiveRow(certificateId);
    expect(afterErase.pdf_object_key).toBeNull();
    expect(afterErase.pdf_sha256).toBeNull();

    const sweep = new ObjectErasureService(seedPool, presigner, silent);
    const result = await sweep.drain();

    expect(result.deleted).toBeGreaterThanOrEqual(1);
    expect(s3.objects.has(stored!.objectKey)).toBe(false);

    const { rows } = await seedPool.query<{ deleted_at: Date | null }>(
      "SELECT deleted_at FROM object_erasures WHERE object_key = $1",
      [stored!.objectKey],
    );
    expect(rows[0]?.deleted_at).not.toBeNull();
  });

  it("keeps the obligation open when the bucket refuses", async () => {
    // An obligation must not be dischargeable by being forgotten. The row
    // stays claimable, and the boot drain retries it.
    const { certificateId, userId } = await issuedCertificate();
    const archive = new CertificateArchive(presigner, silent);
    const stored = await archive.store({
      customerId,
      courseId,
      certificateId,
      bytes: PDF,
    });
    await seedPool.query(
      `UPDATE certificates SET pdf_object_key=$2, pdf_sha256=$3, pdf_archived_at=now()
        WHERE id=$1`,
      [certificateId, stored!.objectKey, stored!.sha256],
    );
    await seedPool.query("SELECT erase_subject($1, $2)", [userId, "qa"]);

    const refusing = new ObjectErasureService(
      seedPool,
      presigner,
      silent,
      (async () => new Response("nope", { status: 503 })) as unknown as typeof fetch,
    );
    const result = await refusing.drain();
    expect(result.failed).toBeGreaterThanOrEqual(1);

    const { rows } = await seedPool.query<{ deleted_at: Date | null; attempts: number }>(
      "SELECT deleted_at, attempts FROM object_erasures WHERE object_key = $1",
      [stored!.objectKey],
    );
    expect(rows[0]?.deleted_at).toBeNull();
    expect(rows[0]?.attempts).toBeGreaterThanOrEqual(1);

    // And a later sweep against the real bucket finishes the job.
    const working = new ObjectErasureService(seedPool, presigner, silent);
    await working.drain();
    expect(s3.objects.has(stored!.objectKey)).toBe(false);
  });

  it("treats an object that is already gone as gone", async () => {
    // A 404 means the state being asked for. Recording it as a failure would
    // keep the row claimable forever.
    const { certificateId, userId } = await issuedCertificate();
    const key = `${customerId}/certificates/${courseId}/${certificateId}.pdf`;
    await seedPool.query(
      `UPDATE certificates SET pdf_object_key=$2, pdf_sha256=repeat('b',64),
         pdf_archived_at=now() WHERE id=$1`,
      [certificateId, key],
    );
    await seedPool.query("SELECT erase_subject($1, $2)", [userId, "qa"]);

    const sweep = new ObjectErasureService(seedPool, presigner, silent);
    await sweep.drain();

    const { rows } = await seedPool.query<{ deleted_at: Date | null }>(
      "SELECT deleted_at FROM object_erasures WHERE object_key = $1",
      [key],
    );
    expect(rows[0]?.deleted_at).not.toBeNull();
  });
});
