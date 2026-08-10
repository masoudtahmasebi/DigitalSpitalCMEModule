/**
 * A super administrator, created the way a real installation creates one, and
 * a second factor computed the way a phone computes one (P37-01).
 *
 * ## Why the password is parsed out of stdout
 *
 * `bootstrap-admin` generates it, prints it once and stores only an Argon2id
 * hash — deliberately, and the deployment guide says so. There is no flag to
 * choose it, and adding one would be a way to put a known administrator
 * password into an installation, which is precisely what the design refuses.
 *
 * So the harness does what a human does: runs the command and reads what it
 * printed. That also makes this a test of `bootstrap-admin` itself — if it ever
 * stops printing a usable credential, this fails rather than the console.
 *
 * ## Why a real TOTP rather than switching the policy off
 *
 * ADR-0012 makes the platform's second-factor policy `required`, and
 * `super_admin` is the account it matters most for. Setting the e2e database to
 * `disabled` would make the sign-in easy and would mean the browser suite never
 * touches the control that stands between a stolen password and every
 * customer's data.
 *
 * RFC 6238 is thirty lines. Re-implemented here rather than imported from
 * `apps/api`, on the same reasoning as the EIV claim predicate in P32-02: an
 * independent statement of the same rule is the only version worth asserting
 * against. If this and the server ever disagree, that is the finding.
 */

import { createHmac } from "node:crypto";
import { spawnSync } from "node:child_process";

export interface StaffCredentials {
  readonly email: string;
  readonly password: string;
}

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** RFC 4648 §6, unpadded — the encoding authenticator apps take. */
export function decodeBase32(encoded: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];

  for (const character of encoded.toUpperCase().replace(/=+$/u, "")) {
    const index = BASE32.indexOf(character);
    if (index === -1) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >>> bits) & 0xff);
    }
  }

  return Buffer.from(out);
}

/** RFC 4226 §5.3, over the 30-second step RFC 6238 defines. */
export function totpCode(secret: Buffer, at: Date = new Date()): string {
  const counter = Math.floor(at.getTime() / 1000 / 30);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));

  const digest = createHmac("sha1", secret).update(message).digest();
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f;
  const binary =
    (((digest[offset] ?? 0) & 0x7f) << 24) |
    (((digest[offset + 1] ?? 0) & 0xff) << 16) |
    (((digest[offset + 2] ?? 0) & 0xff) << 8) |
    ((digest[offset + 3] ?? 0) & 0xff);

  return String(binary % 1_000_000).padStart(6, "0");
}

/** Run `bootstrap-admin` and read back the credential it printed. */
export function bootstrapSuperAdmin(
  repo: string,
  databaseUrl: string,
  email = "e2e-operator@digitalspital.example",
): StaffCredentials {
  const result = spawnSync(
    "node",
    ["apps/api/dist/bootstrap-admin.js", "--email", email],
    {
      cwd: repo,
      encoding: "utf8",
      env: { ...process.env, DATABASE_URL: databaseUrl },
    },
  );

  if (result.status !== 0) {
    throw new Error(
      `bootstrap-admin failed:\n${result.stdout ?? ""}\n${result.stderr ?? ""}`,
    );
  }

  // "    Passwort  <value>" — the one line of its output this needs.
  const match = /^\s*Passwort\s+(\S+)\s*$/mu.exec(result.stdout ?? "");
  const password = match?.[1];
  if (password === undefined) {
    throw new Error(
      `bootstrap-admin printed no password this harness could read:\n${result.stdout ?? ""}`,
    );
  }

  return { email, password };
}
