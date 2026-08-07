/**
 * What must never reach a log, and how it is removed (P25-01). Pure.
 *
 * ## Why this is a module and not a review rule
 *
 * `docs/gdpr.md` §7 claims that no personal data is written to application
 * logs. That claim is currently held up by everybody remembering — and the
 * places it would break are the ones nobody writes on purpose: an error message
 * that echoes the value it rejected, a `JSON.stringify(request.body)` added
 * while debugging, a `pg` driver error that quotes the failing row, a presigned
 * URL in a fetch failure.
 *
 * So the log path runs everything through here, and the interesting cases are
 * tested exhaustively. A redactor that is only applied where somebody
 * remembered is the same as no redactor.
 *
 * ## What counts as personal data here
 *
 * From `docs/gdpr.md` §2, the fields that identify a physician:
 *
 * - **EFN** — the 15-digit Fortbildungsnummer. The key the Ärztekammer credits
 *   points against, and the single most sensitive value in the system.
 * - **E-mail and name** — written from the token's claims.
 * - **Free-text evaluation answers** — the one place a physician may type
 *   something about a patient.
 *
 * And the credentials, which are not personal data but are worse in a log:
 * bearer tokens, session cookies, presigned URLs (a live capability written
 * down), passwords and the KMS key.
 *
 * ## Why it works on values, not on field names
 *
 * A field-name allow-list — "drop `email`, keep the rest" — protects the values
 * somebody labelled correctly. The failure is always the unlabelled one: an EFN
 * inside a constraint-violation message, an e-mail inside a URL's query string.
 * Matching the *shape* of the value catches those, and the cost is that a
 * fifteen-digit VNR is redacted too. That is the right trade: a VNR in a log is
 * merely unhelpful, an EFN in a log is a reportable incident.
 */

/** What replaces a match. Deliberately says what was removed. */
const MARK = (what: string): string => `[redacted:${what}]`;

/**
 * The rules, in order. Order matters — a bearer token can contain something
 * that looks like an e-mail, so credentials are removed first.
 *
 * `replacement` is explicit rather than always `MARK(what)` because some rules
 * capture context worth keeping. `postgres://ds_app:…@host` should become
 * `postgres://ds_app:[redacted]@host` — the username and the host are what an
 * operator needs to identify *which* connection failed, and a rule that ate
 * them turned a diagnosable error into "something failed somewhere".
 *
 * That was not a hypothetical: the first version replaced the whole match, and
 * the test asserting `ds_app` survives is what caught it.
 */
