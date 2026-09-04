/**
 * Point the installation's own mail sender at the harness's SMTP server, and
 * assert the certificate really arrives (P187-01).
 *
 * ## Why this is here at all
 *
 * `apps/api` has 22 integration tests for certificate delivery and every one
 * ends at a fake `DeliveryChannel` — they assert what the service **handed** the
 * channel. Nothing opened a socket. So compose → connect → STARTTLS → AUTH →
 * transfer-the-PDF had no coverage anywhere, with `delivered` written on the
 * row and every suite green. CLAUDE.md §9.13: an API test cannot assert that a
 * byte reached a mail server.
 *
 * ## Why through the console and not a SQL fixture
 *
 * §9.13's second rule. The rig comes up in the state a real installation is
 * created in — **no sender configured** — and the product's own screen is what
 * configures it, the way `stack.ts` spawns the deploy's own `bucket-cors.js`
 * rather than pre-configuring the bucket. A fixture that wrote the row would
 * pass on an installation where the screen cannot write it.
 *
 * ## Local only, and that is not a gap being tolerated
 *
 * Against a deployment this would overwrite the client's real sender and post
 * to real mailboxes. There is no version of this assertion that is safe there,
 * so the caller guards on `currentTarget().kind` and the deployment keeps the
 * coverage it can have: the journey proves the certificate is *issued*, and the
 * support panel reports what delivery did.
 */

import { expect, type Browser } from "@playwright/test";
import { menu, signInToConsole } from "./console.js";
import { receivedMail, type SinkMessage } from "./mail-sink.js";

export interface SinkAddress {
  readonly host: string;
  readonly port: string;
  readonly username: string;
  readonly password: string;
  readonly logPath: string;
}

/**
 * The harness's mail server, as `globalSetup` handed it to this worker.
 *
 * Throws rather than defaulting: a port that silently became `""` would make
 * the send fail with "no SMTP host configured" and read as a product defect
 * (§9.6 — a missing answer that looks like a real one).
 */
export function sinkAddress(repo: string): SinkAddress {
  const read = (name: string): string => {
    const value = process.env[name];
    if (value === undefined || value === "") {
      throw new Error(
        `${name} is unset. The harness's mail server is started by ` +
          `support/stack.ts and its address is exported in support/global-setup.ts; ` +
          `an empty value here means the spec ran without that setup.`,
      );
    }
    return value;
  };

  return {
    host: read("E2E_SMTP_HOST"),
    port: read("E2E_SMTP_PORT"),
    username: read("E2E_SMTP_USERNAME"),
    password: read("E2E_SMTP_PASSWORD"),
    logPath: `${repo}apps/e2e/test-results/mail.jsonl`,
  };
}

/** The From address the platform sends as, once configured below. */
export const PLATFORM_FROM = "fortbildung@harness.digitalspital.example";

/**
 * Sign in as the super administrator, fill in Sicherheit → E-Mail-Versand der
 * Plattform, and leave.
 *
 * Its own context: the journey deliberately runs its operator and its learner
 * in **one** jar (P66-01), and a third sign-in in that jar would replace the
 * operator's session mid-run. This one is opened, used and closed.
 */
export async function configurePlatformSender(
  browser: Browser,
  sink: SinkAddress,
): Promise<void> {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const email = process.env["E2E_STAFF_EMAIL"];
    const password = process.env["E2E_STAFF_PASSWORD"];
    if (email === undefined || password === undefined) {
      throw new Error("E2E_STAFF_EMAIL/PASSWORD are unset — see support/staff.ts");
    }

    await signInToConsole(page, { email, password });
    await menu(page).getByRole("button", { name: "Sicherheit" }).click();

    await page.locator("#platform-smtp-host").fill(sink.host);
    await page.locator("#platform-smtp-port").fill(sink.port);
    await page.locator("#platform-smtp-username").fill(sink.username);
    await page.locator("#platform-smtp-password").fill(sink.password);
    await page.locator("#platform-smtp-from").fill(PLATFORM_FROM);
    await page.locator("#platform-smtp-from-name").fill("DigitalSpital Fortbildung");

    await page.getByRole("button", { name: "Speichern", exact: true }).click();

    /*
     * The screen's own verdict, not ours.
     *
     * `canSend` is computed by the API from the stored row, so this asserts
     * that the write landed rather than that a form was submitted — which is
     * the difference between P185's fallback being configured and a green
     * click on a save that dropped the field (P41-01).
     */
    await expect(
      page.getByText("Der Versand ist eingerichtet.", { exact: false }),
    ).toBeVisible({ timeout: 15_000 });
  } finally {
    await context.close();
  }
}

/**
 * Wait for a message addressed to `recipient`, and say what did arrive if none
 * does.
 *
 * Polling a file rather than awaiting an event: the sink runs in Playwright's
 * runner process and this runs in a worker, so the log it writes is the only
 * channel between them (`mail-sink.ts`).
 */
export async function waitForMail(
  sink: SinkAddress,
  recipient: string,
  timeoutMs = 60_000,
): Promise<SinkMessage> {
  const deadline = Date.now() + timeoutMs;
  let seen: SinkMessage[] = [];

  while (Date.now() < deadline) {
    seen = receivedMail(sink.logPath);
    const match = seen.find((message) => message.to.includes(recipient));
    if (match !== undefined) return match;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(
    `no e-mail reached the harness's mail server for ${recipient} within ` +
      `${timeoutMs / 1000}s. ` +
      (seen.length === 0
        ? "Nothing at all arrived — the delivery worker is off, the sender is " +
          "not configured, or the certificate was abandoned. " +
          "apps/e2e/test-results/api.log says which."
        : `What did arrive: ${seen.map((m) => `${m.from} → ${m.to.join(", ")}`).join("; ")}`),
  );
}
