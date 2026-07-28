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
const mock = await startMockServer(port);

console.warn(`EIV-FOBI mock listening on ${mock.url}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void mock.close().then(() => process.exit(0));
  });
}
