/**
 * The second factor, as something an operator can actually set (P22-02).
 *
 * ## Why this screen exists
 *
 * Until P22-02 the rule was a constant in the code: `super_admin` always,
 * everybody else never. There was no way to require one for a customer that
 * wanted it, no way to turn it off for one that did not — and, more urgently,
 * **no way to remove or reset an enrolled second factor at all**. An operator
 * who lost their phone was locked out permanently.
 *
 * ## What it deliberately shows to everybody
 *
 * Every operator may read the policies they are subject to. Only the writes are
 * scoped — the platform's row is a `super_admin`'s, a customer's row belongs to
 * that customer's administrators — and the API refuses the rest. Hiding a
 * control the API would refuse is a convenience; the refusal is the boundary
 * (ADR-0012, and the same reasoning as `SECTIONS` in `App.tsx`).
 *
 * ## Two clients, and this one is the platform's
 *
 * These endpoints sit above any tenant, like the customer registry, so the
 * request must not carry `X-DS-Project`.
 */

import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { ApiClient, SecondFactorPolicies, SecondFactorPolicy } from "@ds/sdk";
import { describeError } from "../api.js";
import { de } from "../locale/de.js";
import {
  Button,
  ConfirmButton,
  Field,
  Notice,
  Panel,
  Select,
  Spinner,
  TextInput,
} from "./ui.js";
import {
  readPlatformSender,
  sendPlatformTestMail,
  writePlatformSender,
  type PlatformSender,
} from "../staff-auth.js";

/**
 * Ordered loosest to strictest, which is the order the consequences escalate
 * in — a picker that read `required, disabled, optional` would make the middle
 * option look like the extreme one.
 */
const LABELS: Record<SecondFactorPolicy, string> = de.security.policy_;
const HINTS: Record<SecondFactorPolicy, string> = de.security.policyHint_;

const POLICIES: ReadonlyArray<readonly [SecondFactorPolicy, string]> = [
  ["disabled", LABELS.disabled],
  ["optional", LABELS.optional],
  ["required", LABELS.required],
];