const RULES: ReadonlyArray<{
  readonly what: string;
  readonly pattern: RegExp;
  /** `$1` etc. refer to the pattern's capture groups. */
  readonly replacement: string;
}> = [
  // A presigned URL is a live capability: possession is permission until it
  // expires. The whole query string goes, not just the signature, because
  // `X-Amz-Credential` carries the access key id.
  {
    what: "presigned-url",
    pattern: /(https?:\/\/[^\s?]*)\?\S*X-Amz-Signature=\S*/gi,
    // The path survives: knowing *which object* a signature was minted for is
    // most of the diagnostic value, and a key is two UUIDs and a name we chose.
    replacement: "$1?[redacted:presigned-url]",
  },

  // `Authorization: Bearer …`, and the same token appearing bare.
  {
    what: "bearer",
    // At least 20 characters, or this eats English. The auth guard writes
    // "no Bearer token presented", and the first version of this rule turned
    // that into "no Bearer [redacted:bearer]" — destroying the one message that
    // explains a 401. A redactor that mangles ordinary prose is one people stop
    // reading the logs because of.
    //
    // 20 is safely below any real credential: the shortest thing anybody sends
    // as a bearer here is an opaque session token of 32 hex characters, and a
    // JWT is hundreds.
    pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/gi,
    replacement: "Bearer [redacted:bearer]",
  },
  // A JWT anywhere: three base64url segments. Matched on shape because the one
  // that leaks is never the one labelled `token`.
  {
    what: "jwt",
    pattern: /\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\b/g,
    replacement: "[redacted:jwt]",
  },

  // A sensitive value in a **query string**, which is where percent-encoding
  // defeats every shape rule below: `?email=arzt%40praxis.de` contains no `@`.
  // Query strings reach logs through access logs and error `instance` fields,
  // so this runs before anything tries to recognise the value itself.
  {
    what: "credential",
    pattern:
      /([?&](?:email|e-?mail|efn|token|password|access_token|id_token|code|state|signature)=)[^&\s"']*/gi,
    // The parameter *name* is kept: "somebody filtered by e-mail" is a useful
    // fact, and it is not the value.
    replacement: "$1[redacted:credential]",
  },

  // `password=…`, `"secret": "…"`, `SECRETS_KMS_KEY=…` — the assignment shapes
  // that appear in a connection string, a config dump or a driver error.
  //
  // The name is matched with optional surrounding word characters rather than
  // `\b…\b`: `_` is a word character, so `\bkms_key\b` does not match inside
  // `SECRETS_KMS_KEY`, and that is the spelling this codebase actually uses.
  {
    what: "credential",
    pattern:
      /([A-Za-z0-9_]*(?:password|passwd|secret|token|api[_-]?key|access[_-]?key|kms[_-]?key)[A-Za-z0-9_]*\s*[=:]\s*)("[^"]*"|'[^']*'|\S+)/gi,
    replacement: "$1[redacted:credential]",
  },
  // A connection string's userinfo: postgres://user:HERE@host
  {
    what: "credential",
    pattern: /(\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@]+@/gi,
    // Scheme, username and host all survive. Only the password goes.
    replacement: "$1[redacted:credential]@",
  },

  // The EFN: exactly 15 digits. Bounded so a 16-digit number is not one, and
  // so a timestamp in milliseconds (13 digits) is left alone.
  {
    what: "efn",
    pattern: /(?<![0-9])[0-9]{15}(?![0-9])/g,
    replacement: "[redacted:efn]",
  },

  // E-mail. The local part is deliberately greedy about symbols — an address
  // that fails to match is an address that reaches the log.
  {
    what: "email",
    pattern: /[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
    replacement: "[redacted:email]",
  },
];

/** Keys whose value is dropped whole, whatever it looks like. */
const SENSITIVE_KEYS = new Set([
  "efn",
  "password",
  "passwordhash",
  "password_hash",
  "token",
  "sessiontoken",
  "session_token",
  "authorization",
  "cookie",
  "setcookie",
  "set-cookie",
  "secret",
  "secretaccesskey",
  "vnrpassword",
  "vnr_password",
  "smtppassword",
  "smtp_password",
  "totpsecret",
  "totp_secret",
  "attestedname",
  "attested_name",
  "participantname",
  "participant_name",
  "email",
  "firstname",
  "first_name",
  "lastname",
  "last_name",
  "givenname",
  "given_name",
  "familyname",
  "family_name",
  "answer",
  "answers",
  "freetext",
  "free_text",
]);

/** How deep to walk before giving up. A cycle-safe bound, not a policy. */
const MAX_DEPTH = 8;
/** Longer than this and it is a payload, not a message. */
const MAX_STRING = 2000;

/** Remove anything that looks like personal data or a credential from a string. */
export function redactText(value: string): string {
  let out =
    value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…[truncated]` : value;
  for (const rule of RULES) {
    out = out.replace(rule.pattern, rule.replacement);
  }
  return out;
}

/**
 * Redact a whole structure: keys by name, strings by shape.
 *
 * Returns a new value; the input is never mutated, because a redactor that
 * modified the object it was handed would silently change what the application
 * then did with it.
 *
 * Anything it cannot represent — a function, a class instance with behaviour, a
 * cycle deeper than `MAX_DEPTH` — becomes a short marker rather than being
 * stringified. `[object Object]` in a log is noise; a `Buffer` rendered as
 * 40 KB of digits is worse.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (depth > MAX_DEPTH) return "[redacted:depth]";

  if (typeof value === "string") return redactText(value);
  if (typeof value === "number" || typeof value === "boolean") {
    // A bare 15-digit number is an EFN as surely as the string is.
    return typeof value === "number" && /^[0-9]{15}$/.test(String(value))
      ? MARK("efn")
      : value;
  }
  if (typeof value === "bigint") return String(value);
  if (typeof value === "function" || typeof value === "symbol") return "[omitted]";

  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactText(value.message),
      // Never the stack by default: it quotes source lines, which in this
      // codebase include SQL with column names and sometimes a bound value.
    };
  }
  if (Buffer.isBuffer(value)) return `[buffer:${value.byteLength}]`;
  if (Array.isArray(value)) {
    return value.slice(0, 100).map((entry) => redact(entry, depth + 1));
  }

  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEYS.has(key.toLowerCase().replace(/-/g, ""))
        ? MARK(key.toLowerCase())
        : redact(entry, depth + 1);
    }
    return out;
  }

  return "[omitted]";
}
