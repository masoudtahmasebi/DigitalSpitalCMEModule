import { describe, expect, it } from "vitest";

import { deliverySender, type SenderTransport } from "./delivery-sender.js";

const NONE: SenderTransport = {
  host: null,
  port: null,
  username: null,
  password: null,
  fromAddress: null,
  fromName: null,
  secure: null,
};

const PROJECT: SenderTransport = {
  host: "mail.medice.com",
  port: 587,
  username: "cme",
  password: "s3cret",
  fromAddress: "fortbildung@medice.com",
  fromName: "MEDICE Fortbildung",
  secure: null,
};

const PLATFORM: SenderTransport = {
  host: "mail.digitalspital.de",
  port: 587,
  username: "platform",
  password: "other",
  fromAddress: "no-reply@digitalspital.de",
  fromName: "DigitalSpital",
  secure: true,
};

describe("deliverySender", () => {
  it("uses the project's own server when it has one", () => {
    expect(deliverySender({ project: PROJECT, platform: PLATFORM })).toEqual({
      kind: "project",
      transport: PROJECT,
    });
  });

  it("falls back to the platform's when the project has none", () => {
    expect(deliverySender({ project: NONE, platform: PLATFORM })).toEqual({
      kind: "platform",
      transport: PLATFORM,
    });
  });

  it("reports none when neither is configured", () => {
    expect(deliverySender({ project: NONE, platform: NONE })).toEqual({ kind: "none" });
  });

  /*
   * The cases the whole file exists for. A per-column fallback would take the
   * customer's From address and the platform's host, and the recipient's server
   * would quarantine every message for failing SPF — after our SMTP transaction
   * succeeded. `delivered` on every row and nothing in any inbox.
   */
  it("never puts the project's address on the platform's server", () => {
    const halfConfigured: SenderTransport = {
      ...NONE,
      fromAddress: "fortbildung@medice.com",
      fromName: "MEDICE Fortbildung",
    };

    const sender = deliverySender({ project: halfConfigured, platform: PLATFORM });

    expect(sender.kind).toBe("platform");
    // The whole identity, not a merge.
    expect(sender.kind === "platform" && sender.transport.fromAddress).toBe(
      "no-reply@digitalspital.de",
    );
    expect(JSON.stringify(sender)).not.toContain("medice.com");
  });

  it("never puts the platform's address on the project's server", () => {
    const hostOnly: SenderTransport = { ...NONE, host: "mail.medice.com", port: 587 };

    const sender = deliverySender({ project: hostOnly, platform: PLATFORM });

    // A project with a host and no From address cannot send as itself, so it
    // falls through whole rather than borrowing an address.
    expect(sender.kind).toBe("platform");
    expect(sender.kind === "platform" && sender.transport.host).toBe(
      "mail.digitalspital.de",
    );
  });

  it("treats an empty string as unset, because a cleared field is not a host", () => {
    const blank: SenderTransport = { ...PROJECT, host: "", fromAddress: "" };
    expect(deliverySender({ project: blank, platform: PLATFORM }).kind).toBe("platform");
  });

  /*
   * `canSend` in the API trims before deciding, and the Sicherheit screen shows
   * its answer. Without the trim here a stored `"  "` would put "nicht
   * vollständig" on that screen while the worker sent through the same value.
   */
  it("treats a whitespace host as unset, as canSend does", () => {
    const spaces: SenderTransport = { ...PROJECT, host: "   " };
    expect(deliverySender({ project: spaces, platform: PLATFORM }).kind).toBe("platform");
  });

  // Implicit TLS travels with the identity it belongs to. The platform records
  // an answer (P40-01); a project has no such column and passes null, which the
  // channel then infers from the port.
  it("carries the chosen sender's TLS setting, not the other's", () => {
    const platform = deliverySender({ project: NONE, platform: PLATFORM });
    expect(platform.kind === "platform" && platform.transport.secure).toBe(true);

    const project = deliverySender({ project: PROJECT, platform: PLATFORM });
    expect(project.kind === "project" && project.transport.secure).toBe(null);
  });

  it("carries the credentials of whichever sender it chose, and only those", () => {
    const sender = deliverySender({ project: NONE, platform: PLATFORM });
    expect(sender.kind === "platform" && sender.transport.password).toBe("other");
    expect(JSON.stringify(sender)).not.toContain("s3cret");
  });
});
