/**
 * "Does this VNR actually reach the Ärztekammer?" (P103-01)
 *
 * ## Why this screen exists, and why it exists *here*
 *
 * The EIV worker talks to the Ärztekammer **after** a physician has completed a
 * course — and by then the clock has started: eight days to report, seven more
 * to correct, then the window closes permanently. A wrong VNR password
 * discovered there is discovered with a statutory deadline running and a
 * learner already holding a Teilnahmebescheinigung.
 *
 * Until now the only way to find out whether the credentials worked was to let
 * a real completion try. That is CLAUDE.md §9.9 in its strongest form: a
 * setting nobody has exercised is a setting whose state nobody knows. This
 * answers the question before anybody enrols, next to the fields that hold the
 * answer.
 *
 * ## Two readers, in that order
 *
 * The client asked for exactly this and it is the right shape. The first thing
 * on the panel is a sentence a project manager can act on — *it works*, or
 * *the password is wrong*, or *the Ärztekammer is not answering right now* —
 * and the per-step detail sits underneath for whoever has to fix it. A screen
 * that opens with `kind: rate_limited` has told the wrong person first.
 *
 * ## It cannot report anybody
 *
 * There is no path from this panel to a Punktemeldung. The endpoint behind it
 * reaches the two read-only EIV capabilities and never `submit` — see
 * `eiv-admin.service.ts`. That is deliberate: a Punktemeldung cannot be taken
 * back (a withdrawal is a further entry on the record, not an erasure), so a
 * "test" button that could reach `push_teilnahme` is a button that credits CME
 * points to a real physician the first time somebody clicks it to see what it
 * does.
 */

import { useCallback, useState } from "react";
import type { ApiClient, EivConnectionReport } from "@ds/sdk";
import { de } from "../locale/de.js";
import { useSaver } from "../hooks.js";
import { Button, Field, Notice, Panel, SaveProblem, TextInput } from "./ui.js";

export function EivCheckPanel(props: {
  client: ApiClient;
  courseSlug: string;
  /** False when no VNR is stored: there is nothing to check yet. */
  hasVnr: boolean;
  /**
   * Whether this course claims the Lernerfolg point.
   *
   * Carried in so the panel can warn when the course claims it and the
   * Ärztekammer's own record says the event carries none — S25's trap, and the
   * one finding the superseded `EivEventCheck` had that this must not lose.
   * A Punktemeldung claiming a point the accreditation does not carry is
   * refused, per completion, after the learner has finished.
   */
  claimsLernerfolg: boolean;
}) {
  const { client, courseSlug } = props;
  const [password, setPassword] = useState("");
  /*
   * Which register to aim at (P157-01).
   *
   * A string on the wire, resolved to an address by the server from a list it
   * owns — the browser never names a host. Defaulting to the installation's own
   * register keeps this control from changing what the button did before it
   * existed.
   */
  const [environment, setEnvironment] = useState<"configured" | "test">("configured");
  const [report, setReport] = useState<EivConnectionReport | undefined>();
  const saver = useSaver();

  const run = useCallback(() => {
    void saver.run(async () => {
      setReport(
        await client.adminCheckEivConnection(courseSlug, {
          environment,
          ...(password === "" ? {} : { vnrPassword: password }),
        }),
      );
      /*
       * Cleared on success, not on failure.
       *
       * A wrong password is the case where somebody wants to edit what they
       * typed — wiping the box would make them retype nineteen characters to
       * change one. A *correct* one has done its job and should not sit in a
       * DOM node for the rest of the session.
       */
      setPassword("");
    });
  }, [client, courseSlug, environment, password, saver]);

  if (!props.hasVnr) {
    /*
     * §9.2: no button where there is nothing to press it against. The check
     * needs a VNR, and a course without one would get a 409 — a refusal that
     * looks like a fault when it is simply an unfinished form one field up.
     */
    return (
      <Panel title={de.eivCheck.title}>
        <p className="text-sm text-gray-600">{de.eivCheck.needsVnr}</p>
      </Panel>
    );
  }

  return (
    <Panel title={de.eivCheck.title}>
      <div className="max-w-2xl space-y-3">
        <p className="text-sm text-gray-600">{de.eivCheck.intro}</p>
        {/*
          Said plainly, because an operator who is not sure will not press it —
          and one who assumes the opposite is the person we must never have.
        */}
        <p className="text-sm text-gray-600">{de.eivCheck.readOnly}</p>

        <Field
          label={de.eivCheck.environment}
          hint={de.eivCheck.environmentHint}
          htmlFor="eiv-check-environment"
        >
          <select
            id="eiv-check-environment"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            value={environment}
            onChange={(event) =>
              setEnvironment(event.target.value === "test" ? "test" : "configured")
            }
          >
            <option value="configured">{de.eivCheck.environmentConfigured}</option>
            <option value="test">{de.eivCheck.environmentTest}</option>
          </select>
        </Field>

        <Field
          label={de.eivCheck.password}
          hint={de.eivCheck.passwordHint}
          htmlFor="eiv-check-password"
        >
          <TextInput
            id="eiv-check-password"
            type="password"
            autoComplete="new-password"
            value={password}
            maxLength={200}
            onChange={setPassword}
          />
        </Field>

        <Button onClick={run} disabled={saver.state === "saving"}>
          {saver.state === "saving" ? de.eivCheck.running : de.eivCheck.action}
        </Button>

        <SaveProblem title={de.error.title} problem={saver.problem} />

        {report === undefined ? null : (
          <Report report={report} claimsLernerfolg={props.claimsLernerfolg} />
        )}
      </div>
    </Panel>
  );
}

