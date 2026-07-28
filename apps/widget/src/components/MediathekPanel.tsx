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
 */

import type { MaterialLibrary } from "@ds/sdk";
import { de } from "../locale/de.js";

export function MediathekPanel(props: { library: MaterialLibrary }) {
  if (props.library.groups.length === 0) {
    return <p className="text-sm text-gray-600">{de.library.empty}</p>;
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-gray-900">{de.library.title}</h2>

      {props.library.groups.map((group) => (
        <section key={group.moduleId} className="rounded-lg border border-gray-200">
          <h3 className="border-b border-gray-100 bg-gray-50 px-4 py-2 text-sm font-semibold text-gray-900">
            Materialien zu Modul {group.ordinal + 1}: {group.moduleTitle}
          </h3>

          {group.locked ? (
            <p className="px-4 py-3 text-sm text-gray-500">{de.library.lockedGroup}</p>
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
