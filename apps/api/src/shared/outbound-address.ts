/**
 * Where the API may open a connection on a tenant's say-so (P247-02, closes
 * SEC-2 of `docs/code-audit-api.md`).
 *
 * ## The defect
 *
 * Two destinations are typed in by a customer rather than set by an operator:
 * a lesson's media URL (an author) and a project's SMTP host (a
 * `customer_admin`). The media check fetched any URL, followed redirects and
 * reported the status — so `http://127.0.0.1:5432/` or the cloud metadata
 * service at `169.254.169.254` could be probed from inside the API's network
 * by anybody allowed to edit a course, with the answer on screen. The SMTP
 * host was the same class, blind.
 *
 * ## The rule
 *
 * Resolve the host, and refuse if **any** address it resolves to is loopback,
 * private (RFC 1918 / IPv6 unique-local), link-local, CGNAT (`100.64/10`),
 * unspecified, multicast or broadcast — or if it does not resolve at all.
 * "Any", not "all": a name answering one public and one private address lets
 * the connection land on either.
 *
 * ## What it cannot do on its own
 *
 * Stop a name that resolves to a public address here and a private one a
 * moment later, when the connecting code resolves again (DNS rebinding). The
 * SMTP channel closes that by connecting to the address this returns
 * (`SmtpDeliveryChannel`'s `vetHost`). The media check's `fetch` resolves on
 * its own and cannot be pinned without a custom dispatcher; it has this check,
 * no redirect following, and a one-byte request — stated rather than implied.
 *
 * Operator-set destinations (the object store, the platform's own SMTP relay,
 * the EIV endpoint) are deliberately not routed through this: an internal relay
 * is a legitimate thing for an operator to configure.
 */

import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

/** `dns.promises.lookup` with `{ all: true }`, injectable for tests. */
export type LookupAll = (
  host: string,
) => Promise<ReadonlyArray<{ address: string; family: number }>>;

const systemLookup: LookupAll = (host) => dnsLookup(host, { all: true, verbatim: true });

/**
 * How long a lookup may take before the host counts as unresolvable.
 *
 * `getaddrinfo` has no deadline of its own, and this runs inside a request
 * (the media check) and a mail send. Through the system resolver on purpose —
 * it is what `fetch` will use, `/etc/hosts` included, so the check sees the
 * same answer the connection would. The race does not cancel the lookup
 * thread; it stops the caller waiting on it.
 */
const LOOKUP_TIMEOUT_MS = 5_000;

/**
 * Refused. The message names no host and no address: it reaches logs, and at
 * the API boundary the field is named, never its value (§9.5).
 */
export class OutboundAddressRefused extends Error {
  constructor(readonly reason: "internal_address" | "unresolvable") {
    super(`outbound address refused: ${reason}`);
    this.name = "OutboundAddressRefused";
  }
}

/** `[a, b]` inclusive, as 32-bit unsigned integers. */
const V4_FORBIDDEN: ReadonlyArray<readonly [number, number]> = [
  cidr4("0.0.0.0", 8), //        "this network", incl. unspecified
  cidr4("10.0.0.0", 8), //       RFC 1918
  cidr4("100.64.0.0", 10), //    CGNAT, RFC 6598
  cidr4("127.0.0.0", 8), //      loopback
  cidr4("169.254.0.0", 16), //   link-local, incl. cloud metadata
  cidr4("172.16.0.0", 12), //    RFC 1918
  cidr4("192.168.0.0", 16), //   RFC 1918
  cidr4("224.0.0.0", 4), //      multicast
  cidr4("255.255.255.255", 32), // broadcast
];

/**
 * Whether a connection to this literal address is refused.
 *
 * Anything that is not an IP literal is refused too: the caller is meant to
 * hand this resolved addresses, and a string that is neither is not one to
 * connect to.
 */
export function isForbiddenAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return forbiddenV4(v4ToInt(address));
  if (family === 6) return forbiddenV6(address);
  return true;
}

