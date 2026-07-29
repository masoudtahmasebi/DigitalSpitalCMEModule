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
import { LockIcon } from "./primitives.js";

export function MediathekPanel(props: { library: MaterialLibrary }) {
  if (props.library.groups.length === 0) {
    return <p className="text-sm text-gray-600">{de.library.empty}</p>;
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-gray-900">{de.library.title}</h2>

      {props.library.groups.map((group) => (
        <section
          key={group.moduleId}
          className="rounded-lg border border-gray-200"
          aria-label={
            group.locked ? de.library.lockedGroupLabel(group.moduleTitle) : undefined
          }
        >
          <h3 className="border-b border-gray-100 bg-gray-50 px-4 py-2 text-sm font-semibold text-gray-900">
            Materialien zu Modul {group.ordinal + 1}: {group.moduleTitle}
          </h3>

          {group.locked ? (
            <div className="relative">
              <ul
                aria-hidden="true"
                className="select-none divide-y divide-gray-100 blur-sm"
              >
                {group.materials.map((material) => (
                  <li
                    key={material.id}
                    className="flex items-center justify-between gap-3 px-4 py-3"
                  >
                    <span className="text-sm text-gray-800">{material.title}</span>
                    <span className="text-sm font-semibold text-brand-700">
                      {de.library.download}
                    </span>
                  </li>
                ))}
                {group.materials.length === 0 ? (
                  // A locked group whose titles the API also withholds still
                  // needs something to blur, or the padlock floats over nothing
                  // and the group reads as empty rather than as locked.
                  <li className="px-4 py-6" />
                ) : null}
              </ul>

              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-white/60 px-4 text-center">
                <LockIcon className="h-5 w-5 text-status-locked" />
                <p className="text-sm font-medium text-gray-700">
                  {de.library.lockedGroup}
                </p>
              </div>
            </div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {group.materials.map((material) => (
                <li
                  key={material.id}
                  className="flex items-center justify-between gap-3 px-4 py-3"
                >
                  <span className="text-sm text-gray-800">{material.title}</span>
                  <span className="flex items-center gap-3">
                    {material.fileSize === null ? null : (
                      <span className="text-xs text-gray-500">
                        {de.library.size(material.fileSize)}
                      </span>
                    )}
                    {material.fileUrl === null ? null : (
                      <a
                        href={material.fileUrl}
                        download
                        // The file is served from storage we do not control the
                        // referrer policy of; no reason to leak the widget's
                        // host page URL to it.
                        rel="noreferrer noopener"
                        target="_blank"
                        className="text-sm font-semibold text-brand-700 underline"
                      >
                        {de.library.download}
                      </a>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
