/**
 * Merging two credentials onto one person (P21-05).
 *
 * ## Two steps, and the first one is not optional
 *
 * **Prüfen** calls the preview endpoint, which reads and writes nothing;
 * **Endgültig zusammenführen** does the irreversible thing, and is not rendered
 * until the preview has come back allowed. That is the shape of the operation
 * rather than a nicety: a physician's participation records — the things a CME
 * point is awarded against — move, and there is no undo an operator could offer
 * them afterwards.
 *
 * The confirmation is the target's own id, typed. A DELETE-shaped mistake is
 * worth two decisions, and re-typing an id is the cheapest second one that a
 * mis-click cannot make. The API refuses a mismatch too — this is not the only
 * guard, it is the one that stops somebody reaching the API by accident.
 *
 * ## What the screen shows about each side, and what it will not
 *
 * Which credentials, which courses, and **whether** an EFN is on file. Never
 * which: no endpoint returns an EFN (ADR-0004), and the operator does not need
 * the digits to decide — the refusal already tells them two exist and differ.
 *
 * ## Why the refusal text comes from the API
 *
 * `planCredentialMerge` decides and the API renders the German. A second copy
 * of those three sentences here would be a second answer to "why can I not do
 * this?", and the two would diverge the first time a rule changed.
 */

import { useState } from "react";
import type { ApiClient, ParticipantMergeParty, ParticipantMergePreview } from "@ds/sdk";
import { de } from "../locale/de.js";
import { describeError } from "../api.js";
import { Button, Field, Notice, Panel, TextInput } from "./ui.js";

export function MergeParticipants(props: { client: ApiClient; onMerged: () => void }) {
  const [open, setOpen] = useState(false);
  const [sourceUserId, setSource] = useState("");
  const [targetUserId, setTarget] = useState("");
  const [confirm, setConfirm] = useState("");
  const [preview, setPreview] = useState<ParticipantMergePreview | undefined>();
  const [problem, setProblem] = useState<string | undefined>();
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        {de.participantAccounts.merge}
      </Button>
    );
  }

  /** Any edit invalidates the verdict the operator is looking at. */
  const reset = () => {
    setPreview(undefined);
    setConfirm("");
    setDone(false);
  };

  const allowed = preview?.plan.allowed === true;

  return (
    <Panel title={de.participantAccounts.merge}>
      <p className="text-sm text-gray-700">{de.participantAccounts.mergeIntro}</p>
      <Notice tone="warning">{de.participantAccounts.mergeIrreversible}</Notice>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label={de.participantAccounts.mergeSource} htmlFor="merge-source">
          <TextInput
            id="merge-source"
            value={sourceUserId}
            onChange={(value) => {
              setSource(value);
              reset();
            }}
          />
        </Field>
        <Field label={de.participantAccounts.mergeTarget} htmlFor="merge-target">
          <TextInput
            id="merge-target"
            value={targetUserId}
            onChange={(value) => {
              setTarget(value);
              reset();
            }}
          />
        </Field>
      </div>

      {problem === undefined ? null : <Notice tone="error">{problem}</Notice>}
      {done ? <Notice tone="success">{de.participantAccounts.mergeDone}</Notice> : null}

      {preview === undefined ? null : (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Side title={de.participantAccounts.mergeSource} party={preview.source} />
          <Side title={de.participantAccounts.mergeTarget} party={preview.target} />
        </div>
      )}

      {preview !== undefined && !allowed ? (
        // The API's own German. See the header for why it is not repeated here.
        <Notice tone="error">{refusalOf(preview)}</Notice>
      ) : null}

      {allowed ? (
        <>
          <Notice tone="success">{de.participantAccounts.mergeAllowed}</Notice>
          <Field label={de.participantAccounts.mergeConfirmLabel} htmlFor="merge-confirm">
            <TextInput id="merge-confirm" value={confirm} onChange={setConfirm} />
          </Field>
        </>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          variant="secondary"
          disabled={busy || sourceUserId === "" || targetUserId === ""}
          onClick={() => {
            setBusy(true);
            setProblem(undefined);
            props.client
              .adminPreviewParticipantMerge({ sourceUserId, targetUserId })
              .then(setPreview)
              .catch((error: unknown) => {
                setPreview(undefined);
                setProblem(describeError(error, de.participantAccounts.merge));
              })
              .finally(() => setBusy(false));
          }}
        >
          {de.participantAccounts.mergeCheck}
        </Button>

        {allowed ? (
          <Button
            // The typed id, checked here and again by the API.
            disabled={busy || confirm !== targetUserId}
            onClick={() => {
              setBusy(true);
              setProblem(undefined);
              props.client
                .adminMergeParticipants({ sourceUserId, targetUserId, confirm })
                .then(() => {
                  setDone(true);
                  setPreview(undefined);
                  setSource("");
                  setTarget("");
                  setConfirm("");
                  props.onMerged();
                })
                .catch((error: unknown) =>
                  setProblem(describeError(error, de.participantAccounts.merge)),
                )
                .finally(() => setBusy(false));
            }}
          >
            {de.participantAccounts.mergeConfirm}
          </Button>
        ) : null}

        <Button
          variant="secondary"
          onClick={() => {
            setOpen(false);
            reset();
            setProblem(undefined);
          }}
        >
          {de.common.cancel}
        </Button>
      </div>
    </Panel>
  );
}

function Side(props: { title: string; party: ParticipantMergeParty }) {
  const courses = props.party.enrolledCourseSlugs;

  return (
    <div className="rounded-lg border border-gray-200 p-3 text-sm">
      <p className="font-semibold text-gray-900">{props.title}</p>
      <p className="font-mono text-xs text-gray-600">{props.party.userId}</p>
      <p className="mt-1 text-gray-800">{props.party.email ?? "—"}</p>
      <p className="mt-1 text-gray-700">
        {props.party.hasEfn
          ? de.participantAccounts.mergeHasEfn
          : de.participantAccounts.mergeNoEfn}
      </p>
      <p className="mt-1 text-gray-700">
        {de.participantAccounts.mergeCourses}:{" "}
        {courses.length === 0
          ? de.participantAccounts.mergeNoCourses
          : courses.join(", ")}
      </p>
    </div>
  );
}

/**
 * The refusal, in the API's words.
 *
 * The preview returns a machine reason; the *sentence* explaining it is what
 * the merge endpoint answers a 409 with. Rather than keep a second copy of
 * those three sentences in the console, this asks the operator to press the
 * button and read the API's own message — which is the one that will still be
 * right after the rule changes.
 */
function refusalOf(preview: ParticipantMergePreview): string {
  const plan = preview.plan;
  if (plan.allowed) return "";
  const courses = plan.refusal.courseSlugs;
  return courses === undefined || courses.length === 0
    ? `${de.participantAccounts.mergeCheck}: ${plan.refusal.reason}`
    : `${de.participantAccounts.mergeCheck}: ${plan.refusal.reason} (${courses.join(", ")})`;
}
