/**
 * Learner-record and certificate moderation (P12-05), against real Postgres.
 *
 * Four properties, each one an acceptance criterion and each one a thing that
 * cannot be checked without the database:
 *
 * - **A name may be corrected until the Punktemeldung is accepted, and not
 *   after.** The stage comes from a join against `eiv_submissions`, so the rule
 *   is only as good as that query.
 * - **Erasure goes through `erase_subject`** — the SECURITY DEFINER function
 *   owned by `ds_erasure` — and is audited. Reimplementing any part of it in
 *   the service would pass a unit test and lose the cross-tenant reach a
 *   subject request needs.
 * - **Regenerating a certificate does not re-report to EIV.** Asserted by
 *   reading `eiv_submissions` before and after.
 * - **No EFN is ever returned in full**, which is a property of the response
 *   body and nothing else.
 */

import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWK } from "jose";
import { AppModule } from "../../src/app.module.js";
import { configureApp } from "../../src/configure-app.js";
import { loadConfig } from "../../src/config/config.js";
import { seedLearner } from "./support/seed-learner.js";
import { requireEnv } from "./support/env.js";

const SUPERUSER_URL = requireEnv("POSTGRES_SUPERUSER_URL");

process.env["KEYCLOAK_ISSUER"] ??= "http://127.0.0.1:1/realms/unused";
process.env["KEYCLOAK_AUDIENCE"] ??= "unused";
process.env["KEYCLOAK_JWKS_URI"] ??=
  "http://127.0.0.1:1/realms/unused/protocol/openid-connect/certs";
process.env["NODE_ENV"] ??= "test";
process.env["EIV_WORKER_ENABLED"] = "no";
process.env["CERTIFICATE_DELIVERY_ENABLED"] = "no";

const KID = "moderation-key";
const AUDIENCE = "ds-education-api";
const RUN = randomUUID().slice(0, 8);
const ADMIN_SUB = `moderation-admin-${RUN}`;

/** A real 15-digit EFN shape. Not a real EFN — never commit one (ADR-0004). */
const EFN = "801234567890123";

let jwksServer: Server;
let privateKey: CryptoKey;
let issuer: string;
let app: NestExpressApplication;
let baseUrl: string;
let seedPool: Pool;

let projectSlug: string;
let courseSlug: string;
let customerId: string;
/** Untouched by any submission — the one whose name may still be corrected. */
let openEnrolmentId: string;
/** Already reported to the Ärztekammer. */
let submittedEnrolmentId: string;
let certificateId: string;