/**
 * Resolve `host` and return one address that may be connected to, or throw
 * `OutboundAddressRefused`.
 *
 * Accepts a URL's `hostname`, so an IPv6 literal may arrive in brackets.
 */
export async function resolvePublicAddress(
  host: string,
  lookup: LookupAll = systemLookup,
  timeoutMs = LOOKUP_TIMEOUT_MS,
): Promise<string> {
  const bare = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;

  if (isIP(bare) !== 0) {
    if (isForbiddenAddress(bare)) throw new OutboundAddressRefused("internal_address");
    return bare;
  }

  // Refused by name as well as by address: `localhost` need not go through DNS
  // at all on every resolver, and a stub that answers it publicly is a test
  // that proves nothing.
  const name = bare.toLowerCase().replace(/\.$/, "");
  if (name === "localhost" || name.endsWith(".localhost")) {
    throw new OutboundAddressRefused("internal_address");
  }

  let addresses: ReadonlyArray<{ address: string }>;
  let timer: NodeJS.Timeout | undefined;
  try {
    addresses = await Promise.race([
      lookup(bare),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("lookup timed out")), timeoutMs);
      }),
    ]);
  } catch {
    throw new OutboundAddressRefused("unresolvable");
  } finally {
    clearTimeout(timer);
  }
  if (addresses.length === 0) throw new OutboundAddressRefused("unresolvable");
  if (addresses.some((entry) => isForbiddenAddress(entry.address))) {
    throw new OutboundAddressRefused("internal_address");
  }
  return addresses[0]!.address;
}

// ---------------------------------------------------------------------------

function v4ToInt(address: string): number {
  return address.split(".").reduce((acc, octet) => ((acc << 8) | Number(octet)) >>> 0, 0);
}

function cidr4(base: string, bits: number): readonly [number, number] {
  const start = v4ToInt(base);
  const size = bits === 32 ? 1 : 2 ** (32 - bits);
  return [start, start + size - 1];
}

function forbiddenV4(value: number): boolean {
  return V4_FORBIDDEN.some(([low, high]) => value >= low && value <= high);
}

/** The eight 16-bit groups of an IPv6 address, `::` and a dotted tail expanded. */
function v6Groups(address: string): number[] {
  let text = address.toLowerCase();
  const zone = text.indexOf("%");
  if (zone !== -1) text = text.slice(0, zone);

  // A dotted v4 tail (`::ffff:1.2.3.4`) becomes two hex groups.
  const lastColon = text.lastIndexOf(":");
  const tail = text.slice(lastColon + 1);
  if (tail.includes(".")) {
    const v4 = v4ToInt(tail);
    text = `${text.slice(0, lastColon + 1)}${(v4 >>> 16).toString(16)}:${(v4 & 0xffff).toString(16)}`;
  }

  const [head = "", rest] = text.split("::");
  const left = head === "" ? [] : head.split(":");
  const right = rest === undefined || rest === "" ? [] : rest.split(":");
  const fill = rest === undefined ? 0 : 8 - left.length - right.length;
  return [...left, ...Array<string>(fill).fill("0"), ...right].map((g) =>
    Number.parseInt(g, 16),
  );
}

function forbiddenV6(address: string): boolean {
  const g = v6Groups(address);
  if (g.length !== 8 || g.some((n) => Number.isNaN(n))) return true;

  const zeroUpTo = (n: number) => g.slice(0, n).every((x) => x === 0);

  // ::  and  ::1
  if (zeroUpTo(7) && (g[7] === 0 || g[7] === 1)) return true;
  // ::ffff:a.b.c.d (v4-mapped) and ::a.b.c.d (v4-compatible): judge the v4.
  if (zeroUpTo(5) && (g[5] === 0xffff || g[5] === 0)) {
    return forbiddenV4(((g[6]! << 16) | g[7]!) >>> 0);
  }
  const first = g[0]!;
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((first & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  return false;
}