function Report(props: { report: EivConnectionReport; claimsLernerfolg: boolean }) {
  const { report } = props;
  const ok = report.steps.every((step) => step.ok);
  const authFailed = report.steps.some(
    (step) => step.step === "authenticate" && !step.ok,
  );
  const firstFailure = report.steps.find((step) => !step.ok);

  return (
    <div className="space-y-3" role="status">
      {/*
        The headline, for the person who only reads the headline.

        Three outcomes and not two: "it works", "the credentials are wrong",
        and "the credentials may be fine but the Ärztekammer did not answer".
        Collapsing the last two into "failed" sends somebody to retype a
        password that was never the problem (§9.4).
      */}
      <Notice tone={ok ? "success" : "warning"}>
        {ok
          ? de.eivCheck.resultOk
          : authFailed
            ? de.eivCheck.resultAuthFailed
            : de.eivCheck.resultUnreachable}
      </Notice>

      {/*
        What to do, once (P100-01's rule, one screen over).

        A failed handshake fails the two reads with it, so every step carries
        the same cause — and rendering the advice per step printed "VNR und
        Passwort prüfen" three times. The *instruction* is one instruction; what
        varies per step is which call failed, and that is what the list below
        is for.
      */}
      {firstFailure === undefined ? null : (
        <p className="text-sm text-gray-700">
          {de.eivCheck.advice[
            (firstFailure.kind ?? "unknown") as keyof typeof de.eivCheck.advice
          ] ?? de.eivCheck.advice.unknown}
        </p>
      )}

      {/*
        The one state on this screen worth more than a label (P107-01).

        Everything else here is a statement of fact. This is the combination in
        which the next physician to finish a course files a statutory report
        against their own EFN — and it is reached by editing two lines in a file
        on a server, with nothing in between that says so out loud.

        `unknown` is included because it is treated as live everywhere else in
        the platform; a warning that stopped at the recognised host would be
        quieter than the guard it describes.
      */}
      {report.submissionsEnabled &&
      (report.tier === "live" || report.tier === "unknown") ? (
        <Notice tone="warning">{de.eivCheck.liveArmed}</Notice>
      ) : null}

      <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
        {/*
          Which host answered. On the screen because "it works" and "it works
          against the mock" are different sentences, and only one of them means
          a physician's points will be reported (§9.9).
        */}
        <Summary label={de.eivCheck.endpoint} value={report.endpoint} />
        {/*
          The address in words (P107-01).

          Beside it rather than instead of it: an operator reconciling against
          `config.env` needs the literal string, and an operator deciding
          whether to go live needs the sentence. Printing only the URL was the
          defect — `backend-test.eiv-fobi.de` and `backend.eiv-fobi.de` differ
          by one word that means "rehearsal" or "statutory filing", and nothing
          on the screen said which.
        */}
        <Summary
          label={de.eivCheck.tierLabel}
          value={de.eivCheck.tier[report.tier] ?? de.eivCheck.tier.unknown}
        />
        <Summary
          label={de.eivCheck.submissionsLabel}
          value={
            report.submissionsEnabled
              ? de.eivCheck.submissionsOn
              : de.eivCheck.submissionsOff
          }
        />
        <Summary label={de.course.vnr} value={report.vnr} />
        {report.reportedCount === undefined ? null : (
          <Summary
            label={de.eivCheck.reportedCount}
            value={String(report.reportedCount)}
          />
        )}
        {report.usedStoredPassword ? null : (
          <Summary label={de.eivCheck.passwordSource} value={de.eivCheck.passwordTyped} />
        )}
      </dl>

      {/*
        The accredited period and the point flags, when the event read worked.

        These are not decoration: `validFrom`/`validUntil` are what a
        participation date is checked against — the answer to "what is
        Veranstaltungsende for an on-demand course" — and the two point figures
        say which credit this VNR may claim. Both were open questions to the
        Ärztekammer that this endpoint answers directly.
      */}
      {report.event === undefined ? null : (
        <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
          <p className="mb-2 text-sm font-semibold text-gray-900">
            {de.eivCheck.eventTitle}
          </p>
          <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
            <Summary label={de.eivCheck.eventName} value={report.event.title ?? "—"} />
            <Summary
              label={de.eivCheck.eventCategory}
              value={report.event.category ?? "—"}
            />
            <Summary
              label={de.eivCheck.eventPeriod}
              value={`${report.event.validFrom ?? "—"} – ${report.event.validUntil ?? "—"}`}
            />
            <Summary
              label={de.eivCheck.eventPoints}
              value={de.eivCheck.pointsValue(
                report.event.attendancePoints ?? null,
                report.event.assessmentPoints ?? null,
              )}
            />
          </dl>
          {report.event.locked === true ? (
            <Notice tone="warning">{de.eivCheck.eventLocked}</Notice>
          ) : null}

          {/*
            The arithmetic, done here instead of by the person reading two
            dates in two formats (P184-01).

            The period above is the register's; the days below are our queue's.
            EIV refuses a Teilnahmedatum outside the period with a 406, so a
            non-zero count here is one refused Punktemeldung per physician —
            and the client's own test event closed on 19.01.2024, which no
            completion in 2026 can fall inside.
          */}
          {report.queue === undefined ||
          report.queue.beforePeriod + report.queue.afterPeriod === 0 ? null : (
            <Notice tone="warning">
              {de.eivCheck.outsidePeriod(
                report.queue.beforePeriod + report.queue.afterPeriod,
                report.queue.pending,
                report.queue.earliestDay ?? "—",
                report.queue.latestDay ?? "—",
              )}
            </Notice>
          )}
          {report.event.assessmentPoints === 0 && props.claimsLernerfolg ? (
            <Notice tone="warning">{de.eivCheck.lernerfolgMismatch}</Notice>
          ) : null}
        </div>
      )}

      {/* And the technical detail, last, for whoever has to act on it. */}
      <details className="text-sm">
        <summary className="cursor-pointer text-gray-700">
          {de.eivCheck.detailToggle}
        </summary>
        <ul className="mt-2 space-y-1">
          {report.steps.map((step) => (
            <li key={step.step} className="flex flex-wrap items-baseline gap-2">
              <span aria-hidden>{step.ok ? "✓" : "✗"}</span>
              <span className="font-medium text-gray-900">
                {de.eivCheck.steps[step.step]}
              </span>
              <span className="sr-only">
                {step.ok ? de.eivCheck.stepOk : de.eivCheck.stepFailed}
              </span>
              {step.ok || step.detail === undefined ? null : (
                // The authority's own words, per step. The instruction is
                // above, once; this is the evidence behind it.
                <span className="font-mono text-xs text-gray-500">{step.detail}</span>
              )}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

function Summary(props: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-gray-500">{props.label}</dt>
      <dd className="break-words text-gray-800">{props.value}</dd>
    </div>
  );
}
