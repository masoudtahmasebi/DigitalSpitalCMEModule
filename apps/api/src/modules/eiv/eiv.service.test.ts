import { describe, expect, it } from "vitest";
import { EivError, EIV_PASSWORD_KEY } from "@ds/eiv-client";
import type { ParticipationReport } from "@ds/plugin-api";
import { EivService, type EivSubmitterPort } from "./eiv.service.js";
import type {
  ClaimedSubmission,
  DueSubmission,
  EivRepositoryPort,
} from "./eiv.repository.js";
import type { AuditEntry, AuditServicePort } from "../../audit/audit.service.js";

const NOW = new Date("2026-07-01T12:00:00Z");
const EFN = "123456789012345";
const VNR_PASSWORD = "super-secret-vnr-password";

const base: DueSubmission = {
  id: "11111111-0000-4000-8000-000000000001",
  customerId: "22222222-0000-4000-8000-000000000001",
  enrolmentId: "33333333-0000-4000-8000-000000000001",
  vnr: "9999999999999999999",
  efn: EFN,
  status: "queued",
  attemptCount: 0,
  eventEndAt: NOW,
  firstSubmittedAt: null,
  nextAttemptAt: null,
  lastError: null,
  vnrPassword: VNR_PASSWORD,
};

function build(
  rows: DueSubmission[],
  submitter: Partial<EivSubmitterPort> = {},
  options: { allowLive?: boolean; baseUrl?: string } = {},
) {
  const successes: Array<Record<string, unknown>> = [];
  const retries: Array<Record<string, unknown>> = [];
  const failures: Array<Record<string, unknown>> = [];
  const audits: Array<{ customerId: string; entry: AuditEntry }> = [];

  const claimOf = (row: DueSubmission): ClaimedSubmission => ({
    submissionId: row.id,
    customerId: row.customerId,
  });

  const repository: EivRepositoryPort = {
    claimDue: async () => rows.map(claimOf),
    load: async (claim) => rows.find((row) => row.id === claim.submissionId),
    recordSuccess: async (input) => {
      successes.push({ ...input });
    },
    recordRetry: async (input) => {
      retries.push({ ...input });
    },
    recordPermanentFailure: async (input) => {
      failures.push({ ...input });
    },
  };

  const audit: AuditServicePort = {
    recordForCustomer: async (customerId, entry) => {
      audits.push({ customerId, entry });
    },
    recordSystem: async () => undefined,
  };

  const service = new EivService(
    repository,
    {
      id: "fake",
      report: async () => ({ accepted: true, reference: "EIV-REF-1" }),
      ...submitter,
    },
    audit,
    {
      baseUrl: options.baseUrl ?? "http://127.0.0.1:4010",
      batchSize: 25,
      allowLive: options.allowLive ?? false,
      leaseSeconds: 120,
    },
  );

  return { service, successes, retries, failures, audits };
}

describe("a successful submission", () => {
  it("records the reference and marks it submitted", async () => {
    const { service, successes } = build([base]);

    const result = await service.sweep(NOW);

    expect(result.submitted).toBe(1);
    expect(successes[0]?.["reference"]).toBe("EIV-REF-1");
    expect(successes[0]?.["attemptCount"]).toBe(1);
  });

  it("stamps the correction window from the first submission", async () => {
    const { service, successes } = build([base]);

    await service.sweep(NOW);

    expect(successes[0]?.["firstSubmittedAt"]).toEqual(NOW);
    expect(successes[0]?.["correctionWindowEndsAt"]).toBeUndefined();
  });

  it("audits the submission without the EFN or the password", async () => {
    // CLAUDE.md §4 invariants 7 and 8: every attempt is audited, and neither
    // the EFN nor the VNR password may appear in that trail.
    const { service, audits } = build([base]);

    await service.sweep(NOW);

    const entry = audits.find((a) => a.entry.action === "eiv.submitted");
    expect(entry).toBeDefined();

    const serialised = JSON.stringify(entry);
    expect(serialised).not.toContain(EFN);
    expect(serialised).not.toContain(VNR_PASSWORD);
  });

  it("passes the credentials to the reporter but never returns them", async () => {
    let seen: ParticipationReport | undefined;
    const { service } = build([base], {
      report: async (input) => {
        seen = input;
        return { accepted: true };
      },
    });

    const result = await service.sweep(NOW);

    expect(seen?.efn).toBe(EFN);
    // Under `credentials`, opaque to the platform and named by the reporter —
    // `EIV_PASSWORD_KEY`, so the two sides cannot drift.
    expect(seen?.credentials[EIV_PASSWORD_KEY]).toBe(VNR_PASSWORD);
    expect(seen?.endpoint).toBeTruthy();

    // The point of the test: the secret reaches the transport and nothing else.
    expect(JSON.stringify(result)).not.toContain(VNR_PASSWORD);
  });
});

describe("a retryable failure", () => {
  const transportFailure = {
    report: async () => {
      throw new EivError("transport", "connection refused");
    },
  };

  it("schedules the next attempt 10 minutes out", async () => {
    const { service, retries } = build([base], transportFailure);

    const result = await service.sweep(NOW);

    expect(result.retrying).toBe(1);
    expect(retries[0]?.["attemptCount"]).toBe(1);
    expect(retries[0]?.["nextAttemptAt"]).toEqual(new Date(NOW.getTime() + 10 * 60_000));
  });

  it("stores the failure kind, never the exchange body", async () => {
    const { service, retries } = build([base], transportFailure);

    await service.sweep(NOW);

    expect(retries[0]?.["failure"]).toBe("transport");
    expect(JSON.stringify(retries[0])).not.toContain(EFN);
  });

  it("gives up after the fourth attempt and alerts", async () => {
    const { service, failures, audits } = build(
      [{ ...base, attemptCount: 3, lastError: "transport" }],
      transportFailure,
    );

    const result = await service.sweep(NOW);

    expect(result.abandoned).toBe(1);
    expect(failures[0]?.["reason"]).toBe("attempts_exhausted");
    expect(audits.some((a) => a.entry.action === "eiv.abandoned")).toBe(true);
  });
});

