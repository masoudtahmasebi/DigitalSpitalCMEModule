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

import { useState } from "react";
import type { MaterialLibrary } from "@ds/sdk";
import { de } from "../locale/de.js";
import { moduleHeading, moduleTopic } from "../module-title.js";
import { DownloadIcon, ImagePlaceholder, LockIcon } from "./primitives.js";

export function MediathekPanel(props: { library: MaterialLibrary }) {
  // "" is every module. Held here rather than in the URL: the widget owns no
  // URL (see App.tsx on navigation), and a filter that survived a reload would
  // have to.
  const [selected, setSelected] = useState("");

  if (props.library.groups.length === 0) {
    return <p className="text-sm text-gray-600">{de.library.empty}</p>;
  }

  const shown =
    selected === ""
      ? props.library.groups
      : props.library.groups.filter((g) => g.moduleId === selected);

  return (
    <div className="space-y-8">
      {/*
        The layout's module filter. Purely a view over what the server already
        sent — it does not re-request, because the whole library arrives in one
        response and filtering it here cannot change what is locked.
      */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h2 className="text-lg font-bold text-gray-900">{de.library.title}</h2>

        <div className="min-w-[14rem]">
          <label
            htmlFor="ds-library-module"
            className="block text-sm font-medium text-gray-900"
          >
            {de.library.moduleFilter}
          </label>
          <div className="relative mt-1">
            <select
              id="ds-library-module"
              value={selected}
              onChange={(event) => setSelected(event.target.value)}
              className="w-full appearance-none rounded-lg border border-gray-300 bg-white py-2 pl-3 pr-12 text-sm text-gray-800"
            >
              <option value="">{de.library.allModules}</option>
              {props.library.groups.map((group) => (
                <option key={group.moduleId} value={group.moduleId}>
                  {moduleHeading(group.ordinal + 1, group.moduleTitle)}
                </option>
              ))}
            </select>
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-lg bg-cta-500 text-cta-contrast"
            >
              <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor">
                <path d="M5.5 7.5 10 12l4.5-4.5H5.5Z" />
              </svg>
            </span>
          </div>
        </div>
      </div>

      {shown.map((group) => (
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
 * ## The description, which used to be missing
 *
 * The layout draws a paragraph under each card's title and this component used
 * to say it did not exist. It half did: `contents.body` has been a column since
 * migration 0001 and writable through `ContentWrite` since P9-04 — it simply
 * never reached the learner. So the fix was to carry it through the contract
 * rather than to invent a second column for the same sentence.
 *
 * It renders **above** the file meta, and the meta stays: "PDF · 512 KB" is
 * what tells somebody on a train whether to tap Download now, and an authored
 * paragraph does not replace it.
 *
 * A card with no description shows none — most existing content has no body,
 * and a placeholder sentence would be worse than a shorter card.
 *
 * ## The thumbnail, which still is missing
 *
 * `ImagePlaceholder` stands where the layout draws artwork. There is no column
 * for it and adding one means an upload path, an admin field and a second
 * per-object signature — real work with its own ticket, not something to
 * smuggle in here. The placeholder keeps the grid's proportions so the page
 * does not reflow when it arrives.
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

            {material.description === null || material.description === "" ? null : (
              <p className="mt-2 text-xs leading-relaxed text-gray-700">
                {material.description}
              </p>
            )}

            <p className="mt-2 text-xs text-gray-500">{de.library.fileMeta(material)}</p>

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
