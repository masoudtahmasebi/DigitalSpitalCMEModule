/**
 * EIV-FOBI contract test harness CLI (P7-01).
 *
 * Reports exactly what was sent and exactly what came back, so that the first
 * contact with the real interface answers "does it behave as documented?" in
 * minutes rather than days (ADR-0005).
 *
 *   pnpm --filter @ds/eiv-harness authenticate
 *   pnpm --filter @ds/eiv-harness push -- --efn 123456789012345
 *
 * Configuration is entirely environmental — no credential is ever committed:
 *
 *   EIV_BASE_URL        default http://127.0.0.1:4010 (the local mock)
 *   EIV_VNR             Veranstaltungsnummer
 *   EIV_VNR_PASSWORD    password issued with the VNR
 *   EIV_ALLOW_LIVE      must be "yes" to target a non-local host
 */

import { EivClient, EivError, redact, type EivExchange } from "@ds/eiv-client";

const DEFAULT_BASE_URL = "http://127.0.0.1:4010";

async function main(): Promise<number> {
  const command = process.argv[2];
  const baseUrl = process.env["EIV_BASE_URL"] ?? DEFAULT_BASE_URL;

  const guard = checkLiveGuard(baseUrl);
  if (guard !== undefined) {
    console.error(guard);
    return 2;
  }

  const vnr = process.env["EIV_VNR"];
  const vnrPassword = process.env["EIV_VNR_PASSWORD"];

  if (vnr === undefined || vnrPassword === undefined) {
    console.error(
      "EIV_VNR and EIV_VNR_PASSWORD must be set. They are never read from a file in this repository.",
    );
    return 2;
  }

  const client = new EivClient({ baseUrl, vnr, vnrPassword });

  console.warn(`EIV harness -> ${baseUrl}`);
  console.warn(`VNR ${vnr}\n`);

  try {
    switch (command) {
      case "authenticate": {
        const { exchange } = await client.authenticate();
        report("authenticate", exchange);
        return 0;
      }

      case "push": {
        const efn = readFlag("--efn");

        if (efn === undefined) {
          console.error("push requires --efn <15 digits>");
          return 2;
        }

        const { auth, push } = await client.submit(efn);
        report("authenticate", auth.exchange);
        report("push_teilnahme", push.exchange);

        console.warn(
          push.accepted
            ? `\nAccepted. Reference: ${push.reference ?? "(none returned)"}`
            : "\nNot accepted.",
        );
        return push.accepted ? 0 : 1;
      }

      default:
        console.error("Usage: cli.ts <authenticate|push --efn NNNNNNNNNNNNNNN>");
        return 2;
    }
  } catch (error) {
    if (error instanceof EivError) {
      console.error(`\n${error.kind.toUpperCase()}: ${error.message}`);
      console.error(`retryable: ${String(error.retryable)}`);
      if (error.exchange !== undefined) report("failed exchange", error.exchange);
      return 1;
    }

    throw error;
  }
}

/**
 * Refuses to target a non-local host without an explicit opt-in.
 *
 * The supplied VNR is for a real accredited event. A stray run against the live
 * endpoint would create a genuine Punktemeldung crediting a real physician —
 * an action with no undo inside the 7-day correction window, and none at all
 * after it.
 */
function checkLiveGuard(baseUrl: string): string | undefined {
  let host: string;

  try {
    host = new URL(baseUrl).hostname;
  } catch {
    return `EIV_BASE_URL is not a valid URL: ${baseUrl}`;
  }

  const isLocal = host === "127.0.0.1" || host === "localhost" || host === "::1";

  if (isLocal || process.env["EIV_ALLOW_LIVE"] === "yes") return undefined;

  return [
    `Refusing to contact ${host} without EIV_ALLOW_LIVE=yes.`,
    "",
    "The configured VNR belongs to a real accredited event. A submission there",
    "creates a real CME record for a real physician and cannot be withdrawn",
    "once the 7-day correction window closes.",
  ].join("\n");
}

function report(label: string, exchange: EivExchange): void {
  console.warn(`--- ${label} ---`);
  console.warn(`${exchange.method} ${exchange.url}`);
  console.warn(`request:  ${JSON.stringify(redact(exchange.requestBody))}`);
  console.warn(`status:   ${exchange.status} (${exchange.durationMs} ms)`);
  console.warn(`response: ${JSON.stringify(redact(exchange.responseBody))}\n`);
}

function readFlag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
