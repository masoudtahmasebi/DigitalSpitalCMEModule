/**
 * Every request this client makes must exist in the contract — same path,
 * **same verb**.
 *
 * ## Why this test exists
 *
 * `enrol` sent `POST /courses/{slug}/enrolment`. The contract and the API both
 * declare `PUT`. So a first-time learner opening a course got a 404 and the
 * widget rendered "Diese Fortbildung wurde nicht gefunden" — the whole product,
 * unreachable, on the first click.
 *
 * Nothing caught it, and the reasons are worth naming because each looked like
 * coverage:
 *
 * - The **DTO/SDK parity test** compares request and response *shapes*. A shape
 *   is identical whichever verb carries it.
 * - The **integration suite** calls endpoints over HTTP directly, writing the
 *   verb itself. It was testing the API, not this client.
 * - The **widget and console tests** stub `ApiClient`, so the transport never
 *   runs.
 * - `openapi-typescript` emits *types*, and a `method` string inside a
 *   `RequestInit` is not checked against them.
 *
 * The gap was structural: three test layers, and the line joining a URL to a
 * verb was in none of them. It was found by running the product.
 *
 * ## How it works
 *
 * `fetch` is stubbed globally to record `(method, path)` and answer everything
 * with an empty JSON object. Every client method is called once, and each
 * recorded pair is looked up in `contracts/openapi.yaml` — parsed at runtime
 * rather than through the generated types, because verbs are exactly what those
 * types erase at this boundary.
 *
 * `covers every method on the client` keeps it total: a new endpoint added
 * without a line in `INVOKE` fails there rather than going unchecked, which is
 * how `enrol` survived.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { load } from "js-yaml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "./index.js";

const CONTRACT = fileURLToPath(
  new URL("../../../contracts/openapi.yaml", import.meta.url),
);

interface OpenApi {
  paths: Record<string, Record<string, unknown>>;
}

const contract = load(readFileSync(CONTRACT, "utf8")) as OpenApi;

/** `/courses/adhs/enrolment` → `/courses/{slug}/enrolment`, matched by shape. */
function templatesFor(path: string): string[] {
  const actual = path.split("/").filter((s) => s !== "");
  return Object.keys(contract.paths).filter((template) => {
    const parts = template.split("/").filter((s) => s !== "");
    if (parts.length !== actual.length) return false;
    return parts.every(
      (part, i) => (part.startsWith("{") && part.endsWith("}")) || part === actual[i],
    );
  });
}

const calls: Array<{ method: string; path: string }> = [];

beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    calls.push({ method: (init?.method ?? "GET").toUpperCase(), path: url.pathname });
    return new Response("{}", {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
});

afterEach(() => vi.unstubAllGlobals());

function client() {
  return createClient({
    baseUrl: "https://api.test",
    projectSlug: "p",
    getToken: async () => "t",
  });
}

const ID = "11111111-1111-4111-8111-111111111111";
/** A second id, for the two calls that name two people at once. */
const OTHER_ID = "22222222-2222-4222-8222-222222222222";

