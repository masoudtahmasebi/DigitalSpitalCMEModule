/**
 * Keycloak login for the admin console (P9-01).
 *
 * The flow itself lives in `@ds/oidc`, shared with the standalone portal —
 * two copies of a login flow would be two places to get the `state` check
 * wrong, and that check is the only CSRF defence a browser client owns.
 *
 * What stays here is the console's own binding to it: one client for the
 * lifetime of the tab, keyed by config, and a storage prefix of its own so a
 * developer running the console and the portal on `localhost` does not have
 * one flow's PKCE verifier overwritten by the other's.
 */

import { createOidcClient, LoginFailedError, type Session } from "@ds/oidc";
import type { AdminConfig } from "./config.js";

/**
 * What logging in actually needs.
 *
 * A subset of `AdminConfig`, not the whole thing: the API base and the project
 * slug are the API client's business and have nothing to do with Keycloak.
 * Narrowing it here means a caller cannot pass a config that happens to satisfy
 * the wrong half.
 */
export type LoginConfig = Pick<AdminConfig, "issuer" | "clientId" | "redirectUri">;

export { LoginFailedError };
export type { Session };

/**
 * One client per config, remembered.
 *
 * The session lives inside the client, so asking for a second client would
 * silently produce a second, empty session — which reads as "logged out"
 * immediately after logging in.
 */
let cached:
  { config: LoginConfig; client: ReturnType<typeof createOidcClient> } | undefined;

function clientFor(config: LoginConfig): ReturnType<typeof createOidcClient> {
  if (cached !== undefined && sameConfig(cached.config, config)) return cached.client;
  const client = createOidcClient({
    issuer: config.issuer,
    clientId: config.clientId,
    redirectUri: config.redirectUri,
    storagePrefix: "ds-admin",
  });
  cached = { config, client };
  return client;
}

function sameConfig(a: LoginConfig, b: LoginConfig): boolean {
  return (
    a.issuer === b.issuer && a.clientId === b.clientId && a.redirectUri === b.redirectUri
  );
}

/**
 * The current token, if there is one.
 *
 * Takes no config because every caller is inside a rendered console, which by
 * then has one. Returns `undefined` before the first `completeLogin`.
 */
export function currentSession(): Session | undefined {
  return cached?.client.currentSession();
}

export function beginLogin(config: LoginConfig): Promise<never> {
  return clientFor(config).beginLogin();
}

export function completeLogin(config: LoginConfig): Promise<Session | undefined> {
  return clientFor(config).completeLogin();
}

export function logout(config: LoginConfig): void {
  clientFor(config).logout();
}

/**
 * Drop the remembered client. Test seam only — a fresh module per test file is
 * not enough when several tests in one file need independent sessions.
 */
export function resetAuthForTesting(): void {
  cached = undefined;
}
