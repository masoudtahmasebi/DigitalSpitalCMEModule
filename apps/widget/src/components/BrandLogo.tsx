import { useBranding } from "../branding.js";

/**
 * The customer's logo, when they have set one.
 *
 * Not a prop threaded from the element: a branding failure must not delay or
 * break the course render, and the colours are applied separately by
 * `element.ts` and do not depend on this at all. `useBranding` de-duplicates
 * the request, so the two places this renders and the catalogue hero share one
 * unauthenticated fetch rather than issuing three.
 *
 * `alt` is never derived: `parseBranding` refuses a logo without one, so if
 * this renders, the text came from the customer.
 */
export function BrandLogo(props: { apiBase: string; projectSlug: string }) {
  const branding = useBranding(props.apiBase, props.projectSlug);

  if (branding.logoUrl === undefined) return null;

  return (
    <img
      src={branding.logoUrl}
      alt={branding.logoAlt ?? ""}
      className="max-h-12 w-auto"
      // The logo is a customer asset on a customer CDN; no reason to tell it
      // which page a physician is reading.
      referrerPolicy="no-referrer"
    />
  );
}
