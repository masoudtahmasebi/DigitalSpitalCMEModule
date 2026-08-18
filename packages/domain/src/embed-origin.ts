/**
 * Which browser origins may embed a project's widget (P94-04).
 *
 * ## Why this is a pattern language and not a list of strings
 *
 * It was a list of strings, and the client asked for the other thing:
 *
 * > _"the ALLOWED_ORIGINS should be configurable from the `Projekte` entity and
 * > it should be possible to add multiple entries, for dev staging and prod
 * > urls with * and possible to add all of the domain, even localhost with a
 * > port."_
 *
 * The per-project part already existed. What did not is that one customer is
 * several origins — `www`, a staging host, a preview deployment per branch, a
 * developer's machine on whatever port Vite picked this morning — and
 * enumerating them means an operator editing a platform setting every time
 * somebody spins up a preview. That setting then gets left wide, or the embed
 * silently fails, and a CORS failure is invisible from the server (§9.13).
 *
 * ## The grammar, and why it stops where it does
 *
 * | Pattern                     | Matches                                        |
 * | --------------------------- | ---------------------------------------------- |
 * | `https://www.example.com`   | exactly that origin                            |
 * | `https://*.example.com`     | any sub-domain, at any depth — **not** the apex |
 * | `http://localhost:*`        | that host on any port                          |
 * | `https://*.example.com:*`   | both at once                                   |
 *
 * And what is deliberately refused:
 *
 * - **`*` on its own, or `*://…`, or `https://*`.** The API answers with
 *   `Access-Control-Allow-Credentials: true`, and the fetch specification
 *   forbids that with a wildcard origin *precisely* because it would let any
 *   page on the web make authenticated requests as a signed-in physician. A
 *   host pattern must therefore always be anchored to a registrable domain.
 * - **A `*` anywhere but as the whole leftmost label.** `https://ww*.x.de`
 *   looks like it means something and would be a different rule from the one
 *   the operator read.
 * - **A path, a query, a fragment or a trailing slash.** An `Origin` header is
 *   scheme, host and port; anything else silently never matches, which is the
 *   failure mode P18-04 refused at write time and this keeps refusing.
 *
 * The apex exclusion is the one people find surprising, so it is stated in the
 * field's own hint rather than left to be discovered: a customer serving from
 * both `example.com` and `www.example.com` lists two entries.
 *
 * ## Why the matching lives here
 *
 * `CLAUDE.md` §4 invariant 1: this decides whether a browser may talk to the
 * API at all, so it is a compliance-shaped rule and belongs where the rules are
 * — pure, exhaustively tested, and reachable by the console's validator and the
 * CORS callback alike. Two implementations of "does this origin match" would be
 * the same defect as two implementations of a percentage.
 */

/**
 * The port suffix, if there is one, split off before the host is examined.
 *
 * `URL` cannot help here: `https://*.example.com` is not a URL and the parser
 * rejects it, which is exactly why the plain-origin case still goes through
 * `URL` and this one does not.
 */
interface ParsedPattern {
  readonly scheme: "http:" | "https:";
  /** Lower-cased. `*` is present only as the whole leftmost label. */
  readonly host: string;
  /** `undefined` for "no port given", `"*"` for any port. */
  readonly port: string | undefined;
}

/**
 * A DNS label, checked without a regex.
 *
 * `^[a-z0-9]([a-z0-9-]*[a-z0-9])?$` is the natural way to write this and
 * ESLint's `security/detect-unsafe-regex` refuses it — the same refusal
 * `isOrigin` hit twice before P18-04 replaced it with `URL`. The rule is being
 * conservative about backtracking, and it is also pointing at something true:
 * a grammar this small does not need a backtracking engine.
 */
function isHostLabel(label: string): boolean {
  if (label.length === 0 || label.length > 63) return false;
  if (label.startsWith("-") || label.endsWith("-")) return false;
  for (const character of label) {
    const alphanumeric =
      (character >= "a" && character <= "z") || (character >= "0" && character <= "9");
    if (!alphanumeric && character !== "-") return false;
  }
  return true;
}

