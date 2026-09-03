/**
 * Course media uploads end to end (P23-01, P23-02), against real Postgres.
 *
 * The unit tests cover the decisions and the signature. What can only be
 * checked here is the part that spans four things at once — HTTP, RLS, an
 * append-only table and a bucket that verifies what it is sent:
 *
 * - **The key is not the client's to choose.** No request shape reaches another
 *   customer's prefix, and the one field that names a key on the way back is
 *   checked against the session's own customer.
 * - **The audit row survives the request failing.** Every refusal here is the
 *   handler throwing, which rolls back the request's transaction. If the
 *   recorder were on that connection the log would hold successes only — the
 *   opposite of what an audit log is for. This is the only place that can tell.
 * - **`complete` measures against the recorded mint, not the request.** Two
 *   different customers, two different courses, and a client that would very
 *   much like to declare its own expectations.
 * - **The log is append-only as `ds_app` actually connects**, not only as the
 *   migration left it.
 *
 * The bucket is `startFakeS3` — a real socket that recomputes the signature the
 * way Hetzner would, so a canonical request this API gets wrong fails here
 * rather than in production.
 */

import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { createPool } from "@ds/postgres";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWK } from "jose";
import { AppModule } from "../../src/app.module.js";
import { configureApp } from "../../src/configure-app.js";
import { loadConfig } from "../../src/config/config.js";
import { seedLearner } from "./support/seed-learner.js";
import { startFakeS3, type FakeS3 } from "../support/fake-s3.js";
import { requireEnv } from "./support/env.js";

const SUPERUSER_URL = requireEnv("POSTGRES_SUPERUSER_URL");

process.env["NODE_ENV"] ??= "test";
/*
 * The worker is off because `platform_settings` says so (P180-01), not
 * because of an environment variable. A fresh database starts with
 * `eiv_worker_enabled = false` and the endpoint on `mock`, so a suite that
 * sets nothing files nothing — a stronger guarantee than the line that used
 * to be here, which every new test file had to remember to copy.
 */

const KID = "uploads-key";
const AUDIENCE = "ds-education-api";
const RUN = randomUUID().slice(0, 8);
const ADMIN_SUB = `uploads-admin-${RUN}`;
const OTHER_ADMIN_SUB = `uploads-other-admin-${RUN}`;

let jwksServer: Server;
let bucket: FakeS3;
let privateKey: CryptoKey;
let issuer: string;
let app: NestExpressApplication;
let baseUrl: string;
let seedPool: Pool;

let projectSlug: string;
let otherProjectSlug: string;
let customerId: string;
let otherCustomerId: string;
let courseSlug: string;
let otherCourseSlug: string;
let secondCourseSlug: string;

beforeAll(async () => {
  seedPool = createPool({ connectionString: SUPERUSER_URL });
  bucket = await startFakeS3();

  // Set before the app is created: `loadConfig` reads the environment once, and
  // `objectStorageFor` decides from it whether uploads exist at all.
  process.env["S3_ENDPOINT"] = bucket.endpoint;
  process.env["S3_REGION"] = bucket.region;
  process.env["S3_BUCKET"] = bucket.bucket;
  process.env["S3_ACCESS_KEY_ID"] = bucket.accessKeyId;
  process.env["S3_SECRET_ACCESS_KEY"] = bucket.secretAccessKey;
  process.env["S3_FORCE_PATH_STYLE"] = "yes";

  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  const jwk = {
    ...(await exportJWK(pair.publicKey)),
    kid: KID,
    alg: "RS256",
    use: "sig",
  };

  const port = await startJwks(jwk);
  issuer = `http://127.0.0.1:${port}/realms/uploads-${RUN}`;

  process.env["KEYCLOAK_ISSUER"] = issuer;
  process.env["KEYCLOAK_AUDIENCE"] = AUDIENCE;
  process.env["KEYCLOAK_JWKS_URI"] = `${issuer}/protocol/openid-connect/certs`;

  // Two tenants, because a single-tenant upload test proves nothing about the
  // one guarantee object storage does not get from the database.
  ({ customerId, projectSlug, courseSlug } = await seedTenant("a"));
  ({
    customerId: otherCustomerId,
    projectSlug: otherProjectSlug,
    courseSlug: otherCourseSlug,
  } = await seedTenant("b"));

  // A second course inside the *same* tenant: "belongs to this customer" and
  // "belongs to this course" are different claims, and only this separates them.
  secondCourseSlug = await seedCourse(customerId, projectSlug, `kurs-zwei-${RUN}`);

  await grantAdmin(ADMIN_SUB, customerId);
  await grantAdmin(OTHER_ADMIN_SUB, otherCustomerId);

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
}, 30_000);

