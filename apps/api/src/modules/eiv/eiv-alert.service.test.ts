/**
 * The alarm that has to work when everything else does not.
 *
 * The properties here are all about failure modes of the alarm itself, because
 * the thing it watches is already known to fail — that is why it exists.
 */

import { describe, expect, it, vi } from "vitest";
import type { EivAlert } from "@ds/domain";
import type { AuditEntry, AuditServicePort } from "../../audit/audit.service.js";
import {
  EivAlertService,
  EIV_ALERT_ACTION,
  type AlertSink,
  type EivAlertRepositoryPort,
  type PendingSubmission,
} from "./eiv-alert.service.js";

const NOW = new Date("2026-07-28T10:00:00Z");
const CUSTOMER = "22222222-0000-4000-8000-000000000001";

/**
 * A row whose **deadline** falls roughly `hoursUntilDue` from `NOW`.
 *
 * The fixture supplies an `eventEndAt` and lets the service derive the
 * deadline, because that is what it now does (P58-02) — it used to be handed a
 * `reportDueAt` and trust it, which is how the alerter and the submission sweep
 * came to hold two different answers about one statutory date.
 *
 * The deadline lands at the end of the Berlin day eight days after the event,
 * so "48 hours out" is really "the end of the day two days from now". Each
 * case below is placed comfortably inside its band rather than on the boundary;
 * the boundary itself is `eiv-alert.test.ts`'s job, against the pure rule.
 */
function submission(
  enrolmentId: string,
  hoursUntilDue: number,
  status = "queued",
): PendingSubmission {
  const REPORTING_WINDOW_MS = 8 * 24 * 3_600_000;
  return {
    enrolmentId,
    customerId: CUSTOMER,
    eventEndAt: new Date(NOW.getTime() + hoursUntilDue * 3_600_000 - REPORTING_WINDOW_MS),
    status,
    attemptCount: 3,
  };
}

function build(options: {
  pending?: PendingSubmission[];
  alerted?: Map<string, ("blocked" | "warning" | "urgent" | "overdue")[]>;
  sink?: AlertSink;
}) {
  const audited: Array<{ customerId: string; entry: AuditEntry }> = [];
  const logs: string[] = [];

  const repository: EivAlertRepositoryPort = {
    findUnreported: async () => options.pending ?? [],
    findAlertedLevels: async () => options.alerted ?? new Map(),
  };

  const audit: AuditServicePort = {
    recordForCustomer: async (customerId, entry) => {
      audited.push({ customerId, entry });
    },
    recordSystem: async () => {},
  };

  const service = new EivAlertService(
    repository,
    audit,
    {
      error: (message) => logs.push(`error: ${message}`),
      warn: (message) => logs.push(`warn: ${message}`),
    },
    options.sink,
  );

  return { service, audited, logs };
}

describe("what gets raised", () => {
  it("stays quiet while a submission has days to run", async () => {
    const { service, audited, logs } = build({ pending: [submission("e1", 120)] });

    expect(await service.sweep(NOW)).toEqual([]);
    expect(audited).toEqual([]);
    expect(logs).toEqual([]);
  });

  it("raises a warning at two days out, with no personal data in it", async () => {
    // The destination is a webhook, which in practice is a chat room with an
    // unknown membership. ADR-0004 does not stop applying because the channel
    // is convenient.
    const sent: unknown[] = [];
    const { service, audited } = build({
      pending: [submission("e1", 30)],
      sink: { send: async (alert) => void sent.push(alert) },
    });

    const raised = await service.sweep(NOW);

    expect(raised.map((a) => a.level)).toEqual(["warning"]);
    expect(audited[0]?.entry.action).toBe(EIV_ALERT_ACTION);

    const payload = JSON.stringify(sent);
    expect(payload).not.toMatch(/\d{15}/); // no EFN-shaped value
    expect(payload).toContain("e1");
  });

  it("follows the event, not a stored deadline that disagrees with it", async () => {
    /*
     * P58-02, and the case QA produced by hand: `report_due_at` said yesterday
     * while `event_end_at` said the window had a week to run. The alerter
     * raised `overdue, -24h` in the same sweep in which the submission worker
     * — recomputing from the event — submitted the row perfectly correctly.
     *
     * There is now one input and one rule. The fixture cannot even express the
     * disagreement any more, which is the point: `PendingSubmission` carries
     * the event, and a stored deadline is not something this service can be
     * handed.
     */
    const { service } = build({
      pending: [submission("e1", 24 * 7, "queued")],
    });

    const raised = await service.sweep(NOW);

    // A week of window left: nothing to say, however a column might read.
    expect(raised).toEqual([]);
  });

  it("still reports a deadline already missed", async () => {
    // Nothing can be done — the reporting window is closed. The alert is the
    // record that it happened, and the record is what stops it being found
    // months later by the physician.
    //
    // Two levels, not one, since P33-01: `failed_permanent` also means the
    // worker has stopped. On this row they arrive together because it was
    // never alerted while it was alive; the point of `blocked` is the row
    // where they do not.
    const { service } = build({ pending: [submission("e1", -20, "failed_permanent")] });

    const raised = await service.sweep(NOW);

    expect(raised.map((alert) => alert.level)).toEqual(["blocked", "overdue"]);
    // Negative, not a specific figure: the deadline is the end of a Berlin day
    // (P58-02), so the exact hour count is a property of that rounding and is
    // asserted against the pure rule in `eiv-alert.test.ts`. What this case is
    // about is that a passed deadline is still reported.
    expect(raised[0]?.hoursRemaining).toBeLessThan(0);
  });

  it("wakes somebody the moment the worker gives up, not six days later", async () => {
    // The gap P33-01 closed. A submission abandoned on day one —
    // `missing_vnr_password`, a 406, a misconfigured endpoint — will not retry
    // itself, and under the clock rule alone said nothing until 48 hours
    // remained. Six days of an eight-day statutory window, silent, on a row
    // that a person had to touch.
    const { service, logs } = build({
      pending: [submission("e1", 190, "failed_permanent")],
    });

    const raised = await service.sweep(NOW);

    expect(raised.map((alert) => alert.level)).toEqual(["blocked"]);
    // Days from the deadline, which is the whole point: `blocked` does not
    // wait for the clock. The figure is not asserted to the hour — see the
    // note in the case above.
    expect(raised[0]?.hoursRemaining).toBeGreaterThan(48);
    // "EIV deadline blocked" would read as a deadline that is blocked. The two
    // alarms mean different things and the first words decide which one
    // somebody at 03:00 thinks they are looking at.
    expect(logs[0]).toContain("EIV submission stopped");
  });

  it("leaves a submission the worker is still retrying to the clock", async () => {
    // Same deadline, same distance, still moving. Alerting here would be an
    // alert on every queued row in the window, which is the noise that gets a
    // channel muted.
    const { service } = build({ pending: [submission("e1", 190, "failed_retryable")] });

    expect(await service.sweep(NOW)).toEqual([]);
  });

  it("ignores a submission that has already been reported", async () => {
    // `findUnreported` excludes `submitted`; this asserts the service does not
    // reintroduce it by looking at the deadline alone.
    const { service } = build({ pending: [] });
    expect(await service.sweep(NOW)).toEqual([]);
  });
});

