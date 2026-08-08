/**
 * Signing a member of staff in, over real HTTP, second factor and all.
 *
 * ## Why this is shared rather than written twice
 *
 * `super_admin` requires TOTP (`secondFactorStep`), so "sign in" is not one
 * `fetch` — it is a login that answers `totp_enrolment_required`, an enrolment
 * that returns an `otpauth://` URI, a base32 secret decoded out of that URI, a
 * time-based code, and a verify. Five steps, none of them the interesting part
 * of any test that needs a signed-in operator.
 *
 * `hierarchy.integration.test.ts` had the only copy, and the journey suite
 * needed the same five steps. A second copy would have been the third place
 * this project has learned that lesson — and the copies drift towards whichever
 * suite last had a reason to touch them.
 *
 * ## What it deliberately does not do
 *
 * Create the account. Who may hold which grant is the question `hierarchy`
 * exists to ask, and a helper that also seeded staff would decide it.
 */

import { totpCode } from "../../../src/modules/staff/totp.js";

export interface StaffSession {
  /** `ds_staff_session=…`, ready to use as a `cookie` header. */
  readonly cookie: string;
  /** Required on every mutating request (P22-04). */
  readonly csrf: string;
  /**
   * The TOTP secret this session enrolled, when it enrolled one.
   *
   * Returned because signing the *same* account in twice needs it — the second
   * login answers `totp_required` and there is no way to re-read the secret.
   */
  readonly secret: Buffer | undefined;
}

export interface StaffSignIn {
  readonly baseUrl: string;
  readonly email: string;
  readonly password: string;
  /** For an account that has already enrolled a second factor. */
  readonly knownSecret?: Buffer | undefined;
}

export async function signInStaff(input: StaffSignIn): Promise<StaffSession> {
  const post = async (path: string, body: unknown) => {
    const response = await fetch(`${input.baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { response, body: (await response.json()) as Record<string, unknown> };
  };

  const first = await post("/admin/auth/login", {
    email: input.email,
    password: input.password,
  });
  const status = first.body["status"];

  if (status === "signed_in") {
    return sessionFrom(first.response, first.body["csrfToken"], undefined);
  }

  const challenge = first.body["challenge"];
  if (typeof challenge !== "string") {
    throw new Error(`sign-in failed for ${input.email}: ${JSON.stringify(first.body)}`);
  }

  let secret: Buffer;
  if (status === "totp_enrolment_required") {
    const enrol = await post("/admin/auth/totp/enrol", { challenge });
    secret = secretFromUri(String(enrol.body["otpauthUri"]));
  } else if (status === "totp_required" && input.knownSecret !== undefined) {
    secret = input.knownSecret;
  } else {
    throw new Error(`unexpected second-factor state: ${String(status)}`);
  }

  const verified = await post("/admin/auth/totp/verify", {
    challenge,
    code: totpCode(secret, Math.floor(Date.now() / 1000 / 30)),
  });
  if (verified.body["status"] !== "signed_in") {
    throw new Error(`TOTP failed for ${input.email}: ${JSON.stringify(verified.body)}`);
  }

  return sessionFrom(verified.response, verified.body["csrfToken"], secret);
}

function sessionFrom(
  response: Response,
  csrf: unknown,
  secret: Buffer | undefined,
): StaffSession {
  // Named, not positional: the response carries two `Set-Cookie` headers, and
  // taking the first one sometimes sends the CSRF cookie as the session and
  // 401s.
  const cookie = response.headers
    .getSetCookie()
    .find((entry) => entry.startsWith("ds_staff_session="))
    ?.split(";")[0]
    ?.split("=")[1];

  if (cookie === undefined || typeof csrf !== "string") {
    throw new Error("signed in without a cookie or CSRF token");
  }
  return { cookie: `ds_staff_session=${cookie}`, csrf, secret };
}

/** Decode the base32 secret out of an `otpauth://` URI, as an app would. */
function secretFromUri(uri: string): Buffer {
  const encoded = new URL(uri).searchParams.get("secret");
  if (encoded === null) throw new Error("otpauth URI carried no secret");

  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const character of encoded) {
    value = (value << 5) | alphabet.indexOf(character);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}
