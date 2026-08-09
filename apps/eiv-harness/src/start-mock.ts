/**
 * Entry point for `pnpm --filter @ds/eiv-harness start:mock`.
 *
 * The mock server itself lives in `@ds/eiv-client`, next to the client it
 * doubles for, so the client's own tests can use it without an app depending
 * on another app. This file is the CLI-shaped wrapper — the single place that
 * decides the port and handles shutdown.
 */

import { startMockServer } from "@ds/eiv-client";

const port = Number(process.env["EIV_MOCK_PORT"] ?? 4010);

/*
 * The accredited period, so the 406 that refuses a Teilnahmedatum outside it
 * can be reproduced by hand (P31-01).
 *
 * Argv rather than environment on purpose: this is a knob for one command in
 * one terminal, and every environment variable this repository reads has to be
 * documented in both templates and is checked by `scripts/env-audit.mjs`. A
 * mock's test fixture does not belong in a deployment's configuration surface.
 *
 *   pnpm --filter @ds/eiv-harness start:mock -- --beginn 2026-01-01 --ende 2026-12-31
 */
function flag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const beginn = flag("--beginn");
const ende = flag("--ende");

const mock = await startMockServer(port, {
  ...(beginn === undefined ? {} : { eventBeginn: beginn }),
  ...(ende === undefined ? {} : { eventEnde: ende }),
});

console.warn(`EIV-FOBI mock listening on ${mock.url}`);
if (beginn !== undefined || ende !== undefined) {
  console.warn(`accredited period ${beginn ?? "-∞"} → ${ende ?? "+∞"}`);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void mock.close().then(() => process.exit(0));
  });
}
