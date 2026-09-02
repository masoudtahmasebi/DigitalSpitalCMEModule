/**
 * What Keycloak binding a seed may write to a federated project (P101-03).
 *
 * ## The defect this exists to make impossible
 *
 * `medice-adhs` is reached from MEDICE's WordPress and authenticates against
 * MEDICE's own realm. Its `keycloak_issuer` came from the seed as:
 *
 * ```ts
 * process.env["KEYCLOAK_ISSUER"] ?? "http://127.0.0.1:8080/realms/ds-dev"
 * ```
 *
 * Two things then compounded, and neither was visible from anywhere:
 *
 * 1. **`KEYCLOAK_ISSUER` is not in `infra/deploy/config.env.example`.** It was
 *    never a variable a production host was asked for, so on every installation
 *    the platform has ever had it was unset and the `??` branch was taken. The
 *    project was bound to a Keycloak on the API container's own loopback, which
 *    is nothing.
 * 2. **The upsert clobbered it on every deploy** —
 *    `SET keycloak_issuer = EXCLUDED.keycloak_issuer` — so an operator who
 *    corrected the value in the console had it silently reverted by the next
 *    deploy. That is the half that makes this a *recurring* fault rather than a
 *    one-time misconfiguration, and it is why "fix it in the console" was not an
 *    answer on its own.
 *
 * The symptom is a bare `401` on `GET /courses` with a token that is real,
 * unexpired and correctly signed — the guard is comparing `iss` against a
 * localhost URL. Every 401 reason is deliberately identical to the client
 * (ADR-0003), so the browser cannot say which of four things went wrong, and
 * the plugin's own check reports "Aktiv, und für Ihre Sitzung liegt ein Token
 * vor" because on its side everything *is* fine.
 *
 * ## The rule
 *
 * **A seed never invents a Keycloak binding.** Either the environment states
 * one, or the project is written with none — which is an honest "unconfigured"
 * the console shows as empty fields and the token verifier reports as
 * `provider_not_configured`, rather than a plausible wrong answer that fails
 * as `wrong_issuer` four layers away.
 *
 * No dev-versus-production detection anywhere here, deliberately: that is a
 * guess, and a wrong guess reintroduces exactly this bug. The only question
 * asked is whether somebody *stated* a value. Dev and the e2e rig both set
 * `KEYCLOAK_ISSUER` explicitly (see `apps/e2e/support/stack.ts` and
 * `.env.example`), so they are unaffected.
 *
 * ## Why loopback is called out separately
 *
 * Refusing to *write* the default does nothing for the installations that
 * already carry it — and ours does. So `bindingProblem` reads the row back and
 * rejects a loopback issuer **when the environment did not ask for one**. A
 * developer who sets `KEYCLOAK_ISSUER=http://127.0.0.1:8080/...` meant it and
 * is left alone; a production host that never set anything and holds a
 * localhost issuer is a project that cannot authenticate a single physician,
 * and the seed says so instead of finishing green.
 *
 * Pure — no I/O, no clock, no `process.env` read of its own. The environment is
 * an argument, so every branch below is exercised by a unit test rather than by
 * a deployment.
 */

/** The binding a seed will write. `null` means "leave the column empty". */
export interface SeedKeycloakBinding {
  readonly issuer: string | null;
  readonly audience: string | null;
  readonly realm: string | null;
}

/**
 * What a seed should write, given the values its caller read.
 *
 * The three raw strings are arguments rather than an environment prefix this
 * function expands, and that is not a style choice: `scripts/env-audit.mjs`
 * finds a variable by looking for a literal subscript on `process.env`, so a
 * name assembled from a template literal is a name no gate can see. Building
 * them here made `DS_DEMO_KEYCLOAK_ISSUER` read as documented-but-dead within a
 * minute of writing it — the audit was right, and the fix is to keep every
 * variable spelled out at the one place it is read.
 *
 * `realm` is derived from the issuer's last path segment when it is not stated
 * — Keycloak issuers end in `/realms/<name>` by construction, so the value is
 * read off the thing that has to be right anyway rather than typed a second
 * time and drifting. Not derivable, not stated: `null`.
 */
