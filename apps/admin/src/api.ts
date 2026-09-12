/**
 * The console's API clients.
 *
 * Everything network-facing goes through `@ds/sdk`, whose types come from
 * `contracts/openapi.yaml` — no component here calls `fetch`.
 *
 * ## Two clients, because there are two kinds of screen
 *
 * Since ADR-0012 the console authenticates with a staff session cookie rather
 * than a Keycloak bearer token. The cookie is httpOnly, so nothing here reads
 * it; what the client does carry is `credentials: "include"` and the CSRF
 * token, which is the half of the double-submit check the page is allowed to
 * know.
 *
 * The two differ in one header. Tenant screens send `X-DS-Customer`, which pins
 * which customer the request acts within. **Platform screens must not**: the
 * customer registry spans customers, and creating the first one has to work
 * before any customer exists — which is exactly the state a fresh installation
 * is in. A client that always sent one would 403 the one operator able to fix
 * that.
 *
 * ## Why a customer id and not a project slug (P22-03)
 *
 * It was a project slug, from `ADMIN_DEFAULT_PROJECT_SLUG` in the deployment.
 * Two things wrong with that, and the second is worse.
 *
 * The deployment named one project for the whole console, so a super
 * administrator could not act inside any other customer — and if the named
 * project did not exist, every tenant screen answered 404 while the platform
 * screens worked. That was reported from production, twice, and the second
 * time only because the first fix turned a misleading 401 into an honest 404.
 *
 * And **creating a project is itself a tenant-scoped write**. It needed a
 * project header, which needed a project. A customer with none had no way to
 * get one — which is every customer on the day it is created, and every fresh
 * installation.
 *
 * On a 401 there is no silent refresh. An opaque server-side session either
 * exists or does not; there is nothing to refresh with, and the honest
 * behaviour for an expired admin session is the login form.
 */

import {
  ApiError,
  createClient,
  isForbidden,
  problemCorrelationId,
  problemDetail,
  type ApiClient,
} from "@ds/sdk";
import { currentCsrfToken } from "./staff-auth.js";
import { de } from "./locale/de.js";

/**
 * The sentence used when the API sent no readable `detail` (P205-01).
 *
 * From the locale table rather than written here, so the wrapper says the same
 * thing every screen's own catch already says.
 */
const GENERIC_FAILURE = de.error.generic;
import type { AdminConfig } from "./config.js";

/**
 * Where a failure goes when no screen catches it (P205-01).
 *
 * A ref rather than a parameter because `staffClient` is a plain function built
 * before the shell renders, and the publisher is a React thing that does not
 * exist yet at that moment. The shell sets it; until it does, the default is a
 * no-op, so a client built in a test or before mount cannot throw for want of a
 * toast host.
 */
export const toastPublisher: { current: (text: string) => void } = {
  current: () => undefined,
};

export function createAdminClient(
  config: AdminConfig,
  customerId: string,
  onExpired: () => void,
): ApiClient {
  return staffClient(config.apiBase, customerId, onExpired);
}

/** For screens above any tenant — the customer registry (P12-04). */
export function createPlatformClient(
  config: AdminConfig,
  onExpired: () => void,
): ApiClient {
  return staffClient(config.apiBase, undefined, onExpired);
}

function staffClient(
  baseUrl: string,
  customerId: string | undefined,
  onExpired: () => void,
): ApiClient {
  const client = createClient({
    baseUrl,
    customerId,
    credentials: "include",
    getCsrfToken: currentCsrfToken,
    onUnauthorized: async () => {
      onExpired();
      return undefined;
    },
  });

  return announcing(client);
}

/**
 * Every rejected request says something (P205-01).
 *
 * The floor under 48 hand-written channels: a screen may still show its own
 * message with the context a toast cannot carry, and a screen that shows
 * nothing — or writes into a state its own reload clears, which is the defect
 * this came from — is no longer silent.
 *
 * A `Proxy` rather than 100 wrapped methods: `ApiClient` grows a method
 * whenever the contract does, and a hand-maintained list is a list that will be
 * one short. The wrapper is transparent — it re-throws, always, so every
 * existing `catch` behaves exactly as before.
 *
 * `401` and `403` are skipped: the console routes both already, to the login
 * form and to the "not an admin" screen.
 *
 * ## And one status on one method, which is a different kind of skip
 *
 * See `ANSWERS_WITH_NOT_FOUND`. That one is not "the console handles this
 * elsewhere" — it is "this is not a failure at all".
 */

