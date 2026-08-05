/**
 * The CME seal in the catalogue hero (layout page 01).
 *
 * ## Why this is drawn rather than shipped as an image
 *
 * It is drawn as a **fallback**. A CME seal is an accreditation artefact — it
 * asserts that an Ärztekammer certified the course — so which mark appears, and
 * in what form its owner permits it to be shown, is the customer's business
 * with their Kammer, not ours. `Branding.catalogSealImageUrl` is how they put
 * their own there, and `CatalogHero` prefers it whenever it is set.
 *
 * What is left here is what a project with no seal configured gets: a neutral
 * badge carrying the widget's own wording, in the customer's accent colour.
 * Shipping MEDICE's seal as a bundled asset would put one customer's
 * accreditation mark on every other customer's catalogue.
 *
 * ## Why SVG, and why the rosette is circles rather than a path
 *
 * The layout curves "Zertifizierte" over the top of the badge and "Fortbildung"
 * under it. Curved text is not something CSS does; `textPath` is, it is in
 * every browser this platform supports, and the text stays selectable and
 * readable by a screen reader rather than becoming pixels.
 *
 * The scalloped rim is a ring of overlapping circles on top of one inner
 * circle, all the same fill. A hand-written path would be the "proper" way and
 * is exactly the kind of geometry nobody can review — a scallop out of place by
 * a degree is invisible in a diff and obvious on the screen. Circles at
 * computed angles are checkable by reading two numbers.
 */

import { de } from "../locale/de.js";

/** Lobes around the rim, counted off the layout. */
const LOBES = 16;
/** Where the lobe centres sit, and how big each lobe is, in viewBox units. */
const LOBE_RING = 41;
const LOBE_RADIUS = 7;

const LOBE_CENTRES = Array.from({ length: LOBES }, (_, index) => {
  const angle = (index / LOBES) * Math.PI * 2;
  return {
    cx: 50 + Math.cos(angle) * LOBE_RING,
    cy: 50 + Math.sin(angle) * LOBE_RING,
  };
});

export function CatalogSeal(props: { className?: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      className={props.className}
      role="img"
      // One accessible name for the whole badge. Without it a screen reader
      // reads the two arcs and the middle as three unrelated fragments, in
      // whatever order the DOM happens to put them.
      aria-label={`${de.catalog.sealTop} ${de.catalog.sealMain} ${de.catalog.sealBottom}`}
    >
      <defs>
        {/* Two arcs, drawn in opposite directions so both read left to right:
            the top one over the badge, the bottom one under it. */}
        <path id="ds-seal-top" d="M 18 50 A 32 32 0 0 1 82 50" fill="none" />
        <path id="ds-seal-bottom" d="M 19 50 A 31 31 0 0 0 81 50" fill="none" />
      </defs>

      <g className="fill-cta-500">
        {LOBE_CENTRES.map((lobe) => (
          <circle
            key={`${lobe.cx.toFixed(2)},${lobe.cy.toFixed(2)}`}
            cx={lobe.cx}
            cy={lobe.cy}
            r={LOBE_RADIUS}
          />
        ))}
        <circle cx="50" cy="50" r={LOBE_RING} />
      </g>

      {/* The thin ring inside the rim, as the layout draws it. */}
      <circle
        cx="50"
        cy="50"
        r="34"
        fill="none"
        className="stroke-cta-contrast"
        strokeWidth="1.2"
      />

      <g className="fill-cta-contrast">
        {/* Italic, matching the layout — the two arcs are set in an italic
            face there and it is what makes them read as a stamp rather than
            as a caption. */}
        <text fontSize="8.5" fontWeight="700" fontStyle="italic" letterSpacing="0.3">
          <textPath href="#ds-seal-top" startOffset="50%" textAnchor="middle">
            {de.catalog.sealTop}
          </textPath>
        </text>
        <text fontSize="8.5" fontWeight="700" fontStyle="italic" letterSpacing="0.3">
          <textPath href="#ds-seal-bottom" startOffset="50%" textAnchor="middle">
            {de.catalog.sealBottom}
          </textPath>
        </text>

        {/* The two rules flanking the middle word. Decorative, and the `<g>`
            above is what a screen reader is given instead. */}
        <rect x="36" y="38.5" width="28" height="1.6" rx="0.8" aria-hidden="true" />
        <rect x="36" y="60" width="28" height="1.6" rx="0.8" aria-hidden="true" />

        <text
          x="50"
          y="50.5"
          textAnchor="middle"
          dominantBaseline="central"
          fontSize="23"
          fontWeight="800"
        >
          {de.catalog.sealMain}
        </text>
      </g>
    </svg>
  );
}