describe("escalation, not repetition", () => {
  it("does not re-raise a level already recorded in the audit log", async () => {
    const { service, audited } = build({
      pending: [submission("e1", 30)],
      alerted: new Map([["e1", ["warning"]]]),
    });

    expect(await service.sweep(NOW)).toEqual([]);
    expect(audited).toEqual([]);
  });

  it("raises the higher level when time runs on", async () => {
    const { service } = build({
      pending: [submission("e1", 6)],
      alerted: new Map([["e1", ["warning"]]]),
    });

    const raised = await service.sweep(NOW);
    expect(raised[0]?.level).toBe("urgent");
  });

  it("writes the audit row before sending, so a crash cannot cause a loop", async () => {
    // If the process dies between the two, a duplicate alert is a nuisance. A
    // missing audit row would replay the same level on every sweep for the
    // rest of the window, which is how an alert channel gets muted.
    const order: string[] = [];

    const service = new EivAlertService(
      {
        findUnreported: async () => [submission("e1", 6)],
        findAlertedLevels: async () => new Map(),
      },
      {
        recordForCustomer: async () => void order.push("audited"),
        recordSystem: async () => {},
      },
      { error: () => {}, warn: () => {} },
      { send: async () => void order.push("sent") },
    );

    await service.sweep(NOW);

    expect(order).toEqual(["audited", "sent"]);
  });
});

describe("the alarm survives its own delivery failing", () => {
  it("logs and continues when the webhook throws", async () => {
    const { service, logs } = build({
      pending: [submission("e1", 6)],
      sink: {
        send: async () => {
          throw new Error("connect ECONNREFUSED");
        },
      },
    });

    const raised = await service.sweep(NOW);

    // The alert still counts as raised: it is in the log and in the audit
    // trail, which is the floor this design guarantees.
    expect(raised).toHaveLength(1);
    expect(logs.some((line) => line.startsWith("warn: EIV alert webhook failed"))).toBe(
      true,
    );
    expect(logs.some((line) => line.startsWith("error: EIV deadline urgent"))).toBe(true);
  });

  it("works with no webhook configured at all", async () => {
    const { service, logs, audited } = build({ pending: [submission("e1", 6)] });

    expect(await service.sweep(NOW)).toHaveLength(1);
    expect(audited).toHaveLength(1);
    expect(logs.some((line) => line.includes("EIV deadline urgent"))).toBe(true);
  });

  it("keeps going through a batch rather than stopping at the first", async () => {
    const failing = vi.fn(async (alert: EivAlert) => {
      if (alert.enrolmentId === "e1") throw new Error("boom");
    });

    const { service } = build({
      pending: [submission("e1", 6), submission("e2", 6), submission("e3", 30)],
      sink: { send: failing as AlertSink["send"] },
    });

    const raised = await service.sweep(NOW);

    expect(raised.map((a) => a.enrolmentId)).toEqual(["e1", "e2", "e3"]);
    expect(failing).toHaveBeenCalledTimes(3);
  });
});