export function seedKeycloakBinding(stated: {
  readonly issuer?: string | undefined;
  readonly audience?: string | undefined;
  readonly realm?: string | undefined;
}): SeedKeycloakBinding {
  const issuer = nonEmpty(stated.issuer);
  const audience = nonEmpty(stated.audience);
  const realm = nonEmpty(stated.realm) ?? realmOf(issuer);

  return { issuer, audience, realm };
}

/**
 * The sentence a seed prints and dies on, or `undefined` when the project is
 * fit to authenticate somebody.
 *
 * Takes the **stored** row rather than the environment: the point is what the
 * database now holds, which after an upsert that preserves operator edits is
 * not necessarily what this process would have written.
 */
export function bindingProblem(input: {
  readonly projectSlug: string;
  readonly stored: SeedKeycloakBinding;
  /** Whether the environment stated an issuer at all. */
  readonly issuerRequested: boolean;
}): string | undefined {
  const { projectSlug, stored } = input;

  if (stored.issuer === null || stored.audience === null) {
    return unconfigured(projectSlug, stored);
  }

  if (!input.issuerRequested && isLoopback(stored.issuer)) {
    return [
      `Project "${projectSlug}" is bound to a Keycloak on loopback:`,
      `  ${stored.issuer}`,
      "",
      "That is a development default a previous seed wrote, and it is why every",
      "learner arriving from the customer's site gets 401 with a token that is",
      "otherwise valid — the API compares the token's `iss` against this URL.",
      "",
      ...remedy(projectSlug),
    ].join("\n");
  }

  return undefined;
}

function unconfigured(projectSlug: string, stored: SeedKeycloakBinding): string {
  const missing = [
    stored.issuer === null ? "issuer" : undefined,
    stored.audience === null ? "audience" : undefined,
  ].filter((field): field is string => field !== undefined);

  return [
    `Project "${projectSlug}" is a federated (Keycloak) project and has no ${missing.join(" and ")}.`,
    "",
    "Nothing was invented for it: a seeded guess here fails later as a 401 that",
    "names nothing (P101-03). The project exists and cannot authenticate anyone",
    "until the values below are set.",
    "",
    ...remedy(projectSlug),
  ].join("\n");
}

/**
 * Both ways out, in the order somebody should try them.
 *
 * The console first, because it needs no deployment and is where an operator
 * already is; the variables second, because a fresh installation wants them in
 * `config.env` before the first seed rather than a manual step afterwards
 * (§9.9 — a documented manual step is a step that does not happen).
 */
function remedy(projectSlug: string): readonly string[] {
  return [
    "Set them in one of two places:",
    `  - Verwaltung -> Organisation -> Projekte -> ${projectSlug} -> Bearbeiten`,
    "    (Issuer, Audience, Realm — takes effect immediately, no deploy)",
    "  - or KEYCLOAK_ISSUER / KEYCLOAK_AUDIENCE in the host's config.env,",
    "    then re-run this seed.",
    "",
    "A value already stored is never overwritten by a re-run of this seed.",
  ];
}

/**
 * `http://127.0.0.1:8080/...`, `http://localhost/...`, `http://[::1]/...`.
 *
 * Hostname only. A port is not what makes an address unreachable from a
 * physician's browser, and matching on `:8080` would miss the same mistake made
 * on a different port.
 */
function isLoopback(issuer: string): boolean {
  let host: string;
  try {
    host = new URL(issuer).hostname.toLowerCase();
  } catch {
    // Not a URL at all. `bindingProblem` is not the field validator — the API's
    // own DTO refuses this — and reporting it here as "loopback" would be a
    // second, wrong diagnosis of the same row.
    return false;
  }

  return (
    host === "localhost" ||
    host === "::1" ||
    host === "[::1]" ||
    host.endsWith(".localhost") ||
    /^127\./u.test(host)
  );
}

/** `https://login.example.com/auth/realms/medicerealm` → `medicerealm`. */
function realmOf(issuer: string | null): string | null {
  if (issuer === null) return null;
  const segments = issuer.split("/").filter((segment) => segment !== "");
  const last = segments[segments.length - 1];
  return last === undefined || last === "" ? null : last;
}

function nonEmpty(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}
