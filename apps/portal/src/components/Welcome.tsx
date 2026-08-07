/**
 * The root page (P21-03).
 *
 * ## What it deliberately does not do
 *
 * It names no customer, starts no login, and lists no tenants.
 *
 * The first two are the reported bug. `fortbildung.digitalspital.com/` used to
 * *be* MEDICE — `PORTAL_PROJECT_SLUG` in the deployment said so — and its
 * `Anmelden` ran an OIDC redirect to `login.medice.de` with no link back to
 * anywhere. A visitor who had never heard of MEDICE got MEDICE's login screen
 * and no way out of it.
 *
 * The third is a smaller decision with the same shape. Listing every customer
 * on the platform would be convenient and would also publish, to anybody who
 * loads the root, which pharmaceutical companies DigitalSpital works with and
 * how many. That is a commercial fact belonging to those customers, not routing
 * metadata — so a learner reaches their tenant by the address their provider
 * gave them, exactly as they reach anything else of their provider's.
 */

import { de } from "../locale/de.js";

export function Welcome() {
  return (
    <div className="space-y-6 py-4">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">
          {de.welcome.title}
        </h1>
        <p className="text-base text-gray-700">{de.welcome.lead}</p>
      </div>

      <div className="space-y-3 rounded-md border border-gray-200 bg-gray-50 p-4">
        <p className="text-sm text-gray-700">{de.welcome.body}</p>
        <p className="text-sm text-gray-600">{de.welcome.contact}</p>
      </div>
    </div>
  );
}
