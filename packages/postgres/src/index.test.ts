/**
 * That an idle-connection failure is survivable.
 *
 * No database is needed and that is the point: the hazard is a Node
 * `EventEmitter` rule, not a Postgres one. An `'error'` event with no listener
 * is re-thrown as an uncaught exception, so the whole defect is observable by
 * emitting the event that a dying socket would emit.
 *
 * The first test is the control — it asserts the *unprotected* behaviour is
 * genuinely fatal. Without it the rest of this file would pass just as happily
 * against a `createPool` that did nothing at all (CLAUDE.md §9.1).
 */

import pg from "pg";
import { describe, expect, it, vi } from "vitest";
import { attachClientErrorHandler, attachIdleErrorHandler, createPool } from "./index.js";

const URL = "postgres://nobody@127.0.0.1:1/nothing";

/** Never connected, so nothing here opens a socket. */
function bareOptions() {
  return { connectionString: URL };
}

describe("the hazard this package exists for", () => {
  it("is real: an unguarded pool re-throws an idle-connection failure", () => {
    // eslint-disable-next-line no-restricted-syntax -- demonstrating the behaviour the rule forbids
    const pool = new pg.Pool(bareOptions());
    expect(() => pool.emit("error", new Error("terminating connection"))).toThrow(
      "terminating connection",
    );
  });

  it("is real for a bare client too", () => {
    const client = new pg.Client(bareOptions());
    expect(() => client.emit("error", new Error("terminating connection"))).toThrow(
      "terminating connection",
    );
  });
});

describe("createPool", () => {
  it("survives the connection failure that would otherwise end the process", () => {
    const pool = createPool(bareOptions());
    expect(() =>
      pool.emit(
        "error",
        new Error("terminating connection due to administrator command"),
      ),
    ).not.toThrow();
  });

  it("reports the failure, so a database restart is visible rather than silent", () => {
    const onIdleError = vi.fn();
    const pool = createPool({ ...bareOptions(), onIdleError });

    const failure = new Error("terminating connection due to administrator command");
    pool.emit("error", failure);

    expect(onIdleError).toHaveBeenCalledOnce();
    expect(onIdleError).toHaveBeenCalledWith(failure);
  });

  it("needs no reporter — a one-shot tool has nowhere useful to write", () => {
    const pool = createPool(bareOptions());
    expect(() => pool.emit("error", new Error("boom"))).not.toThrow();
  });

  it("keeps surviving: the handler is not a one-shot", () => {
    // A failover can take several pooled connections down in a row, and a
    // `once` here would leave the second one fatal — which would be the harder
    // bug of the two, because it would only appear under a real outage.
    const onIdleError = vi.fn();
    const pool = createPool({ ...bareOptions(), onIdleError });

    for (let i = 0; i < 3; i += 1) {
      expect(() => pool.emit("error", new Error(`failure ${String(i)}`))).not.toThrow();
    }
    expect(onIdleError).toHaveBeenCalledTimes(3);
  });
});

describe("attachIdleErrorHandler", () => {
  it("arms a pool somebody else constructed", () => {
    // apps/api builds its own pool with settings the factory does not model.
    const onIdleError = vi.fn();
    // eslint-disable-next-line no-restricted-syntax -- the case this helper exists for
    const pool = new pg.Pool(bareOptions());
    attachIdleErrorHandler(pool, onIdleError);

    expect(() => pool.emit("error", new Error("boom"))).not.toThrow();
    expect(onIdleError).toHaveBeenCalledOnce();
  });
});

describe("attachClientErrorHandler", () => {
  it("arms a standalone client", () => {
    // The migrator's helpers open clients in order to drop databases out from
    // under other connections — the case that produced the original report.
    const onError = vi.fn();
    const client = new pg.Client(bareOptions());
    attachClientErrorHandler(client, onError);

    expect(() => client.emit("error", new Error("boom"))).not.toThrow();
    expect(onError).toHaveBeenCalledOnce();
  });
});