export function Security(props: {
  client: ApiClient;
  /**
   * The API's base URL, for the platform-sender panel (P40-01).
   *
   * Not through `ApiClient`: the platform SMTP endpoints live under
   * `/admin/auth`, which is the staff plane's own surface rather than the
   * contract-generated SDK — the same reason sign-in and the second factor are
   * reached through `staff-auth.ts`.
   */
  apiBase: string;
  /** `super_admin` may set the platform row; nobody else may. */
  isSuperAdmin: boolean;
  /** Whether this operator has a second factor set up right now. */
  ownSecondFactorEnrolled: boolean;
  /**
   * Only what a policy row needs. The console already holds this narrowed
   * shape for the invitation form, and widening it to `CustomerSummary` here
   * would make this screen depend on counts it never renders.
   */
  customers: readonly { readonly id: string; readonly name: string }[];
}) {
  const { client } = props;
  const [policies, setPolicies] = useState<SecondFactorPolicies | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [saved, setSaved] = useState(false);
  /**
   * Kept apart from `saved` (P69-01).
   *
   * Removing your own second factor and saving a policy are different acts with
   * different consequences, and one "Gespeichert." for both is what let a
   * *rotation* read as a removal.
   */
  const [removed, setRemoved] = useState(false);

  const load = useCallback(async () => {
    try {
      setPolicies(await client.adminGetSecondFactorPolicy());
      setError(undefined);
    } catch (cause) {
      setError(describeError(cause, de.security.loadFailed));
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(
    customerId: string | null,
    policy: SecondFactorPolicy,
  ): Promise<void> {
    try {
      await client.adminSetSecondFactorPolicy({ customerId, policy });
      setRemoved(false);
      setSaved(true);
      setError(undefined);
      await load();
    } catch (cause) {
      setSaved(false);
      setError(describeError(cause, de.security.saveFailed));
    }
  }

  async function removeOwn(): Promise<void> {
    try {
      await client.adminRemoveOwnSecondFactor();
      setSaved(false);
      setRemoved(true);
      setError(undefined);
    } catch (cause) {
      setSaved(false);
      // The API's own detail is the useful one here — it says *why* it refused,
      // and under a `required` policy that is exactly what the operator needs.
      setError(describeError(cause, de.security.removeOwnBlocked));
    }
  }

  if (policies === undefined) {
    return error === undefined ? null : (
      <Notice tone="error">
        <p>{error}</p>
      </Notice>
    );
  }

  const forCustomer = new Map(
    policies.customers.map((row) => [row.customerId, row.policy]),
  );

  /*
   * The rule this operator is actually under, and which row it is (P69-01,
   * P74-01).
   *
   * Read from the API rather than derived here. This screen used to compute it
   * from `props.customers` — the list an operator may *pick* from, which is
   * every customer for a super administrator (who holds a grant in none of
   * them) and empty for a customer administrator (whose own customer is the
   * only one that counts). Both answers were wrong, and the visible cost was a
   * notice saying "stellen Sie oben die Regel auf Freigestellt" beside two rows,
   * naming neither, one of which changes nothing.
   *
   * `own.policy` decides whether "entfernen" below means *removed* or
   * *rotated*; `own.scopes` decides which row to point at.
   */
  const own = policies.own;
  const removalRotates = own.policy === "required";
  const governing = new Set(own.scopes.map((scope) => scope.customerId));

  const scopeLabel = (scope: {
    customerId: string | null;
    name: string | null;
  }): string =>
    scope.customerId === null
      ? de.security.platformScope
      : `${de.security.customerScope}: ${scope.name ?? nameOf(props.customers, scope.customerId)}`;

  const governingLabels = own.scopes.map(scopeLabel).join(" · ");
  /*
   * Whether the operator can do what the notice is about to tell them to do.
   *
   * `mayChange` is the API's own answer, from the same check `PUT` applies, so
   * this screen can never tell somebody to use a control the API refuses
   * (CLAUDE.md §9.2) — nor stay silent about who can (§9.4). The case is real:
   * a `department_admin` governed by a `required` customer policy may not set
   * policies at all.
   */
  const mayRelax = own.scopes.some((scope) => scope.mayChange);

  /*
   * Every scope that governs this account gets a row, whether or not the
   * console's customer list happens to contain it.
   *
   * For a customer administrator that list is empty, so the screen used to draw
   * the platform row and nothing else — the one rule that actually governed
   * them had no row at all, and the notice pointed "oben" at somebody else's.
   */
  const extraScopes = own.scopes.filter(
    (scope) =>
      scope.customerId !== null &&
      !props.customers.some((customer) => customer.id === scope.customerId),
  );

  /*
   * Whether to draw a row as a control or as text.
   *
   * `mayChange` is the API's own answer and wins wherever it exists — that is
   * the only way a row can never offer a change the API refuses (§9.2). The
   * fallback is for the rows this caller holds no grant in and the API
   * therefore said nothing about: the platform's, read-only unless they are a
   * super administrator, and a customer's, which is only listed at all for an
   * operator who manages customers.
   */
  const editable = (customerId: string | null, fallback: boolean): boolean =>
    own.scopes.find((scope) => scope.customerId === customerId)?.mayChange ?? fallback;

  return (
    // No heading here: `Page` draws it from the navigation entry (P30-02).
    <div className="space-y-4">
      {error === undefined ? null : (
        <Notice tone="error">
          <p>{error}</p>
        </Notice>
      )}
      {saved && error === undefined ? (
        <Notice tone="success">
          <p>{de.security.saved}</p>
        </Notice>
      ) : null}

      <Panel title={de.security.secondFactor}>
        <div className="space-y-4">
          <p className="text-sm text-gray-600">{de.security.strictestWins}</p>

          <PolicyRow
            id="policy-platform"
            label={de.security.platformScope}
            hint={de.security.platformHint}
            value={policies.platform}
            // Rendered read-only rather than hidden: an operator should be able
            // to see the rule their own account is under even when somebody
            // else sets it.
            disabled={!editable(null, props.isSuperAdmin)}
            governs={governing.has(null)}
            onChange={(policy) => void save(null, policy)}
          />

          {props.customers.map((customer) => (
            <PolicyRow
              key={customer.id}
              id={`policy-${customer.id}`}
              label={`${de.security.customerScope}: ${customer.name}`}
              hint={undefined}
              value={forCustomer.get(customer.id) ?? "optional"}
              disabled={!editable(customer.id, true)}
              governs={governing.has(customer.id)}
              onChange={(policy) => void save(customer.id, policy)}
            />
          ))}

          {extraScopes.map((scope) => (
            <PolicyRow
              key={scope.customerId}
              id={`policy-${scope.customerId ?? "platform"}`}
              label={scopeLabel(scope)}
              hint={undefined}
              value={forCustomer.get(scope.customerId ?? "") ?? "optional"}
              disabled={!scope.mayChange}
              governs={true}
              onChange={(policy) => void save(scope.customerId, policy)}
            />
          ))}
        </div>
      </Panel>

      {/*
        Where the platform's own mail comes from (P40-01).
        Only for a super administrator: this is not one customer's setting, it
        is the address mail about other people's accounts leaves from. Everyone
        else does not see it, and the API refuses them regardless.
      */}
      {props.isSuperAdmin ? <PlatformSenderPanel apiBase={props.apiBase} /> : null}

      <Panel title={de.security.ownFactor}>
        <div className="space-y-3">
          <p className="text-sm text-gray-600">
            {props.ownSecondFactorEnrolled
              ? de.security.ownFactorEnrolled
              : de.security.ownFactorNone}
          </p>

          {/*
            What the button will actually do, before it is pressed (P69-01).

            Under `required` the removal succeeds and the policy does not
            change, so the next sign-in goes to enrolment — a rotation. Reported
            from production as "i removed the 2factor ... and again after login,
            it is asking for setting a 2factor auth", which is two true
            statements that together read as a broken control.

            Saying it here rather than weakening the rule: a removal that also
            relaxed the policy would let anyone holding a live session turn the
            second factor off for good.
          */}
          {props.ownSecondFactorEnrolled && removalRotates ? (
            <Notice tone="warning">
              {mayRelax
                ? de.security.removeOwnRotates(governingLabels)
                : de.security.removeOwnRotatesLocked(governingLabels)}
            </Notice>
          ) : null}

          {removed ? (
            <Notice tone="success">
              {removalRotates
                ? de.security.removeOwnRotated
                : de.security.removeOwnRemoved}
            </Notice>
          ) : null}

          {props.ownSecondFactorEnrolled ? (
            <ConfirmButton
              label={de.security.removeOwn}
              confirmLabel={
                removalRotates
                  ? de.security.removeOwnConfirmRotates
                  : de.security.removeOwnConfirm
              }
              cancelLabel={de.common.cancel}
              onConfirm={() => void removeOwn()}
            />
          ) : null}
        </div>
      </Panel>
    </div>
  );
}

/**
 * The platform's own mail sender (P40-01).
 *
 * ## Why this screen exists at all
 *
 * A physician's reset mail leaves through their project's SMTP settings, which
 * a customer administrator already configures under Organisation. An operator's
 * cannot: a `super_admin` belongs to no customer, so there is no project whose
 * sender is theirs to borrow, and borrowing one would put a customer's address
 * on mail about accounts that are not theirs.
 *
 * The alternative was `PLATFORM_SMTP_*` in the deployment's env file. This is
 * the better answer for the same reason the Keycloak binding and the embed
 * origins moved out of it: changing where the platform's mail comes from should
 * not need SSH.
 *
 * ## The password box
 *
 * Write-only, like every other stored secret (CLAUDE.md §4 invariant 7). The
 * form shows *whether* one is stored and never what it is, and leaving the box
 * empty keeps it — an operator correcting the sender name must not silently
 * clear the credential and find out days later that no mail is leaving.
 */
function PlatformSenderPanel(props: { apiBase: string }) {
  const [sender, setSender] = useState<PlatformSender | undefined>();
  /*
   * Whether the read has come back at all — which is a different question from
   * whether it found a sender (P188-02).
   *
   * `sender === undefined` conflates three states: still loading, loaded and
   * nothing configured, and loaded but the endpoint refused. The form is
   * rendered on the first of those and not the other two, and the screen says
   * something different for each — §9.6, on a screen rather than in a
   * repository.
   */
  const [loaded, setLoaded] = useState(false);
  const [host, setHost] = useState("");
  const [port, setPort] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [fromAddress, setFromAddress] = useState("");
  const [fromName, setFromName] = useState("");
  const [secure, setSecure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();
  const [saved, setSaved] = useState(false);
  /*
   * The test send is its own state, not folded into `problem`/`saved`
   * (P77-01). A failed test after a successful save is two true statements —
   * "gespeichert" and "der Versand schlug fehl" — and collapsing them would
   * make the screen contradict itself.
   */
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<
    | {
        status: "sent" | "not_configured" | "failed" | "unreachable" | "refused";
        reason?: string;
        sentTo?: string;
      }
    | undefined
  >();

  useEffect(() => {
    void (async () => {
      const current = await readPlatformSender(props.apiBase);
      setLoaded(true);
      if (current === undefined) return;
      setSender(current);
      setHost(current.host ?? "");
      setPort(current.port === null ? "" : String(current.port));
      setUsername(current.username ?? "");
      setFromAddress(current.fromAddress ?? "");
      setFromName(current.fromName ?? "");
      setSecure(current.secure);
    })();
  }, [props.apiBase]);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setProblem(undefined);
    setSaved(false);

    const ok = await writePlatformSender(props.apiBase, {
      host: blank(host),
      port: port.trim() === "" ? null : Number(port),
      username: blank(username),
      // Absent, not null: an empty box means "keep what is stored".
      ...(password === "" ? {} : { password }),
      secure,
      fromAddress: blank(fromAddress),
      fromName: blank(fromName),
    });

    setPassword("");
    setBusy(false);
    if (!ok) {
      setProblem(de.error.generic);
      return;
    }
    setSaved(true);
    setSender(await readPlatformSender(props.apiBase));
  }

  return (
    <Panel title={de.security.platformMail}>
      <p className="max-w-xl text-sm text-gray-600">{de.security.platformMailIntro}</p>

      {/*
        Nothing to type into until the stored settings are here (P188-02).

        The mount effect writes **every** field from the response, so anything
        typed before it lands was silently discarded — and the save then stored
        the empty value and answered "Gespeichert." The journey found it by
        filling the form the way a person does: `Server` came out blank and the
        other five did not, because the response arrived between two
        keystrokes.

        Found in a browser and nowhere else. No API test can see it: the
        endpoint was answering correctly the whole time (§9.13).

        A `touched` flag would also have worked and would have left the second
        defect standing — a blank form during the load reads as "no sender is
        configured", which is the opposite of what a loaded blank form means.
        A field that does not exist yet cannot be misread or clobbered.
      */}
      {!loaded ? (
        <Spinner label={de.loading} />
      ) : (
        <form className="max-w-xl space-y-3" onSubmit={submit}>
          {/*
          Loaded, and the read did not answer. Said out loud rather than drawn
          as an empty form: "we could not read the settings" and "there are no
          settings" are different facts and only one of them is fixed by typing
          into these boxes.
        */}
          {sender === undefined ? (
            <Notice tone="warning">{de.security.platformMailUnreadable}</Notice>
          ) : null}

          {/*
          The one thing an operator actually wants to know, said before they
          scroll: is this configured enough to send anything. `canSend` is the
          server's own answer to that question, not a second implementation of
          it here.
        */}
          {sender === undefined ? null : (
            <Notice tone={sender.canSend ? "success" : "warning"}>
              {sender.canSend
                ? de.security.platformMailReady
                : de.security.platformMailIncomplete}
            </Notice>
          )}

          {problem === undefined ? null : <Notice tone="error">{problem}</Notice>}
          {saved ? <Notice tone="success">{de.security.saved}</Notice> : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={de.organisation.smtpHost} htmlFor="platform-smtp-host">
              <TextInput
                id="platform-smtp-host"
                value={host}
                maxLength={300}
                onChange={setHost}
              />
            </Field>
            <Field label={de.organisation.smtpPort} htmlFor="platform-smtp-port">
              <TextInput
                id="platform-smtp-port"
                value={port}
                type="number"
                onChange={setPort}
              />
            </Field>
            <Field label={de.organisation.smtpUsername} htmlFor="platform-smtp-username">
              <TextInput
                id="platform-smtp-username"
                value={username}
                maxLength={300}
                autoComplete="off"
                onChange={setUsername}
              />
            </Field>
            <Field
              label={de.organisation.smtpPassword}
              hint={de.organisation.smtpPasswordHint}
              htmlFor="platform-smtp-password"
            >
              <TextInput
                id="platform-smtp-password"
                value={password}
                type="password"
                maxLength={300}
                autoComplete="new-password"
                onChange={setPassword}
              />
            </Field>
            <Field label={de.organisation.smtpFromAddress} htmlFor="platform-smtp-from">
              <TextInput
                id="platform-smtp-from"
                value={fromAddress}
                type="email"
                maxLength={320}
                onChange={setFromAddress}
              />
            </Field>
            <Field label={de.organisation.smtpFromName} htmlFor="platform-smtp-from-name">
              <TextInput
                id="platform-smtp-from-name"
                value={fromName}
                maxLength={200}
                onChange={setFromName}
              />
            </Field>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={secure}
              onChange={(event) => setSecure(event.target.checked)}
            />
            <span>{de.security.platformMailSecure}</span>
          </label>

          <p className="text-xs text-gray-600">
            {sender?.hasPassword === true
              ? de.organisation.smtpPasswordStored
              : de.organisation.smtpPasswordMissing}
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={busy}>
              {busy ? de.common.saving : de.common.save}
            </Button>

            {/*
            The test, beside Speichern rather than under it (P77-01).

            No `type` needed: `Button` renders `type={props.type ?? "button"}`,
            so only the Speichern above it — which passes `type="submit"` — can
            submit this form. Setting it here explicitly was redundant, and the
            comment that used to justify it described a hazard this codebase's
            shared button had already removed.

            Disabled until the *stored* settings are complete, because that is
            what it tests: offering it against an unconfigured sender is a
            control that can only produce an error, which is §9.2.
          */}
            <Button
              variant="secondary"
              disabled={busy || testing || sender?.canSend !== true}
              onClick={() => {
                setTesting(true);
                setTestResult(undefined);
                void (async () => {
                  setTestResult(await sendPlatformTestMail(props.apiBase));
                  setTesting(false);
                })();
              }}
            >
              {testing
                ? de.security.platformMailTestSending
                : de.security.platformMailTest}
            </Button>
          </div>

          <p className="text-xs text-gray-600">{de.security.platformMailTestHint}</p>

          {testResult === undefined ? null : (
            <Notice tone={testResult.status === "sent" ? "success" : "warning"}>
              {testResult.status === "sent"
                ? de.security.platformMailTestSent(testResult.sentTo ?? "")
                : testResult.status === "not_configured"
                  ? de.security.platformMailTestNotConfigured
                  : testResult.status === "failed"
                    ? de.security.platformMailTestFailed(testResult.reason ?? "")
                    : testResult.status === "refused"
                      ? de.security.platformMailTestRefused
                      : de.security.platformMailTestUnreachable}
            </Notice>
          )}
        </form>
      )}
    </Panel>
  );
}

/** An empty box is "not set", never an empty string. */
function blank(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * The name of a customer the console happens to know, or a stand-in.
 *
 * The API sends the name for the caller's own scopes, so this is only reached
 * when that read found nothing — a grant outliving a deleted customer. "Ihr
 * Kundenbereich" is then more use than a uuid, and the row still writes the
 * right id.
 */
function nameOf(
  customers: readonly { readonly id: string; readonly name: string }[],
  customerId: string,
): string {
  return (
    customers.find((customer) => customer.id === customerId)?.name ??
    de.security.ownCustomerScope
  );
}

function PolicyRow(props: {
  id: string;
  label: string;
  hint: string | undefined;
  value: SecondFactorPolicy;
  disabled: boolean;
  /** Whether this is the row the reader's own account is under (P74-01). */
  governs: boolean;
  onChange: (policy: SecondFactorPolicy) => void;
}) {
  return (
    // `Field`'s own `hint` is deliberately unused. It renders *below* the
    // control, which would put "what this scope is" and "what the current value
    // does" side by side in the same grey — two sentences that read as one
    // paragraph and answer different questions. The scope note belongs with the
    // label; the consequence belongs with the value.
    <Field
      label={props.governs ? `${props.label} — ${de.security.governsYou}` : props.label}
      htmlFor={props.id}
    >
      {props.hint === undefined ? null : (
        <p className="-mt-1 mb-1 text-xs text-gray-600">{props.hint}</p>
      )}
      {props.disabled ? (
        <p className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900">
          {LABELS[props.value]}
        </p>
      ) : (
        <Select
          id={props.id}
          value={props.value}
          options={POLICIES}
          onChange={props.onChange}
        />
      )}
      {/* The consequence of the *current* value, not of all three. Three
          explanations at once is a wall nobody reads; one sentence about what
          is actually in force is a sentence somebody acts on. */}
      <p className="mt-1 text-xs text-gray-500">{HINTS[props.value]}</p>
    </Field>
  );
}
