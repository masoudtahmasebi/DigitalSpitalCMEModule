/**
 * The logger, the correlation context and the metrics.
 *
 * `redact.test.ts` covers what must never be written. This covers the parts
 * that decide whether a log is *usable*: that one id spans a whole request,
 * that a line is one parseable object, and that a metrics endpoint cannot grow
 * without bound.
 */

import { describe, expect, it } from "vitest";
import {
  correlationIdFrom,
  currentCorrelationId,
  describeActor,
  runWithContext,
} from "./correlation.js";
import { JsonLogger, levelFrom } from "./logger.js";
import { Metrics } from "./metrics.js";

/** A logger that keeps its lines instead of writing them. */
function capture(level: Parameters<typeof JsonLogger.prototype.write_>[0] = "info") {
  const lines: Record<string, unknown>[] = [];
  const logger = new JsonLogger(level === "info" ? "info" : level, (line) => {
    lines.push(JSON.parse(line) as Record<string, unknown>);
  });
  return { logger, lines };
}

describe("the correlation id", () => {
  it("accepts an id the caller supplied, so a trace spans two services", () => {
    // What makes a WordPress request and the API request it caused one trace.
    expect(correlationIdFrom("wp-req-0123456789")).toBe("wp-req-0123456789");
  });

  it("replaces an id carrying a newline, which would forge a log line", () => {
    // Log injection: the whole reason an inbound value is never used raw.
    const forged = 'x\n{"level":"info","msg":"nothing to see"}';
    expect(correlationIdFrom(forged)).not.toContain("\n");
    expect(correlationIdFrom(forged)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("replaces one long enough to be a denial of service", () => {
    expect(correlationIdFrom("a".repeat(50_000))).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("replaces one too short to be an id", () => {
    expect(correlationIdFrom("abc")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("mints one when the header appeared twice and is therefore ambiguous", () => {
    expect(correlationIdFrom(["a-valid-id-here", "another-valid-id"])).toMatch(
      /^[0-9a-f-]{36}$/,
    );
  });

  it("survives an await, which is the whole point of AsyncLocalStorage", async () => {
    // Threading a context parameter would be dropped inside exactly one place:
    // a `catch`, which is where it is needed.
    await runWithContext({ correlationId: "trace-abc-123" }, async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      await Promise.resolve();
      expect(currentCorrelationId()).toBe("trace-abc-123");
    });
  });

  it("is undefined outside a request rather than fabricated", () => {
    // The EIV worker and the boot sequence log without one, legitimately.
    expect(currentCorrelationId()).toBeUndefined();
  });

  it("keeps the same id after the actor is known", () => {
    // If authenticating opened a new scope, every line before the guard would
    // carry a different id from every line after it — which is precisely the
    // join this exists to make.
    runWithContext({ correlationId: "one-id-throughout" }, () => {
      describeActor({ customerId: "cust-1", actorKind: "learner" });
      expect(currentCorrelationId()).toBe("one-id-throughout");
    });
  });
});

describe("the log line", () => {
  it("is one JSON object per line", () => {
    const { logger, lines } = capture();
    logger.write_("info", "request", { status: 200 });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: "info", msg: "request", status: 200 });
    expect(lines[0]?.["at"]).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("carries the request's id and tenant without being told", () => {
    const { logger, lines } = capture();

    runWithContext({ correlationId: "abc-123-def-456" }, () => {
      describeActor({ customerId: "cust-9", actorKind: "staff" });
      logger.write_("warn", "something", {});
    });

    expect(lines[0]).toMatchObject({
      correlationId: "abc-123-def-456",
      customerId: "cust-9",
      actorKind: "staff",
    });
  });

  it("redacts fields a caller passed without thinking", () => {
    // The realistic failure: somebody logs the thing they were handed.
    const { logger, lines } = capture();
    logger.write_("error", "enrolment failed", {
      efn: "123456789012345",
      email: "arzt@praxis.de",
      courseSlug: "adhs-akademie-adult",
    });

    const line = JSON.stringify(lines[0]);
    expect(line).not.toContain("123456789012345");
    expect(line).not.toContain("praxis.de");
    expect(line).toContain("adhs-akademie-adult");
  });

  it("redacts a message Nest itself wrote", () => {
    // Framework messages go through the same stream and the same redaction.
    const { logger, lines } = capture();
    logger.error("token rejected for arzt@praxis.de", "AuthGuard");

    expect(JSON.stringify(lines[0])).not.toContain("praxis.de");
    expect(lines[0]?.["source"]).toBe("AuthGuard");
  });

  it("honours the threshold", () => {
    const { logger, lines } = capture("warn");
    logger.write_("debug", "noisy", {});
    logger.write_("info", "also noisy", {});
    logger.write_("error", "this one matters", {});

    expect(lines.map((line) => line["msg"])).toEqual(["this one matters"]);
  });

  it("never throws on a value that will not serialise", () => {
    // A logger that can throw turns a handled error into an unhandled one, at
    // the exact moment somebody is trying to find out what went wrong.
    const { logger, lines } = capture();
    const cyclic: Record<string, unknown> = {};
    cyclic["self"] = cyclic;

    expect(() => logger.write_("error", "failed", { cyclic })).not.toThrow();
    expect(lines).toHaveLength(1);
  });

  it("falls back to info for a level nobody recognises", () => {
    expect(levelFrom("verbose")).toBe("info");
    expect(levelFrom(undefined)).toBe("info");
    expect(levelFrom(" DEBUG ")).toBe("debug");
  });
});

describe("metrics", () => {
  it("counts by status class, not by exact code", () => {
    const metrics = new Metrics();
    metrics.observeRequest("GET", "/courses", 200, 12);
    metrics.observeRequest("GET", "/courses", 204, 8);
    metrics.observeRequest("GET", "/courses", 404, 3);

    const out = metrics.render();
    expect(out).toContain(
      'ds_http_requests_total{method="GET",route="/courses",status="2xx"} 2',
    );
    expect(out).toContain(
      'ds_http_requests_total{method="GET",route="/courses",status="4xx"} 1',
    );
  });

  it("emits cumulative histogram buckets, as the format requires", () => {
    // A bucket counts everything at or below `le`, not what falls between two
    // edges. Getting this wrong produces a chart that looks plausible and is
    // wrong at every quantile.
    const metrics = new Metrics();
    metrics.observeRequest("GET", "/x", 200, 30); // 0.03s

    const out = metrics.render();
    expect(out).toContain('le="0.025"} 0');
    expect(out).toContain('le="0.05"} 1');
    expect(out).toContain('le="10"} 1');
    expect(out).toContain('le="+Inf"} 1');
  });

  it("records the sum and count a rate() needs", () => {
    const metrics = new Metrics();
    metrics.observeRequest("GET", "/x", 200, 500);
    metrics.observeRequest("GET", "/x", 200, 1500);

    const out = metrics.render();
    expect(out).toContain(
      'ds_http_request_duration_seconds_sum{method="GET",route="/x",status="2xx"} 2.000000',
    );
    expect(out).toContain(
      'ds_http_request_duration_seconds_count{method="GET",route="/x",status="2xx"} 2',
    );
  });

  it("collapses a path carrying an id, rather than leaking one series per course", () => {
    // The label a raw path would produce is a memory leak with extra steps, in
    // a process that never restarts.
    const metrics = new Metrics();
    metrics.observeRequest(
      "GET",
      "/courses/0198f4c1-7a2e-7000-8000-000000000001",
      200,
      5,
    );

    expect(metrics.render()).toContain('route="other"');
  });

  it("counts named outcomes, which is what a compliance alert watches", () => {
    const metrics = new Metrics();
    metrics.count("eiv_submissions", "accepted");
    metrics.count("eiv_submissions", "accepted");
    metrics.count("eiv_submissions", "failed");

    const out = metrics.render();
    expect(out).toContain('ds_eiv_submissions_total{outcome="accepted"} 2');
    expect(out).toContain('ds_eiv_submissions_total{outcome="failed"} 1');
  });

  it("escapes a label value rather than emitting something unparseable", () => {
    const metrics = new Metrics();
    metrics.count("thing", 'quote"and\\backslash');

    expect(metrics.render()).toContain('outcome="quote\\"and\\\\backslash"');
  });

  it("reports whether its own cardinality bound was hit", () => {
    const metrics = new Metrics();
    expect(metrics.render()).toContain("ds_metrics_series_overflow 0");

    for (let index = 0; index < 1100; index += 1) {
      metrics.observeRequest("GET", `/route-${index}`, 200, 1);
    }

    // Degrades rather than growing without limit — a metrics endpoint that
    // OOMs the API is worse than no metrics.
    expect(metrics.render()).toContain("ds_metrics_series_overflow 1");
  });

  it("starts empty and still renders valid output", () => {
    expect(new Metrics().render()).toContain("# TYPE ds_http_requests_total counter");
  });

  it("names the commit it was built from (P42-03)", () => {
    const was = process.env["DS_COMMIT"];
    process.env["DS_COMMIT"] = "a1b2c3d";
    try {
      expect(new Metrics().render()).toContain('ds_build_info{commit="a1b2c3d"} 1');
    } finally {
      if (was === undefined) delete process.env["DS_COMMIT"];
      else process.env["DS_COMMIT"] = was;
    }
  });

  it("says 'unknown' rather than omitting the series when unset", () => {
    // A missing series and a series saying `unknown` look the same on a graph
    // and are not the same thing: the second says the process was asked and
    // did not know, which is the case on a locally-run image.
    const was = process.env["DS_COMMIT"];
    delete process.env["DS_COMMIT"];
    try {
      expect(new Metrics().render()).toContain('ds_build_info{commit="unknown"} 1');
    } finally {
      if (was !== undefined) process.env["DS_COMMIT"] = was;
    }
  });
});
