/**
 * Which build is this? — answered on the page (P46-01).
 *
 * The console's reasoning, and one difference: this page is public. A physician
 * reads it, so the footer is quiet and unlabelled beyond two short words. It is
 * not a status panel — it is the answer to a question somebody at DigitalSpital
 * asks while looking over a learner's shoulder, or while reading a screenshot
 * in a support mail.
 *
 * ## What a commit does and does not disclose
 *
 * It names which build is serving, and nothing else: the repository is private,
 * the value is opaque without it, and `/metrics` has carried the same fact
 * since P42-03. Against that it removes the most expensive question on this
 * project — "is the feature missing, or is this server old?" — which has been
 * answered wrongly three times (CLAUDE.md §9.9). Worth it.
 *
 * The API's commit comes from `/health`, which is already public and already
 * what `deploy.sh` curls; nothing new is exposed by reading it here.
 */

import { useEffect, useState } from "react";
import { compareBuilds, fetchApiCommit } from "@ds/build-info";
import { de } from "../locale/de.js";

export function BuildFooter(props: {
  /** Undefined on the misconfigured branch, where the footer still helps. */
  readonly apiBase: string | undefined;
  readonly commit: string | undefined;
}): React.JSX.Element {
  const [apiCommit, setApiCommit] = useState<string | undefined>(undefined);

  useEffect(() => {
    const apiBase = props.apiBase;
    if (apiBase === undefined || apiBase === "") return undefined;

    let cancelled = false;
    void fetchApiCommit(apiBase).then((commit) => {
      if (!cancelled) setApiCommit(commit);
    });
    return () => {
      cancelled = true;
    };
  }, [props.apiBase]);

  const build = compareBuilds(props.commit, apiCommit);

  return (
    <footer className="mt-10 border-t border-gray-200 pt-4 text-xs text-gray-400">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span>
          {de.build.portal} <code className="font-mono">{build.frontend}</code>
        </span>
        <span>
          {de.build.api} <code className="font-mono">{build.api}</code>
        </span>
        {build.agreement === "skew" ? (
          <span className="font-medium text-amber-700">{de.build.skew}</span>
        ) : null}
      </div>
    </footer>
  );
}
