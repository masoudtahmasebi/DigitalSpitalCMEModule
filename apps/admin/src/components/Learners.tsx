/**
 * Per-learner progress, and the two things an operator may do to a record
 * (P12-05).
 *
 * ## What this screen is for
 *
 * "How is each user progressing?" — watch percentage, best quiz score, whether
 * the Punktemeldung has gone, whether a certificate exists. One row per
 * enrolment, because a physician taking two courses has two independent
 * records and merging them would hide which one is stuck.
 *
 * ## The two writes, and why each is guarded
 *
 * **Correcting a name** is refused by the API once the Punktemeldung has been
 * accepted — the name is on the Ärztekammer's record by then. The console
 * disables the control at that point rather than letting the operator type a
 * correction and discover the refusal afterwards.
 *
 * **Erasing a subject** is irreversible, crosses tenants, and asks for a
 * reason that goes into the audit trail. It is behind a two-step confirm and a
 * required reason for that reason.
 *
 * ## The EFN
 *
 * Masked by the API before it is serialised — last four digits. This component
 * could not show more if it wanted to, which is the point (ADR-0004).
 */

import { useCallback, useEffect, useState } from "react";
import type { ApiClient, LearnerRecord } from "@ds/sdk";
import { de } from "../locale/de.js";
import { describeError, isForbidden } from "../api.js";
import { useSaver } from "../hooks.js";
import {
  Badge,
  Button,
  Field,
  LoadFailure,
  Notice,
  Spinner,
  Table,
  TextInput,
} from "./ui.js";
import { EmptyState } from "./page.js";

