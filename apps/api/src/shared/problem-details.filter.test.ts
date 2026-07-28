/**
 * What leaves the API when something goes wrong.
 *
 * Two properties, and both are about disclosure rather than about errors:
 *
 * 1. The internal reason never reaches the client. It is written by us, it
 *    names ids, slugs and constraints, and it is the single most useful thing
 *    an attacker can be handed.
 * 2. **The query string never reaches a log or a response.** No route puts a
 *    secret in one today — but `certificates.download_token` is already in the
 *    schema for the emailed certificate, and the first link that carries one
 *    would put it in every log line that route ever fails on. These assertions
 *    are what stop that link introducing the leak.
 */

import { describe, expect, it, vi } from "vitest";
import type { ArgumentsHost } from "@nestjs/common";
import { HttpException, HttpStatus, Logger } from "@nestjs/common";
import { ProblemDetailsFilter } from "./problem-details.filter.js";
import { AppError } from "./problem-details.js";

interface Captured {
  status: number;
  body: Record<string, unknown>;
}

function hostFor(url: string, method = "GET"): { host: ArgumentsHost; sent: Captured } {
  const sent: Captured = { status: 0, body: {} };

  const response = {
    status(code: number) {
      sent.status = code;
      return this;
    },
    json(body: Record<string, unknown>) {
      sent.body = body;
    },
  };

  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({ originalUrl: url, method }),
    }),
  } as unknown as ArgumentsHost;

  return { host, sent };
}

/** Everything the filter wrote to the logger, as one string. */
function captureLogs(run: () => void): string {
  const lines: string[] = [];
  const spies = (["warn", "error", "log"] as const).map((level) =>
    vi.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    }),
  );

  try {
    run();
  } finally {
    for (const spy of spies) spy.mockRestore();
  }

  return lines.join("\n");
}

const filter = new ProblemDetailsFilter();

describe("the query string is not disclosed", () => {
  const TOKEN = "d2f0c9a1b3e54f6789ab0cd1e2f34567";

  it("keeps a download token out of the log line", () => {
    const { host } = hostFor(`/courses/adhs/certificate/pdf?token=${TOKEN}`);

    const logged = captureLogs(() => {
      filter.catch(AppError.notFound("certificate not issued"), host);
    });

    expect(logged).not.toContain(TOKEN);
    // The route is still there — this is minimisation, not blinding.
    expect(logged).toContain("/courses/adhs/certificate/pdf");
  });

  it("keeps it out of the response's instance too", () => {
    const { host, sent } = hostFor(`/courses/adhs/certificate/pdf?token=${TOKEN}`);

    captureLogs(() => filter.catch(AppError.notFound("nope"), host));

    expect(sent.body["instance"]).toBe("/courses/adhs/certificate/pdf");
  });

  it("does the same for an unexpected failure and a framework exception", () => {
    for (const thrown of [
      new Error("boom"),
      new HttpException("bad param", HttpStatus.BAD_REQUEST),
    ]) {
      const { host, sent } = hostFor(`/branding/font?project=p&secret=${TOKEN}`);
      const logged = captureLogs(() => filter.catch(thrown, host));

      expect(logged).not.toContain(TOKEN);
      expect(sent.body["instance"]).toBe("/branding/font");
    }
  });

  it("bounds how much of a path it will log", () => {
    // A kilobyte of path is somebody probing, not somebody browsing; without a
    // bound the caller chooses how much of our log file they fill.
    const { host } = hostFor(`/courses/${"a".repeat(5000)}`);
    const logged = captureLogs(() => filter.catch(AppError.notFound("x"), host));

    expect(logged.length).toBeLessThan(500);
  });
});

describe("the internal reason stays internal", () => {
  it("logs it and does not send it", () => {
    const { host, sent } = hostFor("/courses/adhs/enrolment", "POST");
    const error = new AppError(
      "conflict",
      "enrolment 9f1c… already completed at 2026-07-01",
      "Diese Teilnahme ist bereits abgeschlossen.",
    );

    const logged = captureLogs(() => filter.catch(error, host));

    expect(logged).toContain("already completed");
    expect(JSON.stringify(sent.body)).not.toContain("already completed");
    expect(sent.body["detail"]).toBe("Diese Teilnahme ist bereits abgeschlossen.");
  });

  it("sends nothing but a correlation id for an unexpected error", () => {
    const { host, sent } = hostFor("/courses");

    captureLogs(() =>
      filter.catch(new Error("connect ECONNREFUSED 10.0.0.5:5432"), host),
    );

    expect(sent.status).toBe(500);
    expect(JSON.stringify(sent.body)).not.toContain("ECONNREFUSED");
    expect(JSON.stringify(sent.body)).not.toContain("10.0.0.5");
    expect(typeof sent.body["correlationId"]).toBe("string");
  });

  it("quotes the same correlation id it logged", () => {
    // The whole point of the id: a physician can report a failure and support
    // can find it without the response having carried anything sensitive.
    const { host, sent } = hostFor("/courses");
    const logged = captureLogs(() => filter.catch(new Error("boom"), host));

    expect(logged).toContain(String(sent.body["correlationId"]));
  });
});