beforeAll(async () => {
  seedPool = new Pool({ connectionString: SUPERUSER_URL });

  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  const jwk = {
    ...(await exportJWK(pair.publicKey)),
    kid: KID,
    alg: "RS256",
    use: "sig",
  };

  const port = await startJwks(jwk);
  issuer = `http://127.0.0.1:${port}/realms/moderation-${RUN}`;
  process.env["KEYCLOAK_ISSUER"] = issuer;
  process.env["KEYCLOAK_AUDIENCE"] = AUDIENCE;
  process.env["KEYCLOAK_JWKS_URI"] = `${issuer}/protocol/openid-connect/certs`;

  customerId = await insert(
    "INSERT INTO customers (slug, name) VALUES ($1,$2) RETURNING id",
    [`moderation-${RUN}`, "Moderation GmbH"],
  );
  const departmentId = await insert(
    "INSERT INTO departments (customer_id, slug, name) VALUES ($1,$2,$3) RETURNING id",
    [customerId, `abt-${RUN}`, "Abteilung"],
  );
  projectSlug = `projekt-${RUN}`;
  await insert(
    `INSERT INTO projects (customer_id, department_id, slug, name, keycloak_issuer, keycloak_audience)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [customerId, departmentId, projectSlug, "Projekt", issuer, AUDIENCE],
  );
  const projectId = await scalar("SELECT id FROM projects WHERE slug = $1", [
    projectSlug,
  ]);
  courseSlug = `kurs-${RUN}`;
  const courseId = await insert(
    `INSERT INTO courses (customer_id, project_id, slug, title, required_watch_percent,
                          pass_threshold_percent, status)
     VALUES ($1,$2,$3,$4,90,70,'published') RETURNING id`,
    [customerId, projectId, courseSlug, "ADHS Akademie adult"],
  );

  const { id: adminId } = await seedLearner(seedPool, {
    realm: issuer,
    subject: ADMIN_SUB,
  });
  await seedPool.query(
    "INSERT INTO user_roles (user_id, role, customer_id) VALUES ($1,'customer_admin',$2)",
    [adminId, customerId],
  );

  openEnrolmentId = await seedEnrolledLearner(courseId, "offen", null);
  submittedEnrolmentId = await seedEnrolledLearner(courseId, "gemeldet", "submitted");

  certificateId = await insert(
    `INSERT INTO certificates (customer_id, enrolment_id, participant_name, status, issued_at)
     VALUES ($1,$2,$3,'issued', now()) RETURNING id`,
    [customerId, openEnrolmentId, "Dr. Alt"],
  );

  app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: false,
    bodyParser: false,
  });
  await configureApp(app, loadConfig());
  await app.listen(0);

  const address = app.getHttpServer().address();
  if (address === null || typeof address === "string") {
    throw new Error("expected a bound TCP port");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
}, 40_000);

afterAll(async () => {
  await app?.close();
  await new Promise<void>((resolve) => jwksServer.close(() => resolve()));
  await seedPool.end();
});

/** A learner, an enrolment, an EFN, and optionally a Punktemeldung. */
async function seedEnrolledLearner(
  courseId: string,
  label: string,
  submissionStatus: string | null,
): Promise<string> {
  const { id: userId } = await seedLearner(seedPool, {
    realm: issuer,
    subject: `learner-${label}-${RUN}`,
  });
  await seedPool.query(
    "INSERT INTO user_roles (user_id, role, customer_id) VALUES ($1,'learner',$2)",
    [userId, customerId],
  );
  await seedPool.query("INSERT INTO efn_profiles (user_id, efn) VALUES ($1,$2)", [
    userId,
    EFN,
  ]);

  const enrolmentId = await insert(
    `INSERT INTO enrolments (customer_id, course_id, user_id, required_watch_percent,
                             pass_threshold_percent, attested_name, completed_at)
     VALUES ($1,$2,$3,90,70,$4, now()) RETURNING id`,
    [customerId, courseId, userId, `Dr. ${label}`],
  );

  if (submissionStatus !== null) {
    await seedPool.query(
      `INSERT INTO eiv_submissions (customer_id, enrolment_id, vnr, efn, status,
                                    event_end_at, report_due_at, first_submitted_at)
       VALUES ($1,$2,'9999999999999999999',$3,$4::eiv_status, now(), now() + interval '8 days', now())`,
      [customerId, enrolmentId, EFN, submissionStatus],
    );
  }
  return enrolmentId;
}

async function insert(sql: string, values: unknown[]): Promise<string> {
  const { rows } = await seedPool.query<{ id: string }>(sql, values);
  const id = rows[0]?.id;
  if (id === undefined) throw new Error(`seed insert returned no id: ${sql}`);
  return id;
}

async function scalar(sql: string, values: unknown[]): Promise<string> {
  const { rows } = await seedPool.query<{ id: string }>(sql, values);
  const id = rows[0]?.id;
  if (id === undefined) throw new Error(`query returned nothing: ${sql}`);
  return id;
}

function startJwks(jwk: JWK): Promise<number> {
  return new Promise((resolve, reject) => {
    jwksServer = createServer((request, response) => {
      if (request.url?.endsWith("/protocol/openid-connect/certs")) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ keys: [jwk] }));
        return;
      }
      response.writeHead(404).end();
    });
    jwksServer.on("error", reject);
    jwksServer.listen(0, "127.0.0.1", () => {
      const address = jwksServer.address();
      if (address === null || typeof address === "string") {
        reject(new Error("expected a bound TCP port"));
        return;
      }
      resolve(address.port);
    });
  });
}

async function asAdmin(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: any }> {
  const jwt = await new SignJWT({})
    .setProtectedHeader({ alg: "RS256", kid: KID })
    .setIssuedAt()
    .setIssuer(issuer)
    .setAudience(AUDIENCE)
    .setSubject(ADMIN_SUB)
    .setExpirationTime("5m")
    .sign(privateKey);

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${jwt}`,
      "x-ds-project": projectSlug,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  const text = await response.text();
  return { status: response.status, body: text === "" ? undefined : JSON.parse(text) };
}

// ---------------------------------------------------------------------------

describe("the learner list", () => {
  it("shows both enrolments with their progress and submission stage", async () => {
    const { status, body } = await asAdmin("GET", `/admin/learners?course=${courseSlug}`);

    expect(status).toBe(200);
    expect(body).toHaveLength(2);
    const stages = body.map((row: { submissionStage: string }) => row.submissionStage);
    expect(stages.sort()).toEqual(["none", "submitted"]);
  });

  it("never returns an EFN in full", async () => {
    // The acceptance criterion, checked against the serialised body rather than
    // the mapping — a leak would be in what crosses the wire.
    const { body } = await asAdmin("GET", "/admin/learners");

    expect(JSON.stringify(body)).not.toContain(EFN);
    for (const row of body) {
      expect(row.maskedEfn).toBe("•••••••••••0123");
    }
  });

  it("does not carry a raw efn field at all", async () => {
    const { body } = await asAdmin("GET", "/admin/learners");
    expect(Object.keys(body[0])).not.toContain("efn");
  });
});

describe("correcting a learner's name", () => {
  it("allows it while nothing has been reported", async () => {
    const { status } = await asAdmin("PATCH", `/admin/learners/${openEnrolmentId}/name`, {
      name: "Dr. Anna Schmidt",
    });

    expect(status).toBe(204);
    const stored = await seedPool.query<{ attested_name: string }>(
      "SELECT attested_name FROM enrolments WHERE id = $1",
      [openEnrolmentId],
    );
    expect(stored.rows[0]?.attested_name).toBe("Dr. Anna Schmidt");
  });

  it("refuses once the Punktemeldung was accepted", async () => {
    // The acceptance criterion. The name is on the Ärztekammer's record; a
    // silent edit here would make the two disagree until somebody audited it.
    const { status, body } = await asAdmin(
      "PATCH",
      `/admin/learners/${submittedEnrolmentId}/name`,
      { name: "Dr. Zu Spät" },
    );

    expect(status).toBe(409);
    expect(body.detail).toContain("Ärztekammer");
  });

  it("left the reported name untouched after the refusal", async () => {
    const stored = await seedPool.query<{ attested_name: string }>(
      "SELECT attested_name FROM enrolments WHERE id = $1",
      [submittedEnrolmentId],
    );
    expect(stored.rows[0]?.attested_name).toBe("Dr. gemeldet");
  });

  it("refuses a blank name", async () => {
    const { status } = await asAdmin("PATCH", `/admin/learners/${openEnrolmentId}/name`, {
      name: "   ",
    });
    expect(status).toBe(422);
  });

  it("audits the correction without recording either name", async () => {
    const { rows } = await seedPool.query<{ detail: unknown; actor_identity: string }>(
      "SELECT detail, actor_identity FROM audit_log WHERE action = 'learner.name_corrected' AND subject = $1",
      [openEnrolmentId],
    );

    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0]?.detail)).not.toContain("Anna");
    // The console still authenticates on the learner plane in this suite; what
    // matters is that the population is recorded at all (ADR-0012).
    expect(["staff", "learner"]).toContain(rows[0]?.actor_identity);
  });
});

