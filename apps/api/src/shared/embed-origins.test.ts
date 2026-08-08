/**
 * The embed-origin registry (P18-04).
 *
 * The behaviour worth pinning is not "does a Set contain a string" — it is the
 * three decisions in the header of `embed-origins.ts`, each of which is a
 * trade somebody could reasonably reverse without noticing what it cost:
 *
 * - our own origins are allowed before any database is reachable;
 * - a database error keeps the previous set rather than emptying it;
 * - a burst past the TTL costs one query, not one per request.
 */

import { describe, expect, it, vi } from "vitest";
import { EmbedOriginRegistry, type OriginSource } from "./embed-origins.js";

const OURS = [
  "https://verwaltung.digitalspital.com",
  "https://fortbildung.digitalspital.com",
];

function sourceOf(...origins: string[]): OriginSource {
  return { load: async () => origins };
}

/** A clock the test moves by hand, so a TTL is asserted rather than waited out. */
function clock(start = 0) {
  let now = start;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}

describe("our own origins", () => {
  it("are allowed before anything has loaded", () => {
    // A deployment whose own console cannot reach its own API is broken in a
    // way no customer configuration should be able to cause — including a
    // database that is not up yet.
    const registry = new EmbedOriginRegistry({ load: async () => [] }, OURS, clock().now);

    expect(registry.isAllowed(OURS[0]!)).toBe(true);
  });

  it("survive a load that returns nothing", async () => {
    const registry = new EmbedOriginRegistry({ load: async () => [] }, OURS);
    await registry.warm();

    expect(registry.isAllowed(OURS[1]!)).toBe(true);
  });
});

describe("a customer's origin", () => {
  it("is allowed once loaded", async () => {
    const registry = new EmbedOriginRegistry(sourceOf("https://www.medice.de"), OURS);
    await registry.warm();

    expect(registry.isAllowed("https://www.medice.de")).toBe(true);
  });

  it("is refused when no project names it", async () => {
    const registry = new EmbedOriginRegistry(sourceOf("https://www.medice.de"), OURS);
    await registry.warm();

    expect(registry.isAllowed("https://evil.example")).toBe(false);
  });

  it("is matched exactly — an origin is scheme, host and port", async () => {
    // No prefix matching, ever. `https://www.medice.de.evil.example` starts
    // with the permitted string and is a different site entirely.
    const registry = new EmbedOriginRegistry(sourceOf("https://www.medice.de"), OURS);
    await registry.warm();

    expect(registry.isAllowed("https://www.medice.de.evil.example")).toBe(false);
    expect(registry.isAllowed("http://www.medice.de")).toBe(false);
    expect(registry.isAllowed("https://www.medice.de:8443")).toBe(false);
  });
});

describe("the cache", () => {
  it("costs one query for a burst of preflights", async () => {
    const load = vi.fn(async () => ["https://www.medice.de"]);
    const registry = new EmbedOriginRegistry({ load }, OURS, clock().now);
    await registry.warm();

    for (let i = 0; i < 50; i += 1) registry.isAllowed("https://www.medice.de");

    // Putting Postgres in the path of every cross-origin request — including
    // the ones about to be refused — is what the cache exists to avoid.
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("refreshes once the TTL has passed", async () => {
    const time = clock();
    const load = vi.fn(async () => ["https://www.medice.de"]);
    const registry = new EmbedOriginRegistry({ load }, OURS, time.now);
    await registry.warm();

    time.advance(61_000);
    registry.isAllowed("https://www.medice.de");
    await Promise.resolve();

    expect(load).toHaveBeenCalledTimes(2);
  });

  it("picks up an origin an operator has just added", async () => {
    const time = clock();
    let origins: string[] = [];
    const registry = new EmbedOriginRegistry(
      { load: async () => origins },
      OURS,
      time.now,
    );
    await registry.warm();
    expect(registry.isAllowed("https://neu.example")).toBe(false);

    origins = ["https://neu.example"];
    time.advance(61_000);
    registry.isAllowed("https://neu.example"); // triggers the refresh
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(registry.isAllowed("https://neu.example")).toBe(true);
  });
});

describe("when the database is unreachable", () => {
  it("keeps the origins it already had", async () => {
    // The decision worth stating out loud. An outage that also revoked every
    // customer's embed permission would turn a recoverable blip into every
    // widget on the internet breaking — and it would keep breaking for as long
    // as anybody was still looking at the database.
    const time = clock();
    let fail = false;
    const registry = new EmbedOriginRegistry(
      {
        load: async () => {
          if (fail) throw new Error("connection refused");
          return ["https://www.medice.de"];
        },
      },
      OURS,
      time.now,
    );
    await registry.warm();

    fail = true;
    time.advance(61_000);
    registry.isAllowed("https://www.medice.de");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(registry.isAllowed("https://www.medice.de")).toBe(true);
    expect(registry.isAllowed(OURS[0]!)).toBe(true);
  });

  it("tries again on the next request rather than backing off for a TTL", async () => {
    const time = clock();
    const load = vi.fn(async () => {
      throw new Error("connection refused");
    });
    const registry = new EmbedOriginRegistry({ load }, OURS, time.now);

    await registry.warm();
    const afterFirst = load.mock.calls.length;

    // `#loadedAt` is deliberately not advanced on failure, so recovery is
    // immediate rather than up to a minute late.
    registry.isAllowed("https://www.medice.de");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(load.mock.calls.length).toBeGreaterThan(afterFirst);
  });
});