describe("a permanent rejection is not retried", () => {
  it("abandons a validation rejection on the first failure", async () => {
    // Retrying an EFN the Ärztekammer does not recognise spends the statutory
    // window to no purpose and hides the problem until it has closed.
    const { service, failures, retries } = build([base], {
      report: async () => {
        throw new EivError("validation", "unknown EFN");
      },
    });

    const result = await service.sweep(NOW);

    expect(result.abandoned).toBe(1);
    expect(retries).toEqual([]);
    expect(failures[0]?.["reason"]).toBe("permanent_rejection");
    expect(failures[0]?.["windowClosed"]).toBe(false);
  });

  it("abandons an auth rejection — the credentials need a human", async () => {
    const { service, failures } = build([base], {
      report: async () => {
        throw new EivError("auth", "VNR credentials rejected");
      },
    });

    await service.sweep(NOW);

    expect(failures[0]?.["reason"]).toBe("permanent_rejection");
  });
});

describe("the statutory windows", () => {
  it("marks a missed reporting window distinctly from a permanent failure", async () => {
    // The admin needs to tell these apart: one means the paper route is now
    // the only option, the other means someone can fix and resend.
    const { service, failures, audits } = build([
      { ...base, eventEndAt: new Date("2026-06-01T12:00:00Z") },
    ]);

    const result = await service.sweep(NOW);

    expect(result.abandoned).toBe(1);
    expect(failures[0]?.["reason"]).toBe("reporting_window_missed");
    expect(failures[0]?.["windowClosed"]).toBe(true);

    const alert = audits.find((a) => a.entry.action === "eiv.abandoned");
    expect(alert?.entry.detail?.["windowClosed"]).toBe(true);
  });

  it("does not submit at all once the window has closed", async () => {
    let called = false;
    const { service } = build(
      [{ ...base, eventEndAt: new Date("2026-06-01T12:00:00Z") }],
      {
        report: async () => {
          called = true;
          return { accepted: true };
        },
      },
    );

    await service.sweep(NOW);

    expect(called).toBe(false);
  });
});

describe("scheduling is the claim query's job, not the service's", () => {
  it("submits anything handed to it — deferral happened before it was claimed", async () => {
    // `claim_due_eiv_submissions` filters on `next_attempt_at <= now` and
    // leases what it returns, so a row reaching the service is due by
    // definition. Keeping the interval check here as well would be a second
    // implementation of the same rule, and the two would drift.
    const { service, successes } = build([
      { ...base, attemptCount: 1, lastError: "transport" },
    ]);

    const result = await service.sweep(NOW);

    expect(result.submitted).toBe(1);
    expect(successes[0]?.["attemptCount"]).toBe(2);
  });
});

describe("configuration guards", () => {
  it("refuses to submit to a non-local endpoint without explicit permission", async () => {
    // Submitting test data to the real Ärztekammer is not an error you can
    // take back, so the default is refusal.
    let called = false;
    const { service, failures } = build(
      [base],
      {
        report: async () => {
          called = true;
          return { accepted: true };
        },
      },
      { baseUrl: "https://punktemeldung.eiv-fobi.de/", allowLive: false },
    );

    await service.sweep(NOW);

    expect(called).toBe(false);
    expect(failures[0]?.["reason"]).toBe("live_submission_not_allowed");
  });

  it("submits to a live endpoint when explicitly allowed", async () => {
    const { service, successes } = build(
      [base],
      {},
      { baseUrl: "https://punktemeldung.eiv-fobi.de/", allowLive: true },
    );

    await service.sweep(NOW);

    expect(successes).toHaveLength(1);
  });

  it("abandons rather than burning the budget when the VNR password is missing", async () => {
    const { service, failures } = build([{ ...base, vnrPassword: null }]);

    await service.sweep(NOW);

    expect(failures[0]?.["reason"]).toBe("missing_vnr_password");
    // Not a closed window — an admin can fix this and it will go through.
    expect(failures[0]?.["windowClosed"]).toBe(false);
  });
});

describe("sweeping a batch", () => {
  it("reports a tally across mixed outcomes", async () => {
    let call = 0;
    const { service } = build(
      [
        { ...base, id: "a" },
        { ...base, id: "b" },
        { ...base, id: "c", eventEndAt: new Date("2026-06-01T12:00:00Z") },
      ],
      {
        report: async () => {
          call += 1;
          if (call === 2) throw new EivError("transport", "flaky");
          return { accepted: true, reference: "ref" };
        },
      },
    );

    const result = await service.sweep(NOW);

    expect(result).toEqual({
      considered: 3,
      submitted: 1,
      retrying: 1,
      abandoned: 1,
      waiting: 0,
    });
  });

  it("does not let one row's failure stop the rest of the sweep", async () => {
    const { service, successes } = build(
      [
        { ...base, id: "a" },
        { ...base, id: "b" },
      ],
      {
        report: async (input) => {
          if (input.efn === EFN && successes.length === 0) {
            return { accepted: true, reference: "first" };
          }
          throw new EivError("transport", "second one fails");
        },
      },
    );

    const result = await service.sweep(NOW);

    expect(result.considered).toBe(2);
    expect(result.submitted + result.retrying).toBe(2);
  });
});
