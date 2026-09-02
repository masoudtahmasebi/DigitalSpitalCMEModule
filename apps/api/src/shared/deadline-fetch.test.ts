/**
 * That a call which never answers ends anyway (P144-01).
 *
 * The control comes first: it asserts that a bare `fetch` against a server that
 * never responds genuinely *does not return*. Without it every test below would
 * pass just as happily against a `withDeadline` that did nothing at all
 * (CLAUDE.md §9.1) — and "fetch has no timeout" being true is the entire
 * premise of the file under test.
 */

import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  CONTROL_DEADLINE_MS,
  RequestDeadlineError,
  TRANSFER_DEADLINE_MS,
  withDeadline,
} from "./deadline-fetch.js";

/** A server that accepts the connection and then says nothing, for ever. */
let server: Server;
let url: string;

beforeAll(async () => {
  server = createServer(() => {
    // Deliberately no response. This is the bucket on the far side of a
    // network the container cannot route to (P70-02).
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  url = `http://127.0.0.1:${String(address.port)}/silent`;
});

afterAll(async () => {
  /*
   * `closeAllConnections` first, and it is not tidiness.
   *
   * The control test above deliberately leaves a request in flight for ever,
   * and `server.close()` waits for open connections — so without this the file
   * passes every assertion and then hangs in teardown, which reads as a broken
   * suite rather than a working one. §9.8's lesson in a different store: state
   * that outlives a test is a failure attributed to the wrong code.
   */
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("the hazard this file exists for", () => {
  it("is real: a bare fetch against a silent server does not return", async () => {
    const settled = vi.fn();
    void fetch(url).then(settled, settled);

    // Generous next to the 100 ms deadlines below, and still nothing.
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(settled).not.toHaveBeenCalled();
  });
});

describe("withDeadline", () => {
  it("gives up, instead of waiting for a server that never answers", async () => {
    await expect(withDeadline(100)(url)).rejects.toThrow(RequestDeadlineError);
  });

  it("names the host and path, and never the query", async () => {
    /*
     * Every storage URL is presigned, so its query carries `X-Amz-Signature`.
     * An error that quoted it would put a live capability into the log, the
     * alert and any response that echoed it (§9.5).
     */
    const signed = `${url}?X-Amz-Signature=deadbeefcafe&X-Amz-Credential=AKIA`;

    await expect(withDeadline(100)(signed)).rejects.toThrow(/127\.0\.0\.1:\d+\/silent/u);
    await expect(withDeadline(100)(signed)).rejects.not.toThrow(/deadbeef|AKIA/u);
  });

  it("keeps a caller's own signal rather than shortening it to the default", async () => {
    /*
     * This is how `completeMultipart` asks for 90 s while the default is 15 s.
     * Combining the two would silently cap it at the default and produce a bug
     * report about large files only — the hardest kind to reproduce.
     */
    const impl = vi.fn(async () => new Response("ok"));
    const own = AbortSignal.timeout(60_000);

    await withDeadline(100, impl as unknown as typeof fetch)(url, { signal: own });

    expect(impl).toHaveBeenCalledWith(url, { signal: own });
  });

  it("passes a successful response straight through", async () => {
    const impl = vi.fn(async () => new Response("body", { status: 201 }));
    const response = await withDeadline(1_000, impl as unknown as typeof fetch)(url);

    expect(response.status).toBe(201);
    expect(await response.text()).toBe("body");
  });

  it("does not disguise a failure that is not a timeout", async () => {
    const boom = new Error("ECONNREFUSED");
    const impl = vi.fn(async () => {
      throw boom;
    });

    await expect(withDeadline(1_000, impl as unknown as typeof fetch)(url)).rejects.toBe(
      boom,
    );
  });
});

describe("the two budgets", () => {
  it("keeps the transfer budget under the transaction's own ceiling", () => {
    /*
     * A handler holds an open transaction while it waits, and
     * `idle_in_transaction_session_timeout` is 120 s (P141). A transfer
     * deadline above that would be decided by Postgres killing the connection
     * instead — the request fails either way, but the reason is lost.
     */
    expect(TRANSFER_DEADLINE_MS).toBeLessThan(120_000);
    expect(CONTROL_DEADLINE_MS).toBeLessThan(TRANSFER_DEADLINE_MS);
  });
});
