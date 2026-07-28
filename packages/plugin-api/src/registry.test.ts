/**
 * The registry's three refusals.
 *
 * All three are compliance guards wearing the clothes of ordinary API design,
 * which is why they are tested rather than assumed: a duplicate registration
 * that silently won would decide, at boot, which of two reporters files a
 * physician's points.
 */

import { describe, expect, it } from "vitest";
import { createPluginRegistry, PluginError } from "./registry.js";
import type { AccreditationReporter } from "./capabilities.js";

function reporter(id: string): AccreditationReporter {
  return { id, report: async () => ({ accepted: true }) };
}

describe("createPluginRegistry", () => {
  it("resolves what was registered", () => {
    const registry = createPluginRegistry();
    registry.register("accreditationReporter", reporter("eiv-fobi"));
    expect(registry.require("accreditationReporter").id).toBe("eiv-fobi");
  });

  it("returns undefined from find for a capability nobody provides", () => {
    // The normal case for contentIngestor, and for deliveryChannel in a
    // deployment that sends no email.
    expect(createPluginRegistry().find("contentIngestor")).toBeUndefined();
  });

  it("names the missing capability rather than failing three frames deeper", () => {
    const registry = createPluginRegistry();
    expect(() => registry.require("certificateRenderer")).toThrow(PluginError);
    expect(() => registry.require("certificateRenderer")).toThrow(/certificateRenderer/);
  });

  it("refuses a second implementation instead of overwriting the first", () => {
    // Two modules each believing they own the reporter is a wiring mistake.
    // Silently taking the last one would decide, by import order, which
    // authority a physician's points are filed with.
    const registry = createPluginRegistry();
    registry.register("accreditationReporter", reporter("eiv-fobi"));

    expect(() => registry.register("accreditationReporter", reporter("other"))).toThrow(
      PluginError,
    );
    // And the first one is still the one in use.
    expect(registry.require("accreditationReporter").id).toBe("eiv-fobi");
  });

  it("names the incumbent in the refusal", () => {
    const registry = createPluginRegistry();
    registry.register("accreditationReporter", reporter("eiv-fobi"));
    expect(() => registry.register("accreditationReporter", reporter("other"))).toThrow(
      /eiv-fobi/,
    );
  });

  it("refuses registration once sealed", () => {
    // Nothing in the request path may swap the certificate renderer between
    // two requests.
    const registry = createPluginRegistry();
    registry.seal();
    expect(() => registry.register("accreditationReporter", reporter("late"))).toThrow(
      PluginError,
    );
  });

  it("still resolves after sealing", () => {
    const registry = createPluginRegistry();
    registry.register("accreditationReporter", reporter("eiv-fobi"));
    registry.seal();
    expect(registry.require("accreditationReporter").id).toBe("eiv-fobi");
  });

  it("lists what is installed, in a stable order", () => {
    const registry = createPluginRegistry();
    registry.register("accreditationReporter", reporter("eiv-fobi"));
    registry.register("deliveryChannel", {
      id: "smtp",
      deliver: async () => ({ status: "delivered" }),
    });

    expect(registry.installed()).toEqual([
      { capability: "accreditationReporter", id: "eiv-fobi" },
      { capability: "deliveryChannel", id: "smtp" },
    ]);
  });
});
