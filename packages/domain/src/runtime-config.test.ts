/**
 * Which configuration value wins.
 *
 * The precedence is the point: a deployed container always writes
 * `/config.js`, so a stale `VITE_API_BASE` baked into an old image must never
 * beat what the host says. Getting this backwards would be a console quietly
 * talking to the wrong API — the exact failure the runtime config removed.
 */

import { describe, expect, it } from "vitest";
import { configValue } from "./runtime-config.js";

describe("configValue", () => {
  it("prefers the runtime value over the build-time one", () => {
    expect(
      configValue(
        { apiBase: "https://api.digitalspital.com" },
        "apiBase",
        "https://stale",
      ),
    ).toBe("https://api.digitalspital.com");
  });

  it("falls back to the build-time value, which is how `pnpm dev` works", () => {
    expect(configValue(undefined, "apiBase", "http://localhost:3000")).toBe(
      "http://localhost:3000",
    );
    expect(configValue({}, "apiBase", "http://localhost:3000")).toBe(
      "http://localhost:3000",
    );
  });

  it("treats an empty runtime value as absent rather than as a value", () => {
    // The generator omits a key it has no value for, but a hand-edited or
    // half-written file can carry an empty string, and "" is not a URL.
    expect(configValue({ apiBase: "" }, "apiBase", "http://localhost:3000")).toBe(
      "http://localhost:3000",
    );
  });

  it("ignores a runtime value that is not a string", () => {
    // `/config.js` is generated outside the bundle, so the declared type is a
    // claim about it and not a guarantee.
    const hostile = { apiBase: 42 } as unknown as { apiBase?: string };
    expect(configValue(hostile, "apiBase", "http://localhost:3000")).toBe(
      "http://localhost:3000",
    );
  });

  it("returns the empty string when nothing is configured", () => {
    // One spelling of "absent", because both apps test their whole config with
    // `every(v => v !== "")`.
    expect(configValue(undefined, "apiBase", undefined)).toBe("");
    expect(configValue({}, "projectSlug", "")).toBe("");
  });

  it("reads each key independently", () => {
    const runtime = { apiBase: "https://api.example.com", clientId: "ds-portal" };
    expect(configValue(runtime, "apiBase", undefined)).toBe("https://api.example.com");
    expect(configValue(runtime, "clientId", undefined)).toBe("ds-portal");
    expect(configValue(runtime, "issuer", "https://login.example.com/realms/x")).toBe(
      "https://login.example.com/realms/x",
    );
  });
});
