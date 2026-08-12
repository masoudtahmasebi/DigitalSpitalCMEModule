/**
 * "Medien prüfen" — does every video host answer a Range request? (P63-04.)
 *
 * ## Why an author needs this and could not have it
 *
 * A host that ignores `Range` answers the whole file with a `200`. It looks
 * healthy to every other check ever written, plays perfectly, and makes the
 * scrub bar do nothing — which to a learner is indistinguishable from the
 * anti-skip gate refusing a seek on the accreditation's behalf. One of those is
 * the platform working; the other is the video server misconfigured. Nobody
 * looking at the player can tell which, and the two need different people.
 *
 * `MediaCheckService` and `GET /admin/courses/:slug/media-check` were built in
 * P62-03 and reachable by nothing: not in the contract, not in the SDK, not on
 * any screen. A check an operator can only run with `curl` and a hand-made
 * session cookie is CLAUDE.md §9.3 in the ticket that cites §9.3.
 *
 * ## Why a button and not a load
 *
 * One HTTP request per distinct source URL, over the network the learner will
 * use. A five-module course is fifteen round trips to a CDN, and a screen that
 * did that on mount would be slow every time it opened for an answer that is
 * only interesting when the media changes.
 */

import { useCallback, useState } from "react";
import type { ApiClient, MediaCheckReport, MediaCheckResult } from "@ds/sdk";
import { de } from "../locale/de.js";
import { Badge, Button, Notice } from "./ui.js";

export function MediaCheckPanel(props: { client: ApiClient; courseSlug: string }) {
  const { client, courseSlug } = props;
  const [report, setReport] = useState<MediaCheckReport | undefined>(undefined);
  const [running, setRunning] = useState(false);
  const [failed, setFailed] = useState(false);

  const run = useCallback(() => {
    setRunning(true);
    setFailed(false);
    void (async () => {
      try {
        setReport(await client.adminCheckCourseMedia(courseSlug));
      } catch {
        // The problem-details body is about the request, not about a video
        // server, so surfacing it here would name the wrong thing. What the
        // person needs is "the check did not run" and a way to try again.
        setFailed(true);
        setReport(undefined);
      } finally {
        setRunning(false);
      }
    })();
  }, [client, courseSlug]);

  return (
    <section className="space-y-3 rounded-md border border-gray-200 p-4">
      <p className="max-w-3xl text-sm text-gray-600">{de.structure.mediaCheckIntro}</p>

      <Button variant="secondary" onClick={run} disabled={running}>
        {running ? de.structure.mediaChecking : de.structure.mediaCheck}
      </Button>

      {failed ? <Notice tone="error">{de.structure.mediaCheckFailed}</Notice> : null}

      {report === undefined ? null : <Report report={report} />}
    </section>
  );
}

function Report(props: { report: MediaCheckReport }) {
  const { seekable, sources } = props.report;

  if (sources.length === 0) {
    return <Notice tone="info">{de.structure.mediaCheckNone}</Notice>;
  }

  return (
    <div className="space-y-3">
      <Notice tone={seekable ? "success" : "warning"}>
        {seekable ? de.structure.mediaCheckAllGood : de.structure.mediaCheckProblems}
      </Notice>

      {/*
       * Every source, not only the failures. An author who fixed one host needs
       * to see the other fourteen still answering — a list that shrinks to
       * nothing on success gives no evidence that the check ran at all.
       */}
      <ul className="space-y-2">
        {sources.map((source) => (
          <Row key={source.url} source={source} />
        ))}
      </ul>
    </div>
  );
}

function Row(props: { source: MediaCheckResult }) {
  const { url, verdict, status } = props.source;
  const good = verdict === "seekable" || verdict === "signed_by_us";

  return (
    <li className="text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={good ? "ok" : "warn"}>
          {good ? de.structure.mediaOk : de.structure.mediaProblem}
        </Badge>
        {/* `break-all`: a signed URL is longer than any column and must not
            push the page sideways. */}
        <code className="break-all text-xs text-gray-700">{url}</code>
        {status === undefined || status === null ? null : (
          <span className="text-xs text-gray-500">HTTP {status}</span>
        )}
      </div>
      <p className="mt-0.5 max-w-3xl text-gray-600">
        {de.structure.mediaVerdict[verdict]}
      </p>
    </li>
  );
}