/**
 * Calls whose **404 is an answer**, not a failure.
 *
 * `GET /admin/branding/font` 404s deliberately when a project has never had a
 * font uploaded: *"there is no font"* and *"there is no project"* are the same
 * answer on purpose, because a font must not be evidence that a tenant exists
 * (§9.5, and `branding.controller.ts` says so). Having no custom font is the
 * normal state of every customer who has not uploaded one — which, today, is
 * all of them.
 *
 * ## How this got shipped, which is the part worth keeping
 *
 * Two correct changes, layered, producing a wrong result:
 *
 * - **P22-08** found "Bitte versuchen Sie es später erneut." on the screen of
 *   every customer who had simply not uploaded a font, and fixed it —
 *   `BrandingSettings` catches the 404 and renders an empty upload form. That
 *   fix is still there and still right.
 * - **P205-01** then added the net above, one layer up, so that no rejected
 *   request could be silent. It cannot know that this particular rejection is
 *   an answer, so it announced it — **before** the component's own handler ran,
 *   and into a toast the component does not own and cannot clear.
 *
 * The result: opening Erscheinungsbild raised "Bitte versuchen Sie es später
 * erneut. (Referenz: …)", and because the toast outlives the screen (which is
 * deliberate — see `withToasts`) it followed the operator onto Texte,
 * Sicherheit and Mediathek. Reproduced in the browser before being fixed; the
 * toast carried the same reference id on all four screens, which is what said
 * it was one event and not four.
 *
 * It is also §9.4 twice over: the sentence is *advice*, and the advice is
 * wrong. Trying again later will 404 for ever.
 *
 * ## Why a table and not "skip every 404"
 *
 * Because a 404 is usually exactly what it says. A course opened from a stale
 * link, a participant deleted in another tab — those must still be announced,
 * and they are the reason the net exists. What is special here is the
 * **route**, not the status.
 *
 * The table is keyed by SDK method name, which is what the `Proxy` below has.
 * It is deliberately short and deliberately reasoned: an entry is a claim that
 * the API returns this status as a normal answer, and it needs the sentence
 * saying why.
 */
const ANSWERS_WITH_NOT_FOUND: ReadonlySet<string> = new Set(["adminGetFont"]);

function announcing(client: ApiClient): ApiClient {
  return new Proxy(client, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown;
      if (typeof value !== "function") return value;

      const name = typeof property === "string" ? property : "";

      return (...args: unknown[]) => {
        const result = (value as (...a: unknown[]) => unknown).apply(target, args);
        if (!(result instanceof Promise)) return result;

        return result.catch((error: unknown) => {
          if (announceable(name, statusOf(error))) {
            toastPublisher.current(describeError(error, GENERIC_FAILURE));
          }
          // Re-thrown always, so every existing `catch` behaves exactly as
          // before — including the ones that treat a 404 as an answer.
          throw error;
        });
      };
    },
  });
}

/**
 * Whether this rejection is something to tell the operator about.
 *
 * Separated from the `Proxy` so it can be tested without one — the question
 * "does a font 404 raise a toast?" is a pure one, and answering it needed a
 * browser and a signed-in console (§9.7 in the direction it is usually stated
 * the other way round: here the caller is covered and the rule was not).
 */
export function announceable(method: string, status: number | undefined): boolean {
  if (status === 401 || status === 403) return false;
  if (status === 404 && ANSWERS_WITH_NOT_FOUND.has(method)) return false;
  return true;
}

/** The status of a problem-details failure, or `undefined` for anything else. */
function statusOf(error: unknown): number | undefined {
  if (!(error instanceof ApiError)) return undefined;
  return error.problem.status;
}

/**
 * A German sentence for a failure, without leaking internals.
 *
 * The predicates and the `detail` extraction come from `@ds/sdk`, which owns
 * `ApiError`; what stays here is the copy, because an admin on a settings
 * screen and a physician mid-video need different words for the same status.
 *
 * A 403 gets the generic line on purpose: the API's own detail for a refused
 * admin action is written for a developer reading a log, and telling an admin
 * which role they lack is more than they need to act on it.
 */
export function describeError(error: unknown, generic: string): string {
  /*
   * A refusal is not a failure, and must not be answered with advice to retry
   * (P225-05).
   *
   * This read `isForbidden(error) ? generic : …`, and `generic` is *"Bitte
   * versuchen Sie es später erneut."* at every call site in the console. So a
   * 403 — an operator doing something their role does not permit — was told to
   * try again later, which will refuse for ever. Same §9.4 shape as the
   * `adminGetFont` toast above: the sentence is advice, and the advice is
   * wrong.
   *
   * The reason a 403 does not carry the API's own `detail` is unchanged and
   * still right: that text is written for a developer reading a log, and
   * naming the missing role tells an operator more than they need in order to
   * act. What changes is the substitute.
   *
   * This reaches every inline error channel in the console, because all of
   * them call this function — which is the point. The global toast is a
   * separate path and stays silent on 403 (see `announceable`), so the
   * operator gets one message, not two.
   */
  const sentence = isForbidden(error)
    ? de.error.forbidden
    : (problemDetail(error) ?? generic);

  /*
   * The correlation id, appended (P122-01).
   *
   * The API has minted one per failure and returned it on every error response
   * since observability landed, and no client read it — so the single string
   * that finds the failing request in the server log reached the payload and
   * stopped there. Somebody reporting "it did not work" could not hand over the
   * thing that would locate it, because nothing showed it to them.
   *
   * Appended to the sentence rather than given its own element: an operator
   * copying an error message copies the whole line, and an id in a separate
   * box is an id that does not travel with the report.
   *
   * Safe to render. It is a random UUID identifying a log line, never a person
   * (§9.5), and `problem-details.ts` guarantees the sentence beside it carries
   * no identifiers either.
   */
  const id = problemCorrelationId(error);
  return id === undefined ? sentence : `${sentence} (Referenz: ${id})`;
}

// Re-exported so components import their failure vocabulary from one place
// rather than reaching into the SDK for some of it and this file for the rest.
export { isForbidden, isUnauthenticated } from "@ds/sdk";
