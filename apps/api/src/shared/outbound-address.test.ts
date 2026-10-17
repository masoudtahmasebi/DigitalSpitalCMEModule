/**
 * Which addresses the API may open a connection to on a tenant's say-so
 * (P247-02, closes SEC-2).
 *
 * Exhaustive over the ranges the ticket names, both families, and the
 * spellings that slip past a string comparison — a v4 address written as a
 * v4-mapped v6 one, a bracketed IPv6 literal from a URL, and a name that
 * resolves to several addresses of which only one is internal.
 */

import { describe, expect, it } from "vitest";
import {
  isForbiddenAddress,
  OutboundAddressRefused,
  resolvePublicAddress,
  type LookupAll,
} from "./outbound-address.js";

describe("isForbiddenAddress", () => {
  it.each([
    ["127.0.0.1", "loopback"],
    ["127.255.255.254", "loopback, top of the /8"],
    ["10.0.0.1", "RFC 1918 /8"],
    ["172.16.0.1", "RFC 1918 /12, bottom"],
    ["172.31.255.255", "RFC 1918 /12, top"],
    ["192.168.1.1", "RFC 1918 /16"],
    ["169.254.169.254", "link-local, the cloud metadata service"],
    ["100.64.0.1", "CGNAT, bottom"],
    ["100.127.255.255", "CGNAT, top"],
    ["0.0.0.0", "unspecified"],
    ["0.1.2.3", "this network"],
    ["::", "IPv6 unspecified"],
    ["::1", "IPv6 loopback"],
    ["fc00::1", "IPv6 unique local"],
    ["fd12:3456::1", "IPv6 unique local, fd"],
    ["fe80::1", "IPv6 link-local"],
    ["::ffff:127.0.0.1", "v4-mapped loopback"],
    ["::ffff:7f00:1", "v4-mapped loopback, hex spelling"],
    ["::ffff:169.254.169.254", "v4-mapped metadata service"],
    ["not-an-address", "not an IP at all"],
  ])("refuses %s (%s)", (address) => {
    expect(isForbiddenAddress(address)).toBe(true);
  });

  it.each([
    ["93.184.216.34", "public v4"],
    ["172.15.255.255", "just below RFC 1918 /12"],
    ["172.32.0.1", "just above RFC 1918 /12"],
    ["100.63.255.255", "just below CGNAT"],
    ["100.128.0.1", "just above CGNAT"],
    ["169.253.255.255", "just below link-local"],
    ["11.0.0.1", "just above 10/8"],
    ["2606:4700::1111", "public v6"],
    ["::ffff:93.184.216.34", "v4-mapped public"],
  ])("allows %s (%s)", (address) => {
    expect(isForbiddenAddress(address)).toBe(false);
  });
});

describe("resolvePublicAddress", () => {
  const never: LookupAll = () => {
    throw new Error("a literal address must not be looked up");
  };

  it("returns a public literal without a lookup", async () => {
    await expect(resolvePublicAddress("93.184.216.34", never)).resolves.toBe(
      "93.184.216.34",
    );
  });

  it("refuses a bracketed IPv6 literal from a URL", async () => {
    await expect(resolvePublicAddress("[::1]", never)).rejects.toBeInstanceOf(
      OutboundAddressRefused,
    );
  });

  it("refuses localhost by name, whatever the resolver says", async () => {
    await expect(
      resolvePublicAddress("localhost", async () => [
        { address: "93.184.216.34", family: 4 },
      ]),
    ).rejects.toBeInstanceOf(OutboundAddressRefused);
  });

  it("refuses a name when any one of its addresses is internal", async () => {
    // A resolver answering a public and a private address lets the connection
    // land on either; refusing only when all are private is no refusal.
    const lookup: LookupAll = async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "10.1.2.3", family: 4 },
    ];
    await expect(resolvePublicAddress("mixed.example", lookup)).rejects.toBeInstanceOf(
      OutboundAddressRefused,
    );
  });

  it("refuses a name that does not resolve", async () => {
    const lookup: LookupAll = async () => {
      throw Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" });
    };
    await expect(resolvePublicAddress("nowhere.invalid", lookup)).rejects.toBeInstanceOf(
      OutboundAddressRefused,
    );
  });

  it("refuses a name whose lookup does not answer in time", async () => {
    const hanging: LookupAll = () => new Promise(() => undefined);
    await expect(
      resolvePublicAddress("slow.example", hanging, 20),
    ).rejects.toBeInstanceOf(OutboundAddressRefused);
  });

  it("returns the first address of a public name", async () => {
    const lookup: LookupAll = async () => [
      { address: "2606:4700::1111", family: 6 },
      { address: "93.184.216.34", family: 4 },
    ];
    await expect(resolvePublicAddress("cdn.example", lookup)).resolves.toBe(
      "2606:4700::1111",
    );
  });

  it("never quotes the host in its message", async () => {
    // §9.5: the refusal names the field at the API boundary, never the value.
    const error = await resolvePublicAddress("10.9.8.7", never).catch((e: unknown) => e);
    expect(String((error as Error).message)).not.toContain("10.9.8.7");
  });
});
