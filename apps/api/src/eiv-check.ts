/**
 * Prove the EIV connection from the host, read-only (P130-01).
 *
 * Runs from inside the API image the way the migrator and the seeds do, because
 * the production host has no checkout and no workspace:
 *
 *   ./dsc eiv
 *
 * ## Why this exists when `apps/eiv-harness` already does
 *
 * The harness is the developer's instrument: it prints the verbatim exchange,
 * drives every failure behaviour of the mock, and can push and retract. It is
 * also not in the production image, and it never will be — a tool that can file
 * a Punktemeldung is not one to leave lying on a server.
 *
 * This is the operator's instrument, and it is deliberately smaller:
 * **it reads and never writes.** Three questions, in the order they stop being
 * answerable:
 *
 *   1. does the VNR and password authenticate at all?
 *   2. what accredited period and point values does the register hold?
 *   3. what has already been reported for this VNR?
 *
 * Nothing here can create a CME record. `push_teilnahme` is absent on purpose —
 * a filed Punktemeldung cannot be unfiled, only withdrawn, and that leaves its
 * own record. An operator wanting to file a test participation completes a
 * course in the product, which is the path that is actually under test.
 *
 * ## The live guard
 *
 * Mirrors the harness's. A non-local host needs `EIV_CHECK_ALLOW_LIVE=yes`,
 * because the VNR configured on a production installation is a real accredited
 * event — and question 3 above, though read-only, still authenticates against
 * it.
 *
 * ## Why `EIV_CHECK_*` and not the names this used to read (P182-05)
 *
 * It read `EIV_BASE_URL` and `EIV_ALLOW_LIVE`, and its own error message said
 * they "must all be set in config.env". Since P180-01 that is precisely where
 * they may not be: `deploy.sh` refuses a deploy while any of the three remains
 * in that file, and now carries them into `platform_settings` and deletes them.
 * So this tool was instructing an operator to do the one thing that stops the
 * next deploy — and, worse, sharing a spelling with a setting that has moved is
 * how somebody exports a variable believing it configures the server.
 *
 * The same rename, for the same reason, as `EIV_HARNESS_*` in P180-01. These
 * are arguments to one invocation of a diagnostic, supplied on the command
 * line; they configure nothing and are read by nothing else.
 *
 * Exit codes, because an operator and a script both read them:
 *
 *   0  the register answered, and the answers are printed
 *   1  it did not, and the message says which step failed
 *   2  it was not asked, because the configuration refuses to allow it
 */

import { EivClient, EivError, redact, type EivExchange } from "@ds/eiv-client";

/* eslint-disable no-console -- this is a CLI; its output is the point */

function env(name: string): string {
  return process.env[name] ?? "";
}

function isLocal(baseUrl: string): boolean {
  try {
    const { hostname } = new URL(baseUrl);
    return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
  } catch {
    return false;
  }
}

/** The exchange, with the JWT gone and the EFN masked. Never the password. */
function report(label: string, exchange: EivExchange): void {
  console.log(`--- ${label} ---`);
  console.log(`${exchange.method} ${exchange.url}`);
  console.log(`status:   ${String(exchange.status)}`);
  // `redact` walks the parsed body and returns a value, not a string — the JWT
  // removed and the EFN masked. Printing it directly gives "[object Object]",
  // which is what the first run of this produced.
  console.log(`response: ${JSON.stringify(redact(exchange.responseBody))}`);
  console.log("");
}

async function main(): Promise<number> {
  const baseUrl = env("EIV_CHECK_BASE_URL");
  const vnr = env("EIV_VNR");
  const password = env("EIV_VNR_PASSWORD");

  if (baseUrl === "" || vnr === "" || password === "") {
    console.error(
      [
        "EIV_CHECK_BASE_URL, EIV_VNR and EIV_VNR_PASSWORD are all required.",
        "",
        "Pass them to this one invocation — none of them belongs in config.env,",
        "and `deploy.sh` refuses a deploy that finds any of them there. The",
        "register the platform actually reports to is a console setting now",
        "(Plattform → Punktemeldung); the VNR and its password belong to the",
        "course and are encrypted at rest.",
        "",
        "  cd ~/ds-education/repo/infra/deploy",
        "  ./dsc run --rm \\",
        "    -e EIV_CHECK_BASE_URL=https://backend-test.eiv-fobi.de \\",
        "    -e EIV_VNR=… -e EIV_VNR_PASSWORD=… \\",
        "    -e EIV_CHECK_ALLOW_LIVE=yes \\",
        "    --entrypoint node api dist/eiv-check.js",
      ].join("\n"),
    );
    return 2;
  }

  if (!isLocal(baseUrl) && env("EIV_CHECK_ALLOW_LIVE") !== "yes") {
    console.error(
      [
        `Refusing to contact ${new URL(baseUrl).hostname} without EIV_CHECK_ALLOW_LIVE=yes.`,
        "",
        "Even a read authenticates against the VNR you passed, which on a",
        "production installation belongs to a real accredited event.",
        "",
        "For the EIV test system this is safe and expected — add:",
        "  -e EIV_CHECK_ALLOW_LIVE=yes",
      ].join("\n"),
    );
    return 2;
  }

  console.log(`EIV check -> ${baseUrl}`);
  console.log(`VNR ${vnr}`);
  console.log("");

  const client = new EivClient({ baseUrl, vnr, vnrPassword: password });

  try {
    const auth = await client.authenticate();
    report("authenticate", auth.exchange);

    // The token from the first call, threaded through the reads. The client
    // takes it explicitly rather than holding it, so a caller cannot
    // accidentally reuse one across VNRs.
    const event = await client.getVeranstaltung(auth.token);
    report("veranstaltung", event.exchange);

    /*
     * The two facts an operator actually came for.
     *
     * The accredited period is what `teilnahmedatum` has to fall inside — a
     * completion outside it is refused 406, and a one-day period on a
     * twelve-month on-demand course means every completion is refused. That is
     * S11, and this prints the value it turns on.
     */
    console.log(`Zeitraum:  ${event.info.beginn} → ${event.info.ende}`);
    console.log(
      `Punkte:    basis=${String(event.info.punkteBasis)} ` +
        `lernerfolg=${String(event.info.punkteLernerfolg)}`,
    );
    console.log(`Gesperrt:  ${String(event.info.gesperrtFuerVeranstalter)}`);
    console.log("");

    const reported = await client.getGemeldetePunkte(auth.token, { limit: 20 });
    report("gemeldetepunkte", reported.exchange);

    console.log("The register answered every read. Nothing was submitted.");
    return 0;
  } catch (error) {
    if (error instanceof EivError) {
      if (error.exchange !== undefined) report("failed", error.exchange);
      console.error(`EIV refused: ${error.kind}`);
      return 1;
    }
    console.error(
      `Could not reach the register: ${error instanceof Error ? error.message : "unknown"}`,
    );
    return 1;
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