/** One invocation per client method. Arguments only need to be well-typed. */
const INVOKE: Record<string, (c: ReturnType<typeof client>) => unknown> = {
  health: (c) => c.health(),
  getBranding: (c) => c.getBranding(),

  listCourses: (c) => c.listCourses({ page: 1 }),
  getCourseBySlug: (c) => c.getCourseBySlug("adhs"),
  enrol: (c) => c.enrol("adhs"),
  getEnrolment: (c) => c.getEnrolment("adhs"),
  getLesson: (c) => c.getLesson("adhs", ID),
  recordProgress: (c) => c.recordProgress("adhs", ID, { segments: [] }),
  acknowledgeReading: (c) => c.acknowledgeReading("adhs", ID),
  getQuiz: (c) => c.getQuiz("adhs", ID),
  submitQuiz: (c) => c.submitQuiz("adhs", ID, { answers: [] }),
  getMaterials: (c) => c.getMaterials("adhs"),
  getEvaluation: (c) => c.getEvaluation("adhs"),
  submitEvaluation: (c) => c.submitEvaluation("adhs", { answers: [] }),
  getEfn: (c) => c.getEfn(),
  setEfn: (c) => c.setEfn("123456789012345"),
  completeCourse: (c) => c.completeCourse("adhs", {}),
  getCertificate: (c) => c.getCertificate("adhs"),
  downloadCertificate: (c) => c.downloadCertificate("adhs"),

  adminListCourses: (c) => c.adminListCourses(),
  adminGetCourse: (c) => c.adminGetCourse("adhs"),
  adminUpdateCourse: (c) => c.adminUpdateCourse("adhs", {}),
  adminSetCertificateAssets: (c) => c.adminSetCertificateAssets("adhs", {}),
  adminCheckCourseMedia: (c) => c.adminCheckCourseMedia("adhs"),
  adminGetFont: (c) => c.adminGetFont(),
  adminSetFont: (c) => c.adminSetFont({ familyName: "X", fileBase64: "AA==" }),
  adminClearFont: (c) => c.adminClearFont(),
  adminListParticipants: (c) => c.adminListParticipants("adhs"),
  adminExportParticipants: (c) => c.adminExportParticipants("adhs"),
  adminListLearners: (c) => c.adminListLearners("adhs"),
  // Participant accounts (P21-04) — people, not enrolments.
  adminListParticipantAccounts: (c) => c.adminListParticipantAccounts("schmidt"),
  adminCreateParticipant: (c) =>
    c.adminCreateParticipant({
      email: "neu@example.org",
      firstName: "Neue",
      lastName: "Teilnehmende",
    }),
  adminResetParticipantPassword: (c) => c.adminResetParticipantPassword(ID),
  adminSetParticipantDisabled: (c) => c.adminSetParticipantDisabled(ID, true),
  adminPreviewParticipantMerge: (c) =>
    c.adminPreviewParticipantMerge({ sourceUserId: ID, targetUserId: OTHER_ID }),
  adminMergeParticipants: (c) =>
    c.adminMergeParticipants({
      sourceUserId: ID,
      targetUserId: OTHER_ID,
      confirm: OTHER_ID,
    }),
  adminCorrectLearnerName: (c) => c.adminCorrectLearnerName(ID, "Dr. Anna Schmidt"),
  adminEraseSubject: (c) => c.adminEraseSubject(ID, "Löschantrag"),
  /*
   * With a password, because that is the shape the console sends and the one
   * where a mistake matters: it must reach the **body**, never the path.
   */
  adminCheckEivConnection: (c) => c.adminCheckEivConnection("adhs", { vnrPassword: "x" }),
  adminDescribeEivEvent: (c) => c.adminDescribeEivEvent("adhs"),
  adminReconcileEiv: (c) => c.adminReconcileEiv("adhs"),
  /*
   * With a filter, so the property under test is that the status reaches the
   * **query string** — the queue screen's whole job is narrowing to
   * `failed_permanent` or `queued`, and a filter dropped on the way to the API
   * returns every row and looks like a screen with no filter rather than a
   * broken one.
   */
  adminListEivSubmissions: (c) =>
    c.adminListEivSubmissions({ status: "failed_permanent", page: 2 }),
  adminRequeueEivSubmission: (c) => c.adminRequeueEivSubmission(ID),
  adminCorrectSubmissionEfn: (c) => c.adminCorrectSubmissionEfn(ID, "802760699000001"),
  adminWithdrawEivSubmission: (c) => c.adminWithdrawEivSubmission(ID, "Widerruf"),
  adminListCertificates: (c) => c.adminListCertificates(),
  adminRegenerateCertificate: (c) => c.adminRegenerateCertificate(ID),
  adminResendCertificate: (c) => c.adminResendCertificate(ID),
  adminDownloadCertificate: (c) => c.adminDownloadCertificate(ID),
  adminSampleCertificate: (c) => c.adminSampleCertificate("adhs"),
  adminRevokeCertificate: (c) => c.adminRevokeCertificate(ID),
  adminListStaff: (c) => c.adminListStaff(),
  adminInviteStaff: (c) =>
    c.adminInviteStaff({
      email: "operator@ds.test",
      displayName: "Operator",
      role: "customer_admin",
      customerId: ID,
      departmentId: null,
    }),
  adminSetStaffPassword: (c) => c.adminSetStaffPassword(ID, "korrekt-pferd-batterie"),
  adminSetStaffScope: (c) =>
    c.adminSetStaffScope(ID, {
      role: "course_editor",
      customerId: ID,
      departmentId: null,
    }),
  adminSetStaffDisabled: (c) => c.adminSetStaffDisabled(ID, true),
  adminSignOutStaffEverywhere: (c) => c.adminSignOutStaffEverywhere(ID),
  adminResetStaffSecondFactor: (c) => c.adminResetStaffSecondFactor(ID),
  adminGetSecondFactorPolicy: (c) => c.adminGetSecondFactorPolicy(),
  adminSetSecondFactorPolicy: (c) =>
    c.adminSetSecondFactorPolicy({ customerId: null, policy: "required" }),
  adminRemoveOwnSecondFactor: (c) => c.adminRemoveOwnSecondFactor(),
  adminListCustomers: (c) => c.adminListCustomers(),
  adminGetEivPlatformSettings: (c) => c.adminGetEivPlatformSettings(),
  adminUpdateEivPlatformSettings: (c) =>
    c.adminUpdateEivPlatformSettings({ workerEnabled: false }),
  adminGetCustomer: (c) => c.adminGetCustomer("medice"),
  adminCreateCustomer: (c) => c.adminCreateCustomer({ slug: "medice", name: "MEDICE" }),
  adminUpdateCustomer: (c) => c.adminUpdateCustomer("medice", { name: "MEDICE" }),
  adminDeleteCustomer: (c) => c.adminDeleteCustomer("medice"),
  adminListDepartments: (c) => c.adminListDepartments(),
  adminCreateDepartment: (c) => c.adminCreateDepartment({ slug: "d", name: "D" }),
  adminUpdateDepartment: (c) => c.adminUpdateDepartment("d", {}),
  adminDeleteDepartment: (c) => c.adminDeleteDepartment("d"),
  adminListProjects: (c) => c.adminListProjects(),
  adminCreateProject: (c) =>
    c.adminCreateProject({
      slug: "p",
      name: "P",
      departmentSlug: "d",
      keycloakIssuer: "https://k/realms/r",
      keycloakAudience: "a",
    }),
  adminUpdateProject: (c) => c.adminUpdateProject("p", {}),
  adminDeleteProject: (c) => c.adminDeleteProject("p"),
  adminCreateCourse: (c) =>
    c.adminCreateCourse({
      slug: "s",
      title: "T",
      projectSlug: "p",
      deliveryType: "on_demand",
    }),
  adminCloneCourse: (c) => c.adminCloneCourse("adhs", { slug: "adhs-2", title: "T" }),
  adminGetStructure: (c) => c.adminGetStructure("adhs"),
  adminBeginUpload: (c) =>
    c.adminBeginUpload("adhs", {
      purpose: "video",
      mimeType: "video/mp4",
      sizeBytes: 1024,
    }),
  adminCompleteUpload: (c) =>
    c.adminCompleteUpload("adhs", "cust/courses/id/video-x.mp4"),
  adminBeginMultipartUpload: (c) =>
    c.adminBeginMultipartUpload("adhs", {
      purpose: "video",
      mimeType: "video/mp4",
      // Past the multipart threshold, so this exercises the route it names.
      sizeBytes: 3 * 1024 * 1024 * 1024,
    }),
  adminSignUploadParts: (c) =>
    c.adminSignUploadParts("adhs", {
      key: "cust/courses/id/video-x.mp4",
      uploadId: "up-1",
      partNumbers: [1, 2],
    }),
  adminCompleteMultipartUpload: (c) =>
    c.adminCompleteMultipartUpload("adhs", {
      key: "cust/courses/id/video-x.mp4",
      uploadId: "up-1",
    }),
  adminViewUpload: (c) => c.adminViewUpload("adhs", "s3://cust/courses/id/video-x.mp4"),
  adminViewMedia: (c) => c.adminViewMedia("11111111-1111-4111-8111-111111111111"),
  adminListMedia: (c) => c.adminListMedia({ kind: "video", limit: 20 }),
  adminDescribeMedia: (c) => c.adminDescribeMedia(ID, { title: "Intro" }),
  adminForgetMedia: (c) => c.adminForgetMedia(ID),
  adminCreateModule: (c) => c.adminCreateModule("adhs", { title: "M" }),
  adminUpdateModule: (c) => c.adminUpdateModule(ID, { title: "M" }),
  adminDeleteCourse: (c) => c.adminDeleteCourse("adhs"),
  adminDeleteModule: (c) => c.adminDeleteModule(ID),
  adminCreateChapter: (c) => c.adminCreateChapter(ID, { title: "K" }),
  adminUpdateChapter: (c) => c.adminUpdateChapter(ID, { title: "K" }),
  adminDeleteChapter: (c) => c.adminDeleteChapter(ID),
  adminCreateContent: (c) => c.adminCreateContent(ID, { kind: "text", title: "I" }),
  adminUpdateContent: (c) => c.adminUpdateContent(ID, { kind: "text", title: "I" }),
  adminDeleteContent: (c) => c.adminDeleteContent(ID),
  adminReorderStructure: (c) => c.adminReorderStructure("adhs", { modules: [] }),
  adminReplaceExperts: (c) => c.adminReplaceExperts("adhs", { experts: [] }),
  adminGetQuiz: (c) => c.adminGetQuiz(ID),
  adminSetQuiz: (c) => c.adminSetQuiz(ID, { questions: [] }),
  // P183: the two halves of the delivery address, learner and operator. Both
  // verbs matter — a PUT sent as POST is the defect this whole file exists for.
  deliveryEmail: (c) => c.deliveryEmail("adhs"),
  setDeliveryEmail: (c) => c.setDeliveryEmail("adhs", "a@b.de"),
  adminReadDeliveryEmail: (c) => c.adminReadDeliveryEmail("e1"),
  adminSetDeliveryEmail: (c) => c.adminSetDeliveryEmail("e1", "a@b.de"),
  adminGetEvaluation: (c) => c.adminGetEvaluation("adhs"),
  adminSetEvaluation: (c) => c.adminSetEvaluation("adhs", { questions: [] }),
};