afterAll(async () => {
  await app?.close();
  await bucket?.close();
  await new Promise<void>((resolve) => jwksServer.close(() => resolve()));
  await seedPool.end();
});

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

async function insert(sql: string, values: unknown[]): Promise<string> {
  const { rows } = await seedPool.query<{ id: string }>(sql, values);
  const id = rows[0]?.id;
  if (id === undefined) throw new Error(`seed insert returned no id: ${sql}`);
  return id;
}

async function seedTenant(tag: string) {
  const customerId = await insert(
    "INSERT INTO customers (slug, name) VALUES ($1,$2) RETURNING id",
    [`uploads-${tag}-${RUN}`, `Uploads ${tag} GmbH`],
  );
  const departmentId = await insert(
    "INSERT INTO departments (customer_id, slug, name) VALUES ($1,$2,$3) RETURNING id",
    [customerId, `abteilung-${tag}-${RUN}`, "Abteilung"],
  );
  const projectSlug = `projekt-${tag}-${RUN}`;
  await insert(
    `INSERT INTO projects (customer_id, department_id, slug, name,
                           keycloak_issuer, keycloak_audience)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [customerId, departmentId, projectSlug, "Projekt", issuer, AUDIENCE],
  );
  const courseSlug = await seedCourse(customerId, projectSlug, `kurs-${tag}-${RUN}`);

  return { customerId, projectSlug, courseSlug };
}

async function seedCourse(
  customerId: string,
  projectSlug: string,
  slug: string,
): Promise<string> {
  const { rows } = await seedPool.query<{ id: string }>(
    "SELECT id FROM projects WHERE slug = $1",
    [projectSlug],
  );
  await insert(
    `INSERT INTO courses (customer_id, project_id, slug, title, delivery_type, status)
     VALUES ($1,$2,$3,$4,'on_demand','published') RETURNING id`,
    [customerId, rows[0]?.id, slug, "Kurs"],
  );
  return slug;
}

async function grantAdmin(subject: string, customerId: string): Promise<void> {
  const { id } = await seedLearner(seedPool, { realm: issuer, subject });
  await seedPool.query(
    "INSERT INTO user_roles (user_id, role, customer_id) VALUES ($1,'customer_admin',$2)",
    [id, customerId],
  );
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

interface Answer {
  readonly status: number;
  // Responses vary by endpoint; the tests assert on the fields they name.
  readonly body: any;
}

async function callAs(
  sub: string,
  project: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<Answer> {
  const jwt = await new SignJWT({})
    .setProtectedHeader({ alg: "RS256", kid: KID })
    .setIssuedAt()
    .setIssuer(issuer)
    .setAudience(AUDIENCE)
    .setSubject(sub)
    .setExpirationTime("5m")
    .sign(privateKey);

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${jwt}`,
      "x-ds-project": project,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  const text = await response.text();
  return { status: response.status, body: text === "" ? undefined : JSON.parse(text) };
}

const asAdmin = (method: string, path: string, body?: unknown) =>
  callAs(ADMIN_SUB, projectSlug, method, path, body);
const asOtherAdmin = (method: string, path: string, body?: unknown) =>
  callAs(OTHER_ADMIN_SUB, otherProjectSlug, method, path, body);

/** Ask for a ticket, and fail loudly if the API refused. */
async function ticketFor(
  slug = courseSlug,
  request: Record<string, unknown> = {
    purpose: "video",
    mimeType: "video/mp4",
    sizeBytes: 11,
  },
): Promise<Answer["body"]> {
  const answer = await asAdmin("POST", `/admin/courses/${slug}/uploads`, request);
  expect(answer.status, JSON.stringify(answer.body)).toBe(201);
  return answer.body;
}

/** PUT the bytes the way a browser would: the ticket's headers, verbatim. */
async function put(ticket: Answer["body"], body: Buffer): Promise<number> {
  const response = await fetch(ticket.url, {
    method: "PUT",
    headers: ticket.headers,
    body,
  });
  return response.status;
}

async function auditRows(objectKey: string) {
  const { rows } = await seedPool.query<{
    action: string;
    succeeded: boolean;
    detail: string | null;
    customer_id: string;
    size_bytes: string | null;
  }>(
    `SELECT action, succeeded, detail, customer_id, size_bytes
       FROM storage_audit_log WHERE object_key = $1 ORDER BY id`,
    [objectKey],
  );
  return rows;
}

// ---------------------------------------------------------------------------

describe("the happy path", () => {
  it("mints, uploads, verifies, and hands back a reference", async () => {
    const body = Buffer.from("hello video");
    const ticket = await ticketFor(courseSlug, {
      purpose: "video",
      mimeType: "video/mp4",
      sizeBytes: body.byteLength,
    });

    expect(await put(ticket, body)).toBe(200);

    const confirmed = await asAdmin(
      "POST",
      `/admin/courses/${courseSlug}/uploads/complete`,
      { key: ticket.key },
    );

    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
    expect(confirmed.body.reference).toBe(`s3://${ticket.key}`);
    expect(confirmed.body.sizeBytes).toBe(body.byteLength);
    expect(confirmed.body.mimeType).toBe("video/mp4");
  });

  it("puts the object under this customer's prefix and this course", async () => {
    const ticket = await ticketFor();
    expect(ticket.key.startsWith(`${customerId}/courses/`)).toBe(true);
  });

  it("records the mint and the store, in that order", async () => {
    const body = Buffer.from("hello video");
    const ticket = await ticketFor(courseSlug, {
      purpose: "video",
      mimeType: "video/mp4",
      sizeBytes: body.byteLength,
    });
    await put(ticket, body);
    await asAdmin("POST", `/admin/courses/${courseSlug}/uploads/complete`, {
      key: ticket.key,
    });

    const rows = await auditRows(ticket.key);
    expect(rows.map((row) => row.action)).toEqual(["mint", "store"]);
    expect(rows.every((row) => row.succeeded)).toBe(true);
    expect(rows.every((row) => row.customer_id === customerId)).toBe(true);
  });

  it("stores the reference on a content item", async () => {
    // The end of the road: an uploaded object attached to a lesson. Before
    // P23-01 the field required an absolute URL and this was a 422.
    const body = Buffer.from("hello video");
    const ticket = await ticketFor(courseSlug, {
      purpose: "video",
      mimeType: "video/mp4",
      sizeBytes: body.byteLength,
    });
    await put(ticket, body);
    await asAdmin("POST", `/admin/courses/${courseSlug}/uploads/complete`, {
      key: ticket.key,
    });

    const module = await asAdmin("POST", `/admin/courses/${courseSlug}/modules`, {
      title: "Modul",
    });
    expect(module.status).toBe(201);
    const moduleId = module.body.modules.at(-1).id;

    const chapter = await asAdmin("POST", `/admin/modules/${moduleId}/chapters`, {
      title: "Kapitel",
    });
    const chapterId = chapter.body.modules.at(-1).chapters.at(-1).id;

    const content = await asAdmin("POST", `/admin/chapters/${chapterId}/contents`, {
      kind: "video",
      title: "Vortrag",
      durationSec: 60,
      sources: [{ url: `s3://${ticket.key}`, mimeType: "video/mp4" }],
    });

    expect(content.status, JSON.stringify(content.body)).toBe(201);
  });
});

describe("what a client is not allowed to decide", () => {
  it("refuses an unsupported type before signing anything", async () => {
    const answer = await asAdmin("POST", `/admin/courses/${courseSlug}/uploads`, {
      purpose: "video",
      mimeType: "video/quicktime",
      sizeBytes: 10,
    });

    expect(answer.status).toBe(422);
  });

  it("records the refusal even though the request rolled back", async () => {
    // The reason `StorageAuditRecorder` takes the pool and not the request's
    // connection. Revert that and this is the test that fails.
    await asAdmin("POST", `/admin/courses/${courseSlug}/uploads`, {
      purpose: "poster",
      mimeType: "application/pdf",
      sizeBytes: 10,
    });

    const { rows } = await seedPool.query<{ detail: string }>(
      `SELECT detail FROM storage_audit_log
        WHERE customer_id = $1 AND action = 'refuse' AND NOT succeeded
        ORDER BY id DESC LIMIT 1`,
      [customerId],
    );

    expect(rows[0]?.detail).toBe("unsupported_type");
  });

  it("refuses a file over the ceiling for its purpose", async () => {
    const answer = await asAdmin("POST", `/admin/courses/${courseSlug}/uploads`, {
      purpose: "poster",
      mimeType: "image/png",
      sizeBytes: 64 * 1024 * 1024,
    });

    expect(answer.status).toBe(422);
  });

  it("cannot complete an upload it never began", async () => {
    const answer = await asAdmin(
      "POST",
      `/admin/courses/${courseSlug}/uploads/complete`,
      { key: `${customerId}/courses/${randomUUID()}/video-deadbeef.mp4` },
    );

    expect(answer.status).toBe(404);
  });

  it("cannot complete an upload issued for another course in the same tenant", async () => {
    // Same customer, so the prefix check passes. The course id is what refuses,
    // and without it an author could move an object between courses by naming a
    // different slug on the way back.
    const ticket = await ticketFor(courseSlug);
    const answer = await asAdmin(
      "POST",
      `/admin/courses/${secondCourseSlug}/uploads/complete`,
      { key: ticket.key },
    );

    expect(answer.status).toBe(404);
  });
});

describe("the tenant boundary, which the bucket cannot enforce", () => {
  it("gives another customer's admin a 404 for a course they cannot see", async () => {
    const answer = await asOtherAdmin("POST", `/admin/courses/${courseSlug}/uploads`, {
      purpose: "video",
      mimeType: "video/mp4",
      sizeBytes: 10,
    });

    expect(answer.status).toBe(404);
  });

  it("refuses a completion naming a key under another customer's prefix", async () => {
    const ticket = await ticketFor();

    const answer = await asOtherAdmin(
      "POST",
      `/admin/courses/${otherCourseSlug}/uploads/complete`,
      { key: ticket.key },
    );

    // 404, not 403: confirming that somebody else's object exists is exactly
    // the fact the prefix check is protecting.
    expect(answer.status).toBe(404);
  });

  it("records that refusal against the customer who attempted it", async () => {
    const ticket = await ticketFor();
    await asOtherAdmin("POST", `/admin/courses/${otherCourseSlug}/uploads/complete`, {
      key: ticket.key,
    });

    const rows = await auditRows(ticket.key);
    const refusal = rows.find((row) => row.action === "refuse");

    expect(refusal?.customer_id).toBe(otherCustomerId);
    expect(refusal?.detail).toBe("key is outside this customer's prefix");
  });

  it("refuses an s3 reference to another tenant's object on a content item", async () => {
    const foreign = `s3://${otherCustomerId}/courses/${randomUUID()}/video-x.mp4`;

    const module = await asAdmin("POST", `/admin/courses/${courseSlug}/modules`, {
      title: "Modul",
    });
    const moduleId = module.body.modules.at(-1).id;
    const chapter = await asAdmin("POST", `/admin/modules/${moduleId}/chapters`, {
      title: "Kapitel",
    });
    const chapterId = chapter.body.modules.at(-1).chapters.at(-1).id;

    const content = await asAdmin("POST", `/admin/chapters/${chapterId}/contents`, {
      kind: "video",
      title: "Vortrag",
      durationSec: 60,
      sources: [{ url: foreign, mimeType: "video/mp4" }],
    });

    expect(content.status).toBe(422);
  });
});

/**
 * Looking at what was uploaded (P74-02).
 *
 * > _"for here, can we have the preview of the video, and the preview of images
 * > uploaded?"_
 *
 * The console holds an `s3://` reference and a browser cannot fetch one, so the
 * form could show a filename and nothing else — and `Aus Video ermitteln`, the
 * one control that gets `durationSec` right, disappeared exactly when the
 * author used this console to put the file there.
 *
 * The route hands back a signed GET. What has to hold is that it is *only* a
 * signed GET, for an object of the course it is asked about, for the tenant
 * asking.
 */
describe("reading an object back", () => {
  it("hands back a URL the bucket actually serves", async () => {
    const body = Buffer.from("hello video");
    const ticket = await ticketFor(courseSlug, {
      purpose: "video",
      mimeType: "video/mp4",
      sizeBytes: body.byteLength,
    });
    await put(ticket, body);
    await asAdmin("POST", `/admin/courses/${courseSlug}/uploads/complete`, {
      key: ticket.key,
    });

    const view = await asAdmin("POST", `/admin/courses/${courseSlug}/uploads/view`, {
      reference: `s3://${ticket.key}`,
    });
    expect(view.status, JSON.stringify(view.body)).toBe(200);

    // Against the fake bucket, which recomputes the signature the way Hetzner
    // would — so a canonical request this API gets wrong fails here.
    const fetched = await fetch(view.body.url);
    expect(fetched.status).toBe(200);
    expect(Buffer.from(await fetched.arrayBuffer()).toString()).toBe("hello video");
  });

  it("records the read, so an issued capability is in the log", async () => {
    const ticket = await ticketFor();
    await put(ticket, Buffer.from("hello video"));
    await asAdmin("POST", `/admin/courses/${courseSlug}/uploads/complete`, {
      key: ticket.key,
    });
    await asAdmin("POST", `/admin/courses/${courseSlug}/uploads/view`, {
      reference: `s3://${ticket.key}`,
    });

    const rows = await auditRows(ticket.key);
    expect(rows.map((row) => row.action)).toEqual(["mint", "store", "read"]);
  });

  it("shows a file this course reuses from the customer's Mediathek", async () => {
    /*
     * P161-01. The reuse the Mediathek exists for: a video uploaded while
     * building one course, picked again from the library while building the
     * next. Its key carries the *first* course's prefix for ever — keys are
     * minted once and objects are never copied — so a rule that asks "is this
     * key under the course I am looking at" refuses every reused file.
     *
     * `complete` is what writes the library row, so this is the difference
     * between a file the customer owns and a key somebody typed.
     */
    const body = Buffer.from("hello video");
    const ticket = await ticketFor(secondCourseSlug, {
      purpose: "video",
      mimeType: "video/mp4",
      sizeBytes: body.byteLength,
    });
    await put(ticket, body);
    await asAdmin("POST", `/admin/courses/${secondCourseSlug}/uploads/complete`, {
      key: ticket.key,
    });

    const view = await asAdmin("POST", `/admin/courses/${courseSlug}/uploads/view`, {
      reference: `s3://${ticket.key}`,
    });
    expect(view.status, JSON.stringify(view.body)).toBe(200);

    const fetched = await fetch(view.body.url);
    expect(fetched.status).toBe(200);
    expect(Buffer.from(await fetched.arrayBuffer()).toString()).toBe("hello video");
  });

  it("refuses a key from another course that the library does not know", async () => {
    /*
     * The guard on the case above, and what the old course-prefix rule is now
     * narrowed to. A ticket that was minted and never completed leaves no
     * library row, so the object is not a file the customer owns — it is a key
     * a caller named. The relaxation is "the Mediathek has this file", never
     * "this key is under the customer prefix".
     *
     * This case is the previous rule's own test, kept and re-aimed. Its old
     * comment said the check stopped an author who may edit one course reading
     * another course's objects. That threat does not exist on this controller:
     * AUTHOR_ROLES here is customer_admin and super_admin, and both can already
     * list the whole library and mint a read URL for any row in it through
     * /admin/media/{id}/view. See P161.
     */
    const ticket = await ticketFor(secondCourseSlug);

    const view = await asAdmin("POST", `/admin/courses/${courseSlug}/uploads/view`, {
      reference: `s3://${ticket.key}`,
    });
    expect(view.status).toBe(404);

    /*
     * And no capability was issued for it.
     *
     * The refusal row itself is deliberately *not* findable by this key — it
     * is recorded against the course's own prefix, because the reference is
     * client-supplied and an operator reads that log. So the property asserted
     * here is the one the key can answer: nothing signed it.
     */
    const rows = await auditRows(ticket.key);
    expect(rows.map((row) => row.action)).not.toContain("read");
  });

  it("refuses a key under another customer's prefix", async () => {
    const foreign = `${otherCustomerId}/courses/${randomUUID()}/video-x.mp4`;

    const view = await asAdmin("POST", `/admin/courses/${courseSlug}/uploads/view`, {
      reference: `s3://${foreign}`,
    });
    expect(view.status).toBe(404);
  });

  it("refuses an ordinary URL rather than echoing it back", async () => {
    // Otherwise this route is a way to have the API bless an arbitrary address,
    // and a console that trusted the answer would render whatever came back.
    const view = await asAdmin("POST", `/admin/courses/${courseSlug}/uploads/view`, {
      reference: "https://media.example.org/somebody-elses/1.mp4",
    });
    expect(view.status).toBe(404);
  });

  it("gives another customer's admin a 404 for a course they cannot see", async () => {
    const view = await asOtherAdmin("POST", `/admin/courses/${courseSlug}/uploads/view`, {
      reference: `s3://${customerId}/courses/x/video-x.mp4`,
    });
    expect(view.status).toBe(404);
  });
});

describe("verification against the bucket", () => {
  it("refuses a completion when nothing was uploaded", async () => {
    const ticket = await ticketFor();

    const answer = await asAdmin(
      "POST",
      `/admin/courses/${courseSlug}/uploads/complete`,
      { key: ticket.key },
    );

    expect(answer.status).toBe(422);
    const rows = await auditRows(ticket.key);
    expect(rows.at(-1)?.detail).toContain("not found in the bucket");
  });

  it("refuses a body the signature did not cover", async () => {
    // The browser computes Content-Length and script cannot set it, so a file
    // of a different length produces a request the bucket will not verify. This
    // is the size limit's real enforcement, and it happens before we are asked.
    const ticket = await ticketFor(courseSlug, {
      purpose: "video",
      mimeType: "video/mp4",
      sizeBytes: 11,
    });

    expect(await put(ticket, Buffer.from("hello videos"))).toBe(403);
  });

  it("measures the object against the recorded mint, not the request", async () => {
    // A client would like to declare 11 bytes, upload something else, and then
    // declare *that*. There is no field in `complete` to declare it with, and
    // the expectation is read from the append-only mint row.
    const body = Buffer.from("hello video");
    const ticket = await ticketFor(courseSlug, {
      purpose: "video",
      mimeType: "video/mp4",
      sizeBytes: body.byteLength,
    });
    await put(ticket, body);

    const answer = await asAdmin(
      "POST",
      `/admin/courses/${courseSlug}/uploads/complete`,
      { key: ticket.key, sizeBytes: 999_999, mimeType: "application/pdf" },
    );

    expect(answer.status).toBe(200);
    expect(answer.body.sizeBytes).toBe(body.byteLength);
    expect(answer.body.mimeType).toBe("video/mp4");
  });
});

describe("the log itself", () => {
  it("is append-only for the application role", async () => {
    const { rows } = await seedPool.query<{ writable: boolean }>(
      `SELECT has_table_privilege('ds_app', 'storage_audit_log', 'UPDATE')
           OR has_table_privilege('ds_app', 'storage_audit_log', 'DELETE')
           AS writable`,
    );

    expect(rows[0]?.writable).toBe(false);
  });

  it("holds no personal data — only ids, keys and types", async () => {
    const ticket = await ticketFor();

    const { rows } = await seedPool.query<{ detail: string | null; object_key: string }>(
      "SELECT detail, object_key FROM storage_audit_log WHERE object_key = $1",
      [ticket.key],
    );

    // The key is two UUIDs and a name we generated; `detail` is written by us
    // from a closed set. Neither can carry an email, a name or an EFN — and the
    // uploader's own filename never reaches either.
    for (const row of rows) {
      expect(row.object_key).toMatch(
        /^[0-9a-f-]{36}\/courses\/[0-9a-f-]{36}\/[a-z]+-[0-9a-f]{32}\.[a-z0-9]+$/,
      );
      expect(row.detail ?? "").not.toContain("@");
    }
  });

  it("is scoped by RLS — one tenant cannot read another's entries", async () => {
    const ticket = await ticketFor();

    const client = await seedPool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE ds_app");
      await client.query("SELECT set_config('app.customer_id', $1, true)", [
        otherCustomerId,
      ]);
      const { rows } = await client.query(
        "SELECT count(*)::int AS n FROM storage_audit_log WHERE object_key = $1",
        [ticket.key],
      );
      expect(rows[0]?.n).toBe(0);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});

describe("a bucket that does not answer (P145-01)", () => {
  /*
   * The property the client asked for in one sentence: *"can we please make
   * sure this does not happen again in the whole application that api hangs?"*
   *
   * A deadline alone does not deliver it. Under the ambient transaction, an
   * upload waiting on the object store holds one of ten pooled connections for
   * the whole wait — so ten uploads against a bucket that is merely *slow*
   * stall every other screen for the length of the deadline. Fifteen seconds
   * of that is not a fixed bug, it is a shorter one.
   *
   * `@NoAmbientTransaction()` on the routes that call the bucket is what makes
   * the answer "uploads are failing" rather than "the platform is down".
   *
   * `bucket.stall()` holds the response rather than refusing it: a bucket that
   * answers 500 releases the connection immediately and would prove nothing.
   * §9.13's rule about fixtures — a bucket that always answers cannot find a
   * caller that waits.
   */
  it("keeps serving every other route while uploads wait on it", async () => {
    const ticket = await ticketFor(courseSlug, {
      purpose: "video",
      mimeType: "video/mp4",
      sizeBytes: 11,
    });
    expect(await put(ticket, Buffer.from("hello video"))).toBe(200);

    const release = bucket.stall();

    // More than the pool's `max` of ten, so that under the old arrangement
    // every connection is held and the eleventh caller has nothing to wait for.
    const stalled = Array.from({ length: 12 }, () =>
      asAdmin("POST", `/admin/courses/${courseSlug}/uploads/complete`, {
        key: ticket.key,
      }).catch((error: unknown) => ({ status: 0, body: { error: String(error) } })),
    );

    try {
      // Give them time to reach the bucket and be held there.
      await new Promise((resolve) => setTimeout(resolve, 300));

      /*
       * The assertion. An unrelated read, on a different route, with twelve
       * uploads in flight against a bucket that is saying nothing.
       *
       * Under the ambient transaction this cannot answer: all ten connections
       * are held by the stalled handlers, so it waits out
       * `connectionTimeoutMillis` and fails. It is the whole defect, in one
       * request.
       */
      const started = Date.now();
      const answer = await asAdmin("GET", "/admin/media");
      const elapsed = Date.now() - started;

      expect(answer.status, JSON.stringify(answer.body)).toBe(200);
      // Comfortably under the 5 s checkout timeout: the point is that it never
      // queued at all, not that it queued briefly.
      expect(elapsed).toBeLessThan(2_000);
    } finally {
      release();
      await Promise.all(stalled);
    }
  });

  it("still completes the uploads once the bucket answers", async () => {
    const ticket = await ticketFor(courseSlug, {
      purpose: "video",
      mimeType: "video/mp4",
      sizeBytes: 11,
    });
    expect(await put(ticket, Buffer.from("hello video"))).toBe(200);

    const release = bucket.stall();
    const pending = asAdmin("POST", `/admin/courses/${courseSlug}/uploads/complete`, {
      key: ticket.key,
    });

    await new Promise((resolve) => setTimeout(resolve, 200));
    release();

    const confirmed = await pending;
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
    expect(confirmed.body.reference).toBe(`s3://${ticket.key}`);
  });
});