describe("certificate moderation", () => {
  it("regenerates without touching the Punktemeldung", async () => {
    const before = await submissionSnapshot();

    const { status } = await asAdmin(
      "POST",
      `/admin/certificates/${certificateId}/regenerate`,
    );
    expect(status).toBe(204);

    // The acceptance criterion: a regeneration re-renders a document and
    // reports nothing to anybody.
    expect(await submissionSnapshot()).toEqual(before);
  });

  it("picks up the corrected name for the new render", async () => {
    const { rows } = await seedPool.query<{ participant_name: string; status: string }>(
      "SELECT participant_name, status::text AS status FROM certificates WHERE id = $1",
      [certificateId],
    );
    expect(rows[0]?.participant_name).toBe("Dr. Anna Schmidt");
    expect(rows[0]?.status).toBe("pending");
  });

  it("refuses to resend one that has not been issued", async () => {
    const { status } = await asAdmin(
      "POST",
      `/admin/certificates/${certificateId}/resend`,
    );
    expect(status).toBe(409);
  });

  it("revokes an issued certificate and refuses everything afterwards", async () => {
    await seedPool.query(
      "UPDATE certificates SET status = 'issued', issued_at = now() WHERE id = $1",
      [certificateId],
    );

    expect(
      (await asAdmin("POST", `/admin/certificates/${certificateId}/revoke`)).status,
    ).toBe(204);
    expect(
      (await asAdmin("POST", `/admin/certificates/${certificateId}/resend`)).status,
    ).toBe(409);
    expect(
      (await asAdmin("POST", `/admin/certificates/${certificateId}/regenerate`)).status,
    ).toBe(409);
  });

  it("kept the enrolment behind the revoked certificate", async () => {
    // Revoking withdraws the document, not the record. What was earned was
    // earned, and the evidence behind the points has to survive.
    const { rows } = await seedPool.query("SELECT id FROM enrolments WHERE id = $1", [
      openEnrolmentId,
    ]);
    expect(rows).toHaveLength(1);
  });
});

