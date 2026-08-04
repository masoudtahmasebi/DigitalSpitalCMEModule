/**
 * The Experten/Referenten tab (layout §4.2).
 *
 * Cards with photo, role label, name, institution and a biography behind a
 * _Mehr lesen…_ toggle.
 *
 * ## The role label is data, not a lookup
 *
 * `roleLabel` arrives as the string to display — _Wissenschaftliche Leitung_,
 * _Referent_, _Referentin_. It is deliberately not an enum the widget maps to
 * German: the correct label depends on the person, and a platform that decided
 * between "Referent" and "Referentin" from a role code would be guessing at
 * somebody's own description of themselves. The customer types what belongs
 * there.
 */

import { useState } from "react";
import type { CourseExpert } from "@ds/sdk";
import { de } from "../locale/de.js";
import { ImagePlaceholder } from "./primitives.js";

export function ExpertsTab(props: { experts: readonly CourseExpert[] }) {
  if (props.experts.length === 0) {
    return <p className="py-8 text-sm text-gray-600">{de.experts.empty}</p>;
  }

  return (
    <section>
      <h2 className="text-lg font-bold text-gray-900">{de.experts.heading}</h2>
      <ul className="mt-4 divide-y divide-gray-200">
        {props.experts.map((expert) => (
          <li key={expert.id} className="py-5 first:pt-0">
            <ExpertCard expert={expert} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function ExpertCard(props: { expert: CourseExpert }) {
  const { expert } = props;
  const [expanded, setExpanded] = useState(false);

  return (
    <article className="flex gap-5">
      {expert.photoUrl === null ? (
        // A placeholder rather than nothing: the layout's rows are a fixed
        // shape, and a portrait missing for one speaker should not reflow the
        // list around them.
        <ImagePlaceholder className="h-24 w-28 shrink-0 rounded-lg" />
      ) : (
        <img
          src={expert.photoUrl}
          // Decorative: the name is the accessible content and sits beside it.
          // A portrait's alt text that repeats the name makes a screen reader
          // announce the person twice.
          alt=""
          className="h-24 w-28 shrink-0 rounded-lg object-cover"
          referrerPolicy="no-referrer"
        />
      )}

      <div className="min-w-0">
        <p className="text-sm font-medium text-brand-600">{expert.roleLabel}</p>
        <p className="text-base font-bold text-gray-900">{expert.name}</p>
        {expert.institution === null ? null : (
          <p className="text-sm text-gray-600">{expert.institution}</p>
        )}

        {expert.biography === null ? null : (
          <div className="space-y-1 pt-1">
            <p
              className={`whitespace-pre-line text-sm text-gray-800 ${
                expanded ? "" : "line-clamp-3"
              }`}
            >
              {expert.biography}
            </p>
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setExpanded(!expanded)}
              className="text-sm font-medium text-brand-700 underline"
            >
              {expanded ? de.overviewTab.less : de.overviewTab.more}
            </button>
          </div>
        )}
      </div>
    </article>
  );
}