function parsePattern(value: string): ParsedPattern | undefined {
  const scheme = value.startsWith("https://")
    ? ("https:" as const)
    : value.startsWith("http://")
      ? ("http:" as const)
      : undefined;
  if (scheme === undefined) return undefined;

  const rest = value.slice(scheme === "https:" ? 8 : 7);
  // No path, query, fragment, credentials or empty authority. Checked before
  // the split so `https://a.de/x:1` cannot be read as a port.
  if (rest === "" || /[/?#@\\]/u.test(rest)) return undefined;

  const colon = rest.lastIndexOf(":");
  const hostPart = colon === -1 ? rest : rest.slice(0, colon);
  const portPart = colon === -1 ? undefined : rest.slice(colon + 1);

  if (portPart !== undefined) {
    if (portPart !== "*" && !/^[0-9]{1,5}$/u.test(portPart)) return undefined;
    if (portPart !== "*" && Number(portPart) > 65535) return undefined;
  }

  const host = hostPart.toLowerCase();
  if (host === "") return undefined;

  const labels = host.split(".");
  const wildcard = labels[0] === "*";
  const named = wildcard ? labels.slice(1) : labels;

  // A wildcard must be anchored: `https://*` and `https://*.de` would delegate
  // the decision to whoever can register a name, which with credentials on is
  // not a decision to delegate.
  if (wildcard && named.length < 2) return undefined;
  if (named.length === 0) return undefined;
  if (!named.every(isHostLabel)) return undefined;

  return { scheme, host, port: portPart };
}

/**
 * Whether a pattern is one this platform will store.
 *
 * A plain origin is validated by `URL` — comparing a parse against its input is
 * the precise test rather than an approximation, and it rejects a path, a
 * trailing slash, credentials, a query and a fragment without enumerating any
 * of them (P18-04's reasoning, kept).
 */
export function isEmbedOriginPattern(value: string): boolean {
  const parsed = parsePattern(value);
  if (parsed === undefined) return false;
  if (parsed.host.startsWith("*.") || parsed.port === "*") return true;

  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") && url.origin === value
    );
  } catch {
    return false;
  }
}

/**
 * Whether a browser's `Origin` header is covered by one stored pattern.
 *
 * The origin is parsed with `URL` and compared component by component; string
 * prefix matching is how `https://evil-example.com` comes to satisfy a rule
 * written for `https://example.com`.
 */
export function embedOriginMatches(pattern: string, origin: string): boolean {
  const rule = parsePattern(pattern);
  if (rule === undefined) return false;

  /*
   * Lower-cased first, because scheme and host are case-insensitive and `URL`
   * normalises them — so `https://WWW.X.DE` would otherwise fail the
   * origin-shape check below against its own normalised form. Safe to do here
   * and nowhere else: an origin has no path, and the check that it *is* an
   * origin happens after.
   */
  const normalised = origin.toLowerCase();

  let url: URL;
  try {
    url = new URL(normalised);
  } catch {
    return false;
  }
  // A browser sends scheme + host + port and nothing else. Anything with more
  // in it is not an Origin header and is not matched on principle.
  if (url.origin !== normalised) return false;
  if (url.protocol !== rule.scheme) return false;

  if (rule.port === "*") {
    // Any port, including none.
  } else {
    const wanted = rule.port ?? (rule.scheme === "https:" ? "443" : "80");
    const actual =
      url.port === "" ? (url.protocol === "https:" ? "443" : "80") : url.port;
    if (wanted !== actual) return false;
  }

  const host = url.hostname.toLowerCase();
  if (!rule.host.startsWith("*.")) return host === rule.host;

  // `*.example.com` covers `a.example.com` and `a.b.example.com`, and never
  // `example.com` itself — the dot is required, so `notexample.com` cannot
  // slip through a suffix comparison.
  const suffix = rule.host.slice(1);
  return host.endsWith(suffix) && host.length > suffix.length;
}

/** Whether any stored pattern covers this origin. */
export function embedOriginAllowed(patterns: readonly string[], origin: string): boolean {
  return patterns.some((pattern) => embedOriginMatches(pattern, origin));
}

/**
 * The entries a form should report as rejected, in order.
 *
 * Returns the **values**, because unlike a branding colour an origin is not
 * personal data and an operator cannot fix a typo they are not shown (§9.5's
 * rule is about values that identify somebody; a host the operator just typed
 * is not one).
 */
export function invalidEmbedOriginPatterns(
  patterns: readonly string[],
): readonly string[] {
  return patterns.filter((pattern) => !isEmbedOriginPattern(pattern));
}
