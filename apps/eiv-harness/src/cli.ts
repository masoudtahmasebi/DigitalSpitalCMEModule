/**
 * EIV-FOBI contract test harness CLI (P7-01, extended in P31-01).
 *
 * Reports exactly what was sent and exactly what came back, so that the first
 * contact with the real interface answers "does it behave as documented?" in
 * minutes rather than days (ADR-0005).
 *
 *   pnpm --filter @ds/eiv-harness authenticate
 *   pnpm --filter @ds/eiv-harness veranstaltung
 *   pnpm --filter @ds/eiv-harness gemeldetepunkte
 *   pnpm --filter @ds/eiv-harness push -- --efn 123456789012345
 *   pnpm --filter @ds/eiv-harness push -- --efn … --retract
 *
 * **`veranstaltung` is the one to run first against the test system.** It
 * prints the accredited period and the two point values, which between them
 * settle S11 (what `Veranstaltungsende` is for an on-demand course) and S25
 * (which point flags a completion may claim) — two questions that were
 * otherwise letters to the Ärztekammer.
 *
 * Configuration is entirely environmental — no credential is ever committed:
 *
 *   EIV_HARNESS_BASE_URL   default http://127.0.0.1:4010 (the local mock)
 *                          test system: https://backend-test.eiv-fobi.de
 *   EIV_VNR                Veranstaltungsnummer
 *   EIV_VNR_PASSWORD       password issued with the VNR
 *   EIV_HARNESS_ALLOW_LIVE must be "yes" to target a non-local host
 *
 * ## Why these are `EIV_HARNESS_*` since P180-01
 *
 * They used to be `EIV_BASE_URL` and `EIV_ALLOW_LIVE` — the same names the API
 * read. That was fine while both meant "where this process talks to EIV", and
 * it stopped being fine when the API's moved into the database: the platform's
 * register is now a row an operator sets in the console, and a developer
 * exporting `EIV_BASE_URL` for this CLI would be exporting a name that looks
 * like it configures the running platform and does not.
 *
 * One name, one meaning. This tool is a developer's terminal, run by hand
 * against EIV's test system with credentials EIV support issued for it; the
 * platform is a server filing statutory reports. They were never the same
 * setting and now they do not share a spelling.
 */

import { EivClient, EivError, redact, type EivExchange } from "@ds/eiv-client";
import { formatBerlinIsoDate } from "@ds/domain";

const DEFAULT_BASE_URL = "http://127.0.0.1:4010";

/** What the mock understands. Mirrors `MockBehaviour` in `@ds/eiv-client`. */
const BEHAVIOURS = [
  "success",
  "auth_failure",
  "rate_limited",
  "business_failure",
  "validation_failure",
  "duplicate",
  "locked_event",
  "server_error",
  "timeout",
  "non_json",
];

