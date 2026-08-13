/**
 * Which installation the journey is driving (P68-03).
 *
 * ## Why one spec has two targets
 *
 * A browser suite that only ever runs against a rig assembled by its own
 * harness cannot see the things the rig does not have: a reverse proxy, its
 * headers, real cookie attributes on a real domain, a real bucket in another
 * region. Every defect the client found on 12.08 lived in that gap — and the
 * suite that missed them was green.
 *
 * So the same file runs in both places. Locally it drives the rig `stack.ts`
 * builds, on every `pnpm test:e2e`, which is what makes it a check the person
 * writing the code actually runs (§9.11). After a deploy it drives the
 * hostnames the client looks at, which is what makes a green deploy mean
 * something. A spec that only ran in the second place would be a check nobody
 * runs while working; one that only ran in the first is the check that was
 * already green while the product was broken.
 *
 * ## Why the tenant is seeded and not created
 *
 * The journey signs in as the DS Test tenant's `customer_admin`. That account
 * exists on the deployed installation because `deploy.sh` seeds it, and exists
 * locally because `prepareDatabase` runs the same seed. Creating a customer
 * instead would need a super administrator, which is a much larger credential
 * to hand a CI job, and would leave a new tenant behind on every deploy.
 *
 * ## §9.9, mechanically
 *
 * *"A report about a running system is a report about a commit."* When the
 * target is a deployment, the run prints the build it is looking at before it
 * asserts anything — so a failure names the commit rather than leaving somebody
 * to wonder whether the fix is even deployed.
 */

import { stripTrailingSlashes } from "@ds/domain";
import { ADMIN_BASE, API_BASE, PORTAL_BASE } from "./stack.js";
import { DS_TEST_STAFF_EMAIL, DS_TEST_STAFF_PASSWORD, DS_TEST_TENANT } from "./world.js";

export interface Target {
  readonly kind: "local" | "deployed";
  readonly portal: string;
  readonly admin: string;
  readonly api: string;
  /** The portal path segment — `/dstest`. */
  readonly tenant: string;
  readonly staffEmail: string;
  readonly staffPassword: string;
}

/**
 * A deployment is named by its URLs; absent them, the local rig.
 *
 * Deliberately not a boolean flag: a run configured with two of the three URLs
 * would be a run pointed half at a deployment, and the failure would look like
 * a product bug. All three or none.
 */
export function currentTarget(): Target {
  const portal = process.env["E2E_PORTAL_URL"];
  const admin = process.env["E2E_ADMIN_URL"];
  const api = process.env["E2E_API_URL"];

  const named = [portal, admin, api].filter(
    (value) => value !== undefined && value !== "",
  );
  if (named.length === 0) {
    return {
      kind: "local",
      portal: PORTAL_BASE,
      admin: ADMIN_BASE,
      api: API_BASE,
      tenant: DS_TEST_TENANT,
      staffEmail: DS_TEST_STAFF_EMAIL,
      staffPassword: DS_TEST_STAFF_PASSWORD,
    };
  }

  if (named.length !== 3) {
    throw new Error(
      "E2E_PORTAL_URL, E2E_ADMIN_URL and E2E_API_URL are set together or not at all — " +
        `${named.length} of the three is a run pointed half at a deployment.`,
    );
  }

  const password = process.env["SEED_TEST_STAFF_PASSWORD"];
  if (password === undefined || password === "") {
    throw new Error(
      "the smoke run needs SEED_TEST_STAFF_PASSWORD — the same value the deploy seeded " +
        "the DS Test operator with. Without it this run cannot sign in, and a smoke test " +
        "that cannot sign in must say so rather than skip.",
    );
  }

  return {
    kind: "deployed",
    portal: trimSlash(portal!),
    admin: trimSlash(admin!),
    api: trimSlash(api!),
    tenant: DS_TEST_TENANT,
    staffEmail: DS_TEST_STAFF_EMAIL,
    staffPassword: password,
  };
}

/**
 * `@ds/domain`'s, not a local regex: an anchored `/+$` backtracks quadratically
 * and the lint rule that says so is right — a URL out of the environment is not
 * bounded by construction.
 */
function trimSlash(url: string): string {
  return stripTrailingSlashes(url);
}

/**
 * Which build is behind this URL, from `/metrics`' `ds_build_info` (§9.9).
 *
 * Best effort: a deployment that does not expose metrics publicly answers 401
 * or 404, and that is not a reason to fail a smoke run. What it must not do is
 * claim to know — hence the explicit "unknown", printed as such.
 */
export async function buildBehind(api: string): Promise<string> {
  try {
    const response = await fetch(`${api}/metrics`);
    if (!response.ok) return `unknown (/metrics answered ${response.status})`;
    const commit = /ds_build_info\{[^}]*commit="([^"]+)"/u.exec(await response.text());
    return commit?.[1] ?? "unknown (/metrics carries no ds_build_info)";
  } catch (error) {
    return `unknown (${error instanceof Error ? error.message : String(error)})`;
  }
}
