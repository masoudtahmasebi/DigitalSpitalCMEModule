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

import { useCallback, useEffect, useState } from "react";
import type { ApiClient, SecondFactorPolicies, SecondFactorPolicy } from "@ds/sdk";
import { describeError } from "../api.js";
import { de } from "../locale/de.js";
import { ConfirmButton, Field, Notice, Panel, Select } from "./ui.js";

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
      setSaved(true);
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

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">{de.security.title}</h2>
        <p className="mt-1 text-sm text-gray-600">{de.security.intro}</p>
      </div>

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
            disabled={!props.isSuperAdmin}
            onChange={(policy) => void save(null, policy)}
          />

          {props.customers.map((customer) => (
            <PolicyRow
              key={customer.id}
              id={`policy-${customer.id}`}
              label={`${de.security.customerScope}: ${customer.name}`}
              hint={undefined}
              value={forCustomer.get(customer.id) ?? "optional"}
              disabled={false}
              onChange={(policy) => void save(customer.id, policy)}
            />
          ))}
        </div>
      </Panel>

      <Panel title={de.security.ownFactor}>
        <div className="space-y-3">
          <p className="text-sm text-gray-600">
            {props.ownSecondFactorEnrolled
              ? de.security.ownFactorEnrolled
              : de.security.ownFactorNone}
          </p>
          {props.ownSecondFactorEnrolled ? (
            <ConfirmButton
              label={de.security.removeOwn}
              confirmLabel={de.security.removeOwnConfirm}
              cancelLabel={de.common.cancel}
              onConfirm={() => void removeOwn()}
            />
          ) : null}
        </div>
      </Panel>
    </div>
  );
}

function PolicyRow(props: {
  id: string;
  label: string;
  hint: string | undefined;
  value: SecondFactorPolicy;
  disabled: boolean;
  onChange: (policy: SecondFactorPolicy) => void;
}) {
  return (
    // `Field`'s own `hint` is deliberately unused. It renders *below* the
    // control, which would put "what this scope is" and "what the current value
    // does" side by side in the same grey — two sentences that read as one
    // paragraph and answer different questions. The scope note belongs with the
    // label; the consequence belongs with the value.
    <Field label={props.label} htmlFor={props.id}>
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