async function main(): Promise<number> {
  const command = process.argv[2];
  const baseUrl = process.env["EIV_HARNESS_BASE_URL"] ?? DEFAULT_BASE_URL;

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

  /*
   * `--behaviour` drives the mock's failure modes.
   *
   * The mock implements seven and the harness could reach none of them: it
   * reads `x-mock-behaviour` from the request and the CLI had no way to send a
   * header. So the paths the retry queue exists for — a validation rejection
   * that must never be retried, an auth failure, a duplicate, a 5xx, a timeout,
   * a non-JSON body — were exercised by unit tests and by nothing a human could
   * run against a live process.
   *
   * Refused against a non-local host: it is meaningless to the real interface,
   * and a stray header on a live submission is not a thing to find out about
   * afterwards.
   */
  const behaviour = readFlag("--behaviour");
  if (behaviour !== undefined && !isLocal(baseUrl)) {
    console.error("--behaviour drives the local mock and cannot be sent to a real host");
    return 2;
  }
  if (behaviour !== undefined && !BEHAVIOURS.includes(behaviour)) {
    console.error(`--behaviour must be one of: ${BEHAVIOURS.join(", ")}`);
    return 2;
  }

  const client = new EivClient({
    baseUrl,
    vnr,
    vnrPassword,
    ...(behaviour === undefined
      ? {}
      : { extraHeaders: { "x-mock-behaviour": behaviour } }),
  });

  console.warn(`EIV harness -> ${baseUrl}`);
  console.warn(`VNR ${vnr}`);
  if (behaviour !== undefined) console.warn(`mock behaviour: ${behaviour}`);
  console.warn("");

  try {
    switch (command) {
      case "authenticate": {
        const { exchange } = await client.authenticate();
        report("authenticate", exchange);
        return 0;
      }

      /*
       * What EIV holds about this VNR's event.
       *
       * The accredited period is what a `teilnahmedatum` is checked against —
       * outside it the Meldung is refused 406 — and `gesperrt_fuer_veranstalter`
       * says whether reporting is open at all. Both are knowable before a
       * physician is ever promised a point.
       */
      case "veranstaltung": {
        const auth = await client.authenticate();
        const { info, exchange } = await client.getVeranstaltung(auth.token);
        report("veranstaltung", exchange);

        console.warn(`Thema:        ${info.thema ?? "(none)"}`);
        console.warn(`Zeitraum:     ${info.beginn ?? "?"} → ${info.ende ?? "?"}`);
        console.warn(`Kategorie:    ${info.kategorie ?? "?"}`);
        console.warn(
          `Punkte:       basis=${info.punkteBasis ?? "?"} lernerfolg=${info.punkteLernerfolg ?? "?"}`,
        );
        console.warn(`Gesperrt:     ${String(info.gesperrtFuerVeranstalter ?? "?")}`);
        console.warn("");
        console.warn("Zeitraum answers S11; the two Punkte values answer S25.");
        return 0;
      }

      /*
       * What EIV believes it already holds — the reconciliation our own
       * append-only log of *sent* attempts structurally cannot provide.
       */
      case "gemeldetepunkte": {
        const auth = await client.authenticate();
        const { rows, exchange } = await client.getGemeldetePunkte(auth.token, {
          limit: Number(readFlag("--limit") ?? "0"),
          offset: Number(readFlag("--offset") ?? "0"),
        });
        report("gemeldetepunkte", exchange);
        console.warn(`${rows.length} Meldung(en) held by EIV for this VNR.`);
        return 0;
      }

      case "push": {
        const efn = readFlag("--efn");

        if (efn === undefined) {
          console.error("push requires --efn <15 digits>");
          return 2;
        }

        /*
         * The date defaults to today in **Berlin**, not UTC — the same function
         * the production reporter uses, so the harness cannot accidentally
         * prove a formatting the platform does not perform.
         */
        const teilnahmedatum = readFlag("--datum") ?? formatBerlinIsoDate(new Date());

        // A retraction is a normal push with the points zeroed. The record
        // survives at EIV; this is the withdrawal, not a delete.
        const retract = process.argv.includes("--retract");

        const auth = await client.authenticate();
        report("authenticate", auth.exchange);

        const push = retract
          ? await client.retractTeilnahme(efn, teilnahmedatum, auth.token)
          : await client.pushTeilnahme(
              {
                efn,
                punkteBasis: !process.argv.includes("--no-basis"),
                punkteLernerfolg: !process.argv.includes("--no-lernerfolg"),
                punkteReferent: Number(readFlag("--referent") ?? "0"),
                teilnahmedatum,
              },
              auth.token,
            );

        report("push_teilnahme", push.exchange);

        /*
         * The status code, and nothing else. The specification is explicit that
         * `affectedRows` and `messages` are diagnostic rather than contractual,
         * so the harness prints them (they are in the exchange above) and
         * decides on neither.
         */
        console.warn(
          push.accepted
            ? `\n${retract ? "Withdrawn" : "Accepted"} — HTTP ${push.exchange.status}.`
            : "\nNot accepted.",
        );
        return push.accepted ? 0 : 1;
      }

      default:
        console.error(
          "Usage: cli.ts <authenticate|veranstaltung|gemeldetepunkte|push --efn NNNNNNNNNNNNNNN [--datum YYYY-MM-DD] [--retract]>",
        );
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
/**
 * Whether this base URL is the local mock.
 *
 * One definition, two callers: the live guard that refuses to contact a real
 * host without `EIV_HARNESS_ALLOW_LIVE`, and `--behaviour`, which is meaningless
 * anywhere else. Two copies of "is this local" is how one of them eventually
 * says yes where the other says no.
 */
function isLocal(baseUrl: string): boolean {
  let host: string;
  try {
    host = new URL(baseUrl).hostname;
  } catch {
    return false;
  }
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

function checkLiveGuard(baseUrl: string): string | undefined {
  let host: string;

  try {
    host = new URL(baseUrl).hostname;
  } catch {
    return `EIV_HARNESS_BASE_URL is not a valid URL: ${baseUrl}`;
  }

  if (isLocal(baseUrl) || process.env["EIV_HARNESS_ALLOW_LIVE"] === "yes")
    return undefined;

  return [
    `Refusing to contact ${host} without EIV_HARNESS_ALLOW_LIVE=yes.`,
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
