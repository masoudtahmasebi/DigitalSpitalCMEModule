/**
 * Validate this container's configuration without starting anything (P45-01).
 *
 * ## The failure this exists to prevent
 *
 * The API refused to boot:
 *
 * ```
 * Fatal error during bootstrap: Error: Invalid configuration:
 *   S3_ENDPOINT: must start with https:// — a Hetzner console shows the bare
 *   host (nbg1.your-objectstorage.com); the API needs https://nbg1...
 * ```
 *
 * That message is exactly right, and it arrived in the worst possible place: in
 * a container's log, on restart number nine, after `deploy.sh` had already
 * built four images, taken a backup, run migrations and swapped the stack. What
 * the operator saw was `dependency failed to start: container
 * ds-education-api-1 is unhealthy`, and the sentence naming the variable was
 * reachable only by knowing to run `docker logs`.
 *
 * The deploy's preflight validates a dozen variables and could not have caught
 * this one, because the rule lives in `config.ts` — a Zod `refine` with a
 * message written for exactly this mistake. Copying the rule into `deploy.sh`
 * would be a second implementation of a validator, which is how the two
 * migration runners went wrong (`@ds/migrator`).
 *
 * So the image validates its own configuration, through the same `loadConfig`
 * the server calls, and the deploy runs it as a one-shot container **before**
 * it touches anything. One schema, two callers, and a bad value costs a build
 * instead of an outage.
 *
 *   ./dsc run --rm --no-deps --entrypoint node api dist/check-config.js
 *
 * ## Why it prints no values
 *
 * `loadConfig` reports issues by path and message — `S3_ENDPOINT: must start
 * with https://` — never by value. The environment it is reading contains the
 * database password and the KMS key, and a validator that echoed its input
 * would put both in a deploy log (CLAUDE.md §9.5).
 */

import { loadConfig } from "./config/config.js";

try {
  loadConfig();
  // eslint-disable-next-line no-console -- this is a CLI; its output is the point
  console.log("check-config: this container's configuration is valid.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "unknown error");
  console.error(
    "\nThese come from ~/ds-education/config.env on the host, through the\n" +
      "`environment:` block of infra/deploy/docker-compose.prod.yml. Fix the\n" +
      "value there and re-run the deploy — nothing has been changed.",
  );
  process.exit(1);
}