describe("erasing a subject", () => {
  it("waits while a Punktemeldung is queued", async () => {
    const queued = await seedEnrolledLearner(
      await scalar("SELECT id FROM courses WHERE slug = $1", [courseSlug]),
      "wartend",
      "queued",
    );

    const { status, body } = await asAdmin("DELETE", `/admin/learners/${queued}`, {
      reason: "Löschantrag",
    });

    expect(status).toBe(409);
    expect(body.detail).toContain("Punktemeldung");
  });

  it("erases through erase_subject and records it", async () => {
    const { status, body } = await asAdmin(
      "DELETE",
      `/admin/learners/${openEnrolmentId}`,
      { reason: "Löschantrag vom 12.03." },
    );

    expect(status).toBe(200);
    expect(body.enrolments).toBeGreaterThan(0);

    // `erase_subject`'s own row — customer-less, quoting nothing erased.
    const gdpr = await seedPool.query(
      "SELECT 1 FROM audit_log WHERE action = 'gdpr.subject.erased'",
    );
    expect(gdpr.rows.length).toBeGreaterThan(0);

    // And the tenant-scoped one naming the operator.
    const operator = await seedPool.query(
      "SELECT 1 FROM audit_log WHERE action = 'learner.erasure_requested'",
    );
    expect(operator.rows.length).toBeGreaterThan(0);
  });

  it("removed the EFN it was holding", async () => {
    const { rows } = await seedPool.query(
      `SELECT 1 FROM efn_profiles p
         JOIN enrolments e ON e.user_id = p.user_id
        WHERE e.id = $1`,
      [openEnrolmentId],
    );
    expect(rows).toHaveLength(0);
  });
});

