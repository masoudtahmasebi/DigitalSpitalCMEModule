/**
 * A stand-in Keycloak for local development (P52-02).
 *
 * ## What this is, and what it deliberately is not
 *
 * It is a **real OpenID provider with a real RSA keypair**. It publishes a real
 * JWKS and mints really-signed JWTs. The API's token validation is completely
 * untouched by it: signature, issuer, audience and expiry are all still checked
 * exactly as ADR-0003 requires, against a key this process actually holds.
 *
 * That distinction is the whole point. The tempting version of "fake Keycloak"
 * is a flag that makes the guard skip verification — and it would be worse than
 * useless, because every test run against it would prove only that the bypass
 * works. A test that passes on a system with authentication disabled has told
 * you nothing about the system with authentication enabled (CLAUDE.md §9.7).
 * Here, a wrong audience is still a 401, and it is a 401 for the real reason.
 *
 * It is **not** a Keycloak. There is no realm administration, no user
 * federation, no consent, no refresh-token rotation, no login page. It answers
 * the three requests the API and a test client actually make, and 404s the
 * rest. Anything relying on real Keycloak behaviour beyond token issuance has
 * to be tested against the real thing.
 *
 * ## Why it exists
 *
 * `infra/docker-compose.yml` runs a real Keycloak, which is the right answer
 * when Docker is available. It is not always available — a sandbox, a
 * restricted laptop, CI without privileged containers — and until now that
 * meant the two projects whose `identity_provider` is `keycloak` could not be
 * exercised at all locally, while the `local` tenants could. Half the auth
 * surface being untestable is how the other half gets all the attention.
 *
 * ## How the seeded issuers line up
 *
 * The seeds write `http://127.0.0.1:8080/realms/ds-dev` and `…/realms/ds-demo`
 * into `projects.keycloak_issuer`. Binding to 8080 and serving *any* realm name
 * means those rows work untouched — no seed edit, no DB fixup, and therefore
 * nothing to remember to undo. The API derives its JWKS URI as
 * `<issuer>/protocol/openid-connect/certs` (`jwks-registry.ts`), which is the
 * path served below.
 *
 * ## The guards, and why each one is here
 *
 * - **Refuses to run under `NODE_ENV=production`.** A token minter that can be
 *   started in production is a token minter that eventually is.
 * - **Binds loopback only.** Not configurable. Nothing outside this machine
 *   can ask it for a token.
 * - **Generates its keypair at startup, in memory.** Nothing is committed and
 *   nothing persists, so a key from somebody's laptop cannot be replayed
 *   anywhere, and there is no file for `gitleaks` to find or for a reader to
 *   mistake for a real credential.
 * - **Deleted from the runtime image.** This one was written here as a claim
 *   and then checked, and the claim was wrong: `pnpm deploy` in the Dockerfile
 *   copies the whole compiled `dist/`, so the stub *was* being baked into the
 *   API image. The `api` stage now removes it explicitly, with a `rm` that
 *   fails the build rather than a `rm -f` that would silently stop protecting
 *   anything if the layout moved. Nothing in compose or `deploy.sh` runs it.
 *
 * ## Running it
 *
 *   pnpm --filter @ds/api dev:keycloak
 *
 * Then a token for the ADHS project:
 *
 *   curl -s -X POST http://127.0.0.1:8080/realms/ds-dev/protocol/openid-connect/token \
 *     -d grant_type=password -d username=demo@medice.example -d client_id=ds-education-api
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey } from "jose";

/** Keycloak's own path layout, which `jwks-registry.ts` assumes. */
export const CERTS_SUFFIX = "/protocol/openid-connect/certs";
export const TOKEN_SUFFIX = "/protocol/openid-connect/token";
export const DISCOVERY_SUFFIX = "/.well-known/openid-configuration";

/**
 * The audience every minted token carries unless the caller overrides it.
 *
 * Matches `projects.keycloak_audience` in the seeds. A token whose audience
 * does not match the project's is refused by the API — which is a case worth
 * being able to produce on purpose, hence the override.
 */
const DEFAULT_AUDIENCE = "ds-education-api";

const PORT = Number(process.env["DEV_KEYCLOAK_PORT"] ?? 8080);
const KID = "dev-keycloak";

/**
 * Should this refuse to start?
 *
 * Case-insensitive and trimmed, because `NODE_ENV=Production` is a typo
 * somebody makes once and it must not be the difference between refusing and
 * minting tokens on a real host. Pure, so the decision is testable without
 * starting a process or exiting one.
 */
export function refuseInProduction(nodeEnv: string | undefined): boolean {
  return nodeEnv?.trim().toLowerCase() === "production";
}

function exitIfProduction(): void {
  if (!refuseInProduction(process.env["NODE_ENV"])) return;
  console.error(
    "dev-keycloak: refusing to start with NODE_ENV=production.\n" +
      "  This mints bearer tokens for any subject asked of it. It is a\n" +
      "  development tool and has no place anywhere near a real deployment.",
  );
  process.exit(2);
}

/** `/realms/<name>` out of a path, or undefined when the path is not a realm. */
export function realmOf(pathname: string, suffix: string): string | undefined {
  if (!pathname.endsWith(suffix)) return undefined;
  const head = pathname.slice(0, -suffix.length);
  const match = /^\/realms\/([^/]+)$/u.exec(head);
  return match?.[1];
}