export function Learners(props: { client: ApiClient; courseSlug?: string }) {
  const { client, courseSlug } = props;
  const [rows, setRows] = useState<LearnerRecord[] | undefined>();
  const [problem, setProblem] = useState<string | undefined>();
  const [forbidden, setForbidden] = useState(false);
  const [editing, setEditing] = useState<string | undefined>();
  const [name, setName] = useState("");
  const [erasing, setErasing] = useState<string | undefined>();
  /** Which row is confirming a withdrawal (P31-02). Shares `reason` below. */
  const [withdrawing, setWithdrawing] = useState<string | undefined>();
  /** The row with an outbound call in flight, so its buttons can be disabled. */
  const [busy, setBusy] = useState<string | undefined>();
  /*
   * The name correction's own state (P230-01). One saver rather than one per
   * row is correct here because `editing` holds a single enrolment id — there
   * is never a second correction in flight to confuse it with.
   *
   * The fallback is this screen's, not the generic one: where the API sends no
   * `detail`, "Die Änderung konnte nicht gespeichert werden" at least names
   * what failed.
   */
  const saver = useSaver(de.learners.saveFailed);
  /** The erasure's own, so a refused erasure never reads as a refused rename. */
  const eraser = useSaver(de.learners.saveFailed);
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    setProblem(undefined);
    try {
      setRows(await client.adminListLearners(courseSlug));
    } catch (error) {
      if (isForbidden(error)) setForbidden(true);
      else setProblem(describeError(error, de.learners.loadFailed));
    }
  }, [client, courseSlug]);

  useEffect(() => {
    void load();
  }, [load]);

  async function correct(row: LearnerRecord): Promise<void> {
    /*
     * `saver.run` is what holds the button shut for the duration. Before
     * P230-01 this was a bare try/catch and Speichern stayed live, so three
     * clicks sent three corrections — and `moderation.service.ts` writes a
     * `learner.name_corrected` audit row per request, so one correction was
     * recorded three times in an append-only log.
     *
     * A 409 explains that the Punktemeldung has gone and what to do instead.
     * `describeError` inside the hook shows that verbatim; paraphrasing it
     * would drop the instruction.
     */
    const ok = await saver.run(() =>
      client.adminCorrectLearnerName(row.enrolmentId, name.trim()),
    );
    if (!ok) return;
    setEditing(undefined);
    setName("");
    await load();
  }

  /**
   * Hand an abandoned Punktemeldung back to the worker (P31-02).
   *
   * For a row the worker gave up on — a 406 the operator has since fixed by
   * entering a VNR, a password corrected, a lock lifted at the Kammer. It does
   * not submit inline: the retry budget and the deadline arithmetic live in
   * `@ds/domain`, and a second path would be a second opinion on them.
   */
  async function requeue(row: LearnerRecord): Promise<void> {
    setProblem(undefined);
    setBusy(row.enrolmentId);
    try {
      await client.adminRequeueEivSubmission(row.enrolmentId);
      await load();
    } catch (error) {
      setProblem(describeError(error, de.learners.saveFailed));
    } finally {
      setBusy(undefined);
    }
  }

  /**
   * Withdraw a reported Punktemeldung.
   *
   * Reuses the reason field the erasure flow already has, because it is the
   * same kind of value — a sentence about the process, for the audit trail,
   * never about the person.
   */
  async function withdraw(row: LearnerRecord): Promise<void> {
    setProblem(undefined);
    setBusy(row.enrolmentId);
    try {
      await client.adminWithdrawEivSubmission(row.enrolmentId, reason.trim());
      setWithdrawing(undefined);
      setReason("");
      await load();
    } catch (error) {
      setProblem(describeError(error, de.learners.saveFailed));
    } finally {
      setBusy(undefined);
    }
  }

  async function erase(row: LearnerRecord): Promise<void> {
    /*
     * The same guard as `correct`, and the consequence of not having it was
     * worse (P230-01).
     *
     * This is GDPR Art. 17 erasure: irreversible, across tenants, and its
     * confirm button is a plain `Button` inside this screen's own two-step
     * rather than a `ConfirmButton` — so it stayed in the tree, enabled, for
     * the whole round trip.
     *
     * `moderation.service.ts` begins `eraseSubject` with
     * `findEnrolment(enrolmentId)` and throws `notFound` when it is gone. The
     * erasure removes the enrolment. So a second click would find nothing and
     * the screen would show **an error for an erasure that had just
     * succeeded**, next to a row that had already disappeared — read from that
     * source path, not observed, and named as such.
     */
    const ok = await eraser.run(() =>
      client.adminEraseSubject(row.enrolmentId, reason.trim()),
    );
    if (!ok) return;
    setErasing(undefined);
    setReason("");
    await load();
  }

  if (forbidden) {
    return (
      <Notice tone="warning" title={de.error.title}>
        {de.auth.forbidden}
      </Notice>
    );
  }

  if (rows === undefined) {
    return problem === undefined ? (
      <Spinner label={de.loading} />
    ) : (
      <LoadFailure
        title={de.error.title}
        retryLabel={de.error.retry}
        problem={problem}
        onRetry={() => void load()}
      />
    );
  }

  return (
    <div className="space-y-5">
      {/* Heading and intro come from `Page` (P30-02). */}
      {problem === undefined ? null : (
        <Notice tone="error" title={de.error.title}>
          {problem}
        </Notice>
      )}

      {rows.length === 0 ? (
        <EmptyState title={de.learners.empty} description={de.learners.emptyHint} />
      ) : (
        <Table
          headers={[
            de.learners.name,
            de.learners.efn,
            de.learners.course,
            de.learners.watched,
            de.learners.quiz,
            de.learners.submission,
            de.learners.certificate,
            "",
          ]}
        >
          {rows.map((row) => (
            <tr key={row.enrolmentId} className="border-t border-gray-100 align-top">
              <td className="text-sm">
                {editing === row.enrolmentId ? (
                  <div className="space-y-2">
                    <Field label={de.learners.name} htmlFor={`name-${row.enrolmentId}`}>
                      <TextInput
                        id={`name-${row.enrolmentId}`}
                        value={name}
                        maxLength={300}
                        onChange={setName}
                      />
                    </Field>
                    <div className="flex gap-2">
                      <Button
                        onClick={() => void correct(row)}
                        disabled={saver.state === "saving" || name.trim() === ""}
                      >
                        {saver.state === "saving" ? de.common.saving : de.common.save}
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => {
                          saver.reset();
                          setEditing(undefined);
                        }}
                      >
                        {de.common.cancel}
                      </Button>
                    </div>
                    {saver.problem === undefined ? null : (
                      /*
                       * Beside the field it is about, not in the screen-level
                       * notice: `problem` up there is about the list failing to
                       * load, and one channel carrying two unrelated failures
                       * is how a refused correction reads as a broken screen.
                       */
                      <p className="text-xs font-medium text-red-700">{saver.problem}</p>
                    )}
                  </div>
                ) : (
                  (row.attestedName ?? "—")
                )}
              </td>
              <td className="font-mono text-xs text-gray-600">{row.maskedEfn ?? "—"}</td>
              <td className="text-sm">{row.courseTitle}</td>
              <td className="text-sm tabular-nums">{row.watchedPercent} %</td>
              <td className="text-sm tabular-nums">
                {row.quizBestPercent === null ? "—" : `${row.quizBestPercent} %`}
              </td>
              <td className="text-sm">
                <Badge tone={row.submissionStage === "submitted" ? "ok" : "muted"}>
                  {de.learners.stage[row.submissionStage]}
                </Badge>
              </td>
              <td className="text-sm">{row.certificateStatus ?? "—"}</td>
              <td className="text-right">
                {erasing === row.enrolmentId ? (
                  <div className="space-y-2">
                    <Field
                      label={de.learners.reason}
                      htmlFor={`reason-${row.enrolmentId}`}
                      hint={de.learners.reasonHint}
                    >
                      <TextInput
                        id={`reason-${row.enrolmentId}`}
                        value={reason}
                        maxLength={200}
                        onChange={setReason}
                      />
                    </Field>
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="danger"
                        onClick={() => void erase(row)}
                        disabled={eraser.state === "saving" || reason.trim() === ""}
                      >
                        {eraser.state === "saving"
                          ? de.common.saving
                          : de.learners.eraseConfirm}
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => {
                          eraser.reset();
                          setErasing(undefined);
                        }}
                      >
                        {de.common.cancel}
                      </Button>
                    </div>
                    {eraser.problem === undefined ? null : (
                      <p className="text-xs font-medium text-red-700">{eraser.problem}</p>
                    )}
                  </div>
                ) : withdrawing === row.enrolmentId ? (
                  /*
                   * The same shape as the erasure confirmation, deliberately:
                   * both are irreversible acts on a physician's CME record and
                   * both want a sentence for the audit trail before they run.
                   */
                  <div className="space-y-2">
                    <Field
                      label={de.learners.withdrawReason}
                      htmlFor={`withdraw-${row.enrolmentId}`}
                      hint={de.learners.withdrawReasonHint}
                    >
                      <TextInput
                        id={`withdraw-${row.enrolmentId}`}
                        value={reason}
                        maxLength={200}
                        onChange={setReason}
                      />
                    </Field>
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="danger"
                        onClick={() => void withdraw(row)}
                        disabled={reason.trim() === "" || busy === row.enrolmentId}
                      >
                        {de.learners.withdrawConfirm}
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => setWithdrawing(undefined)}
                      >
                        {de.common.cancel}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex justify-end gap-2">
                    {/*
                      Requeue an abandoned Meldung, withdraw a reported one
                      (P31-02). Neither is offered where it cannot work: the API
                      refuses both outside their windows, and a button that only
                      fails is worse than no button.
                    */}
                    {row.submissionStage === "abandoned" ? (
                      <Button
                        variant="secondary"
                        disabled={busy === row.enrolmentId}
                        onClick={() => void requeue(row)}
                      >
                        {de.learners.requeue}
                      </Button>
                    ) : null}
                    {row.submissionStage === "submitted" ? (
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setWithdrawing(row.enrolmentId);
                          setReason("");
                        }}
                      >
                        {de.learners.withdraw}
                      </Button>
                    ) : null}
                    {/* Disabled once reported: the API refuses it and the
                        operator should know before typing, not after. */}
                    {row.submissionStage === "submitted" ||
                    row.submissionStage === "withdrawn" ? (
                      <span
                        className="text-xs text-gray-500"
                        title={de.learners.nameLockedHint}
                      >
                        {de.learners.nameLocked}
                      </span>
                    ) : (
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setEditing(row.enrolmentId);
                          setName(row.attestedName ?? "");
                        }}
                      >
                        {de.learners.correctName}
                      </Button>
                    )}
                    <Button
                      variant="secondary"
                      onClick={() => setErasing(row.enrolmentId)}
                    >
                      {de.learners.erase}
                    </Button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