/** Everything about the submissions that a regeneration must not disturb. */
async function submissionSnapshot(): Promise<unknown[]> {
  const { rows } = await seedPool.query(
    `SELECT id, status::text AS status, attempt_count, external_reference,
            first_submitted_at
       FROM eiv_submissions WHERE customer_id = $1 ORDER BY id`,
    [customerId],
  );
  return rows;
}

describe("course presentation is authorable (P13-01)", () => {
  /**
   * The gap this closes: every field the Zeplin layout draws — the title, the
   * Lernziele checklist, the Zielgruppe block, the catalogue facets — was
   * stored and rendered from the first day and settable only by the seed
   * script. A customer could not change the title of their own course without
   * a developer.
   *
   * The assertion that matters is the last one: the edit has to arrive at the
   * *learner* endpoint, because a value the console can write and the widget
   * cannot read is not authorable in any useful sense.
   */
  it("saves every presentation field", async () => {
    const { status, body } = await asAdmin("PATCH", `/admin/courses/${courseSlug}`, {
      title: "ADHS Akademie adult – überarbeitet",
      description: "Eine neue Beschreibung.",
      deliveryType: "live",
      thema: ["ADHS", "Schlaf"],
      altersgruppe: ["Erwachsene"],
      learningObjectives: ["Sichere Diagnosestellung", "Evidenzbasierte Therapie"],
      targetAudience: "Fachärzte für Psychiatrie.\nVorkenntnisse sind von Vorteil.",
      heroImageUrl: "https://cdn.example.de/adhs.png",
      cmePoints: 6,
      cmeCategory: "D",
      fortbildungsnummer: "FB-2026-01",
      validFrom: "2026-01-01T00:00:00.000Z",
      validTo: "2026-12-31T00:00:00.000Z",
    });

    expect(status).toBe(200);
    expect(body).toMatchObject({
      title: "ADHS Akademie adult – überarbeitet",
      deliveryType: "live",
      thema: ["ADHS", "Schlaf"],
      learningObjectives: ["Sichere Diagnosestellung", "Evidenzbasierte Therapie"],
      cmePoints: 6,
      heroImageUrl: "https://cdn.example.de/adhs.png",
    });
  });

  it("keeps the newlines in Zielgruppe, which the layout renders as lines", async () => {
    const { body } = await asAdmin("GET", `/admin/courses/${courseSlug}`);
    expect(body.targetAudience).toContain("\n");
  });

  it("returns the accreditation window as an instant, not a date", async () => {
    const { body } = await asAdmin("GET", `/admin/courses/${courseSlug}`);
    expect(body.validFrom).toBe("2026-01-01T00:00:00.000Z");
  });

  it("leaves an absent field alone rather than clearing it", async () => {
    // A PATCH that mentions only the title must not blank the Lernziele — the
    // failure mode of a form that sends its whole state every time.
    await asAdmin("PATCH", `/admin/courses/${courseSlug}`, { title: "Nur der Titel" });

    const { body } = await asAdmin("GET", `/admin/courses/${courseSlug}`);
    expect(body.title).toBe("Nur der Titel");
    expect(body.learningObjectives).toHaveLength(2);
  });

  it("refuses a title that is only whitespace", async () => {
    const { status } = await asAdmin("PATCH", `/admin/courses/${courseSlug}`, {
      title: "   ",
    });
    expect(status).toBe(422);
  });

  it("reaches the learner-facing course endpoint", async () => {
    // The point of the whole ticket. The widget reads this shape to draw the
    // hero, the Lernziele and the Zielgruppe.
    const { status, body } = await asAdmin("GET", `/courses/${courseSlug}`);

    expect(status).toBe(200);
    expect(body.title).toBe("Nur der Titel");
    expect(body.learningObjectives).toEqual([
      "Sichere Diagnosestellung",
      "Evidenzbasierte Therapie",
    ]);
    expect(body.cmePoints).toBe(6);
  });
});
