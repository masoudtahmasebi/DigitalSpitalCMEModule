/**
 * Which build is this? — answered on the page (P46-01).
 *
 * ## Why a footer and not a diagnostics screen
 *
 * The question is never asked deliberately. It is asked *retrospectively*,
 * after somebody has already spent ten minutes on "the feature is missing" —
 * and by then they are looking at the screen where the feature should have
 * been, not at a page they would have to know exists. Forgot-password was
 * reported absent three times while built, tested and merged (CLAUDE.md §9.9);
 * every one of those was a round trip through somebody with SSH.
 *
 * So it is present, quiet, and on every screen.
 *
 * ## Both numbers, not one
 *
 * The console's own commit answers "is this bundle the one I deployed". The
 * API's answers "is the thing it talks to the same build". A deploy that
 * rebuilt one and not the other is the case that produces the most confusing
 * bug reports in this project's history, and it is invisible unless both
 * numbers are on screen together.
 *
 * When they disagree the footer says so in words rather than leaving the reader
 * to compare two seven-character hex strings — which is exactly the comparison
 * a tired person gets wrong.
 */

import { useEffect, useState } from "react";
import { compareBuilds, fetchApiCommit, UNKNOWN_BUILD } from "@ds/build-info";
import { de } from "../locale/de.js";

export function BuildFooter(props: {
  /**
   * Undefined when the console has not managed to read its configuration — the
   * branch that renders "misconfigured", and one of the two places somebody
   * most wants to know which build they are looking at.
   */
  readonly apiBase: string | undefined;
  readonly commit: string | undefined;
}): React.JSX.Element {
  const [apiCommit, setApiCommit] = useState<string | undefined>(undefined);

  useEffect(() => {
    const apiBase = props.apiBase;
    if (apiBase === undefined || apiBase === "") return undefined;

    let cancelled = false;
    // `fetchApiCommit` never rejects, so there is no error branch to render —
    // an unreachable API answers `unknown`, which is the honest result and the
    // state somebody is most likely reading this in.
    void fetchApiCommit(apiBase).then((commit) => {
      if (!cancelled) setApiCommit(commit);
    });
    return () => {
      cancelled = true;
    };
  }, [props.apiBase]);

  const build = compareBuilds(props.commit, apiCommit);

  return (
    <footer className="border-t border-gray-200 px-5 py-3 text-xs text-gray-500">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-1">
        <span>
          {de.build.console}{" "}
          <code className="font-mono text-gray-700">{build.frontend}</code>
        </span>
        <span>
          {de.build.api} <code className="font-mono text-gray-700">{build.api}</code>
        </span>
        {build.agreement === "skew" ? (
          // Amber rather than red: the deployment is inconsistent, which is
          // worth acting on and is not an outage. A red banner for a state the
          // platform still works in is a red banner people learn to ignore.
          <span className="font-medium text-amber-700">{de.build.skew}</span>
        ) : null}
        {build.agreement === "unknown" && apiCommit === UNKNOWN_BUILD ? (
          <span>{de.build.apiUnknown}</span>
        ) : null}
      </div>
    </footer>
  );
}
