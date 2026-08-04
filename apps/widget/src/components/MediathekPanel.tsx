/**
 * The Mediathek (P5).
 *
 * Downloads grouped by module, padlocked until that module is complete.
 *
 * The padlock is honest here only because the API made it so: a locked item
 * arrives with `fileUrl: null`. This component could not reveal a locked file
 * if it wanted to, which is the point — a `locked: true` the client merely
 * agrees to respect is not a gate, since anyone holding the token can read the
 * JSON.
 *
 * ## The blur
 *
 * The layout (§4.2) draws a locked group blurred behind a padlock rather than
 * hiding it, so the learner can see that material exists and what unlocks it.
 * The blur is `filter: blur()` over the group's *titles* — which the ungated
 * listing already carries — and never over anything withheld: there is no
 * `fileUrl` under there to un-blur with a devtools inspector. A CSS effect
 * standing in front of a real secret would be theatre; here it is a visual cue
 * in front of data the learner is entitled to.
 *
 * `aria-hidden` on the blurred block, with the lock message given as the
 * section's accessible name: reading out titles that render as an unreadable
 * smear would tell a screen-reader user something the screen does not say.
 */

import type { MaterialLibrary } from "@ds/sdk";
import { de } from "../locale/de.js";
import { moduleTopic } from "../module-title.js";
import { DownloadIcon, ImagePlaceholder, LockIcon } from "./primitives.js";

export function MediathekPanel(props: { library: MaterialLibrary }) {
  if (props.library.groups.length === 0) {
    return <p className="text-sm text-gray-600">{de.library.empty}</p>;
  }

  return (
    <div className="space-y-8">
      <h2 className="text-lg font-bold text-gray-900">{de.library.title}</h2>

      {props.library.groups.map((group) => (
        <section
          key={group.moduleId}
          aria-label={
            group.locked ? de.library.lockedGroupLabel(group.moduleTitle) : undefined
          }
        >
          <h3 className="border-b border-gray-200 pb-2 text-sm text-gray-700">
            {de.library.groupHeading(group.ordinal + 1)}{" "}
            <span className="font-semibold text-gray-900">
              ({moduleTopic(group.ordinal + 1, group.moduleTitle)})
            </span>
          </h3>

          {group.locked ? (
            <div className="relative mt-4">
              <div aria-hidden="true" className="select-none blur-sm">
                <MaterialGrid materials={group.materials} />
                {group.materials.length === 0 ? (
                  // A locked group whose titles the API also withholds still
                  // needs something to blur, or the padlock floats over nothing
                  // and the group reads as empty rather than as locked.
                  <div className="h-40" />
                ) : null}
              </div>

              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center">
                <LockIcon className="h-7 w-7 text-gray-900" />
                <p className="text-sm font-semibold text-gray-900">
                  {de.library.lockedGroup}
                </p>
              </div>
            </div>
          ) : (
            <div className="mt-4">
              <MaterialGrid materials={group.materials} />
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

/**
 * The layout's two-column card grid.
 *
 * The layout draws a thumbnail and a paragraph of description on each card.
 * Neither exists: `Material` in `contracts/openapi.yaml` carries `title`,
 * `mimeType` and `fileSize` and nothing else. Rather than invent them — which
 * would mean a contract change, a column, an admin field and an upload path,
 * none of which this ticket covers — the card keeps the layout's *shape* and
 * fills the secondary line with what the platform actually knows about the
 * file. A placeholder stands where the thumbnail goes so the grid keeps its
 * proportions.
 */
function MaterialGrid(props: {
  materials: MaterialLibrary["groups"][number]["materials"];
}) {
  return (
    <ul className="grid gap-5 sm:grid-cols-2">
      {props.materials.map((material) => (
        <li
          key={material.id}
          className="overflow-hidden rounded-xl border border-gray-200 bg-white"
        >
          <ImagePlaceholder className="h-32 w-full" />
          <div className="p-4">
            <p className="text-sm font-bold leading-snug text-gray-900">
              {material.title}
            </p>
            <p className="mt-1 text-xs text-gray-600">{de.library.fileMeta(material)}</p>

            {material.fileUrl === null ? null : (
              <a
                href={material.fileUrl}
                download
                // The file is served from storage we do not control the
                // referrer policy of; no reason to leak the widget's host page
                // URL to it.
                rel="noreferrer noopener"
                target="_blank"
                className="mt-3 inline-flex items-center gap-2 rounded-full bg-brand-600 px-4 py-1.5 text-xs font-semibold text-brand-contrast hover:bg-brand-700"
              >
                {de.library.download}
                <DownloadIcon className="h-3.5 w-3.5" />
              </a>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