describe("every request the client makes is in the contract", () => {
  for (const [name, invoke] of Object.entries(INVOKE)) {
    it(`${name} uses the path and verb the contract declares`, async () => {
      await Promise.resolve(invoke(client())).catch(() => undefined);

      expect(calls.length, `${name} made no request`).toBeGreaterThan(0);

      for (const call of calls) {
        const templates = templatesFor(call.path);
        expect(templates, `no contract path matches ${call.path}`).not.toHaveLength(0);

        const verbs = templates.flatMap((t) =>
          Object.keys(contract.paths[t] ?? {}).map((v) => v.toUpperCase()),
        );
        // The assertion that would have caught `enrol`: the path existed, the
        // verb did not.
        expect(
          verbs,
          `${call.method} ${call.path} — the contract offers ${verbs.join(", ")}`,
        ).toContain(call.method);
      }
    });
  }
});

describe("the check stays total", () => {
  it("covers every method on the client", () => {
    const surface = Object.keys(client()).filter(
      (key) =>
        // Builds a URL for an <img>/@font-face; issues no request of its own.
        key !== "brandingFontUrl" &&
        // The transport primitives every method above already exercises.
        key !== "request" &&
        key !== "requestBlob",
    );

    expect([...surface].sort()).toEqual([...Object.keys(INVOKE)].sort());
  });
});