async function main(): Promise<void> {
  exitIfProduction();

  const { publicKey, privateKey } = await generateKeyPair("RS256", {
    extractable: true,
  });
  const jwk = { ...(await exportJWK(publicKey)), kid: KID, alg: "RS256", use: "sig" };

  const server = createServer((request, response) => {
    void handle(request, response, jwk, privateKey).catch((error: unknown) => {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: String(error) }));
    });
  });

  // 127.0.0.1, never 0.0.0.0, and not configurable — see the header.
  server.listen(PORT, "127.0.0.1", () => {
    console.warn(
      [
        "",
        "  dev-keycloak — a stand-in OpenID provider for local development.",
        "",
        `  Listening on   http://127.0.0.1:${PORT}  (loopback only)`,
        "  Signing key    RS256, generated just now, in memory, never written",
        "",
        "  It serves any realm name, so the seeded issuers work unchanged:",
        "    /realms/ds-dev    → project medice-adhs",
        "    /realms/ds-demo   → project ds-demo",
        "",
        "  Mint a token:",
        `    curl -X POST http://127.0.0.1:${PORT}/realms/ds-dev${TOKEN_SUFFIX} \\`,
        "      -d grant_type=password -d username=demo@medice.example",
        "",
        "  The API still verifies every token in full — signature, issuer,",
        "  audience, expiry. Nothing here weakens that, which is what makes",
        "  testing against it worth anything.",
        "",
      ].join("\n"),
    );
  });
}

async function handle(
  request: IncomingMessage,
  response: ServerResponse,
  jwk: Record<string, unknown>,
  privateKey: CryptoKey,
): Promise<void> {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${PORT}`);
  const issuerFor = (realm: string): string => `http://127.0.0.1:${PORT}/realms/${realm}`;

  const json = (status: number, body: unknown): void => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body, null, 2));
  };

  // ---------------------------------------------------------------------
  // Discovery. The API does not read it — it derives the certs path — but a
  // browser client and an operator checking the stack both do, and answering
  // it is what makes this recognisably an OpenID provider rather than a JWKS
  // file with delusions.
  // ---------------------------------------------------------------------
  const discoveryRealm = realmOf(url.pathname, DISCOVERY_SUFFIX);
  if (discoveryRealm !== undefined) {
    const issuer = issuerFor(discoveryRealm);
    json(200, {
      issuer,
      authorization_endpoint: `${issuer}/protocol/openid-connect/auth`,
      token_endpoint: `${issuer}${TOKEN_SUFFIX}`,
      jwks_uri: `${issuer}${CERTS_SUFFIX}`,
      userinfo_endpoint: `${issuer}/protocol/openid-connect/userinfo`,
      end_session_endpoint: `${issuer}/protocol/openid-connect/logout`,
      grant_types_supported: ["password", "refresh_token"],
      response_types_supported: ["code"],
      subject_types_supported: ["public"],
      id_token_signing_alg_values_supported: ["RS256"],
    });
    return;
  }

  const certsRealm = realmOf(url.pathname, CERTS_SUFFIX);
  if (certsRealm !== undefined) {
    json(200, { keys: [jwk] });
    return;
  }

  // ---------------------------------------------------------------------
  // Token. A password grant that accepts any password, because there is no
  // user store here and pretending otherwise would only mean maintaining a
  // second list of credentials that has to agree with the seeds.
  //
  // `sub` is the username. That is deliberate: the API provisions a user from
  // (issuer, sub), so a stable username gives a stable participant across
  // restarts, and `demo@medice.example` reaches the seeded learner rather
  // than creating a new one on every token.
  // ---------------------------------------------------------------------
  const tokenRealm = realmOf(url.pathname, TOKEN_SUFFIX);
  if (tokenRealm !== undefined) {
    if (request.method !== "POST") {
      json(405, { error: "invalid_request", error_description: "POST expected" });
      return;
    }

    const form = new URLSearchParams(await readBody(request));
    const username = form.get("username") ?? url.searchParams.get("username");
    if (username === null || username === "") {
      json(400, {
        error: "invalid_request",
        error_description: "username is required — it becomes the token's sub",
      });
      return;
    }

    // Overridable so the refusals can be produced on purpose: a wrong audience
    // and an expired token are both cases the API must reject, and a stub that
    // could only mint valid tokens would leave them untestable.
    const audience =
      form.get("audience") ?? url.searchParams.get("audience") ?? DEFAULT_AUDIENCE;
    const expiresIn =
      form.get("expires_in") ?? url.searchParams.get("expires_in") ?? "1h";

    const issuer = issuerFor(tokenRealm);
    const accessToken = await new SignJWT({
      email: username,
      preferred_username: username,
      email_verified: true,
    })
      .setProtectedHeader({ alg: "RS256", kid: KID })
      .setIssuedAt()
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject(username)
      .setExpirationTime(expiresIn)
      .sign(privateKey);

    json(200, {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: 3600,
      scope: "openid email profile",
    });
    return;
  }

  json(404, {
    error: "not_found",
    error_description:
      "dev-keycloak serves discovery, certs and token for /realms/<name> only",
  });
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => (body += String(chunk)));
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

/*
 * Started only when run directly. Without this the test importing `realmOf`
 * would bind port 8080 as a side effect — a test suite that opens a listening
 * socket for a pure-function assertion is one that fails on a machine where
 * something else already holds the port.
 */
if (process.argv[1]?.endsWith("dev-keycloak.js") === true) void main();
