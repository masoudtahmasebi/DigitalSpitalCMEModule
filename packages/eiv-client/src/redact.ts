/**
 * Redaction for anything printed or logged by the harness.
 *
 * Two categories, both of which would be a reportable incident if they reached
 * a log: the **VNR password**, which authenticates DigitalSpital to a legally
 * binding accreditation interface, and the **EFN**, which is personal data
 * identifying a named physician.
 *
 * The harness's whole purpose is to print exactly what was sent and received,
 * so redaction has to happen here rather than being left to the caller.
 */

const SECRET_KEYS = new Set(["passwort", "password", "vnrpassword", "token", "jwt"]);
const PERSONAL_KEYS = new Set(["efn"]);

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);

  if (typeof value !== "object" || value === null) return value;

  const output: Record<string, unknown> = {};

  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const normalised = key.toLowerCase().replace(/[_-]/g, "");

    if (SECRET_KEYS.has(normalised)) {
      output[key] = "[redacted]";
    } else if (PERSONAL_KEYS.has(normalised)) {
      output[key] = maskEfn(entry);
    } else {
      output[key] = redact(entry);
    }
  }

  return output;
}

/**
 * Leaves the last four digits visible.
 *
 * Enough to confirm the right physician's record was submitted when reading a
 * transcript, without putting a full identifier in a terminal or a log.
 */
function maskEfn(value: unknown): unknown {
  if (typeof value !== "string") return "[redacted]";
  if (value.length <= 4) return "[redacted]";
  return `${"*".repeat(value.length - 4)}${value.slice(-4)}`;
}
