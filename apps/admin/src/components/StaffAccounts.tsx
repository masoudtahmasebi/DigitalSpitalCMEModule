/**
 * Operator accounts (P12-05).
 *
 * ## The invitation token is shown, not sent
 *
 * There is no mail path yet, and this screen says so rather than pretending.
 * The token appears once, after the invitation is created, for the operator to
 * pass on themselves — it is not stored anywhere this screen can read again, so
 * navigating away loses it and the fix is to invite again.
 *
 * ## What the list does not show
 *
 * Accounts the caller may not manage. The API narrows by `canGrant` before it
 * serialises, so a customer administrator does not see the super
 * administrators above them — not greyed out, absent. The console could not
 * show them if it wanted to.
 *
 * No password hash and no TOTP secret either; only whether a second factor is
 * enrolled. When somebody set up their authenticator is nobody's business but
 * theirs.
 */

import { useCallback, useEffect, useState } from "react";
import type { ApiClient, StaffAccount } from "@ds/sdk";
import { de } from "../locale/de.js";
import { describeError, isForbidden } from "../api.js";
import {
  Badge,
  Button,
  ConfirmButton,
  Field,
  LoadFailure,
  Notice,
  Panel,
  Select,
  Spinner,
  Table,
  TextInput,
} from "./ui.js";

type Role = "course_editor" | "department_admin" | "customer_admin" | "super_admin";

const ROLES: ReadonlyArray<readonly [Role, string]> = [
  ["course_editor", de.staff.roleCourseEditor],
  ["department_admin", de.staff.roleDepartmentAdmin],
  ["customer_admin", de.staff.roleCustomerAdmin],
  ["super_admin", de.staff.roleSuperAdmin],
];

export function StaffAccounts(props: {
  client: ApiClient;
  /** The inviter's own customer, or `null` for a super admin who spans them. */
  customerId: string | null;
  /**
   * The customers a super admin may scope an invitation to. Empty for an
   * operator already inside one — their invitations are scoped to it and there
   * is nothing to choose.
   */
  customers: readonly { readonly id: string; readonly name: string }[];
}) {
  const { client } = props;
  const [rows, setRows] = useState<StaffAccount[] | undefined>();
  const [problem, setProblem] = useState<string | undefined>();
  const [forbidden, setForbidden] = useState(false);
  const [token, setToken] = useState<string | undefined>();

  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<Role>("course_editor");
  const [customerId, setCustomerId] = useState("");
  const [busy, setBusy] = useState(false);

  /*
   * A super admin belongs to no customer, so an invitation to any other role
   * has to name one. `admin_user_roles_scope_matches_role` refuses a
   * customer-scoped grant without a customer id, and the first version of this
   * screen sent the inviter's own `null` and produced exactly that error.
   */
  const mustChooseCustomer = props.customerId === null && role !== "super_admin";

  const load = useCallback(async () => {
    setProblem(undefined);
    try {
      setRows(await client.adminListStaff());
    } catch (error) {
      if (isForbidden(error)) setForbidden(true);
      else setProblem(describeError(error, de.staff.loadFailed));
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  async function invite(): Promise<void> {
    setBusy(true);
    setProblem(undefined);
    setToken(undefined);
    try {
      const result = await client.adminInviteStaff({
        email: email.trim(),
        displayName: displayName.trim(),
        role,
        // `super_admin` spans customers and takes none. Every other role is
        // scoped: to the customer the inviter is acting within, or — when the
        // inviter is a super admin inside none — to the one they picked.
        customerId:
          role === "super_admin" ? null : (props.customerId ?? emptyToNull(customerId)),
        departmentId: null,
      });
      setToken(result.token);
      setEmail("");
      setDisplayName("");
      await load();
    } catch (error) {
      setProblem(describeError(error, de.staff.inviteFailed));
    } finally {
      setBusy(false);
    }
  }

  async function act(run: () => Promise<void>): Promise<void> {
    setProblem(undefined);
    try {
      await run();
      await load();
    } catch (error) {
      setProblem(describeError(error, de.staff.actionFailed));
    }
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
    <div className="space-y-6">
      {/* Heading and intro come from `Page` (P30-02). */}
      {problem === undefined ? null : (
        <Notice tone="error" title={de.error.title}>
          {problem}
        </Notice>
      )}

      {token === undefined ? null : (
        <Notice tone="success" title={de.staff.inviteCreated}>
          <p className="mb-2">{de.staff.inviteHandOver}</p>
          {/* `break-all`: the token is 43 unbroken characters and would
              otherwise push the panel wider than the viewport. */}
          <code className="block break-all text-xs">{token}</code>
        </Notice>
      )}

      <Table
        headers={[
          de.staff.name,
          de.staff.email,
          de.staff.role,
          de.staff.secondFactor,
          de.staff.lastLogin,
          "",
        ]}
      >
        {rows.map((account) => {
          const disabled = account.disabledAt !== null;
          return (
            <tr key={account.id} className="border-t border-gray-100">
              <td className="px-3 py-2 text-sm font-medium">{account.displayName}</td>
              <td className="px-3 py-2 text-sm text-gray-600">{account.email}</td>
              <td className="px-3 py-2 text-sm">
                {account.grants.map((grant) => de.staff.role_[grant.role]).join(", ")}
              </td>
              <td className="px-3 py-2 text-sm">
                <Badge tone={account.totpEnrolled ? "ok" : "muted"}>
                  {account.totpEnrolled ? de.staff.enrolled : de.staff.notEnrolled}
                </Badge>
              </td>
              <td className="px-3 py-2 text-sm">
                {account.lastLoginAt === null ? "—" : account.lastLoginAt.slice(0, 10)}
              </td>
              <td className="px-3 py-2">
                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    variant="secondary"
                    onClick={() =>
                      void act(() => client.adminSignOutStaffEverywhere(account.id))
                    }
                  >
                    {de.staff.signOutEverywhere}
                  </Button>
                  {/* The lost-phone button (P22-02). Only for an account that
                      has one to lose, and never for your own — the API refuses
                      a self-reset, since it would turn a stolen session into a
                      permanently weakened account. */}
                  {account.totpEnrolled ? (
                    <ConfirmButton
                      label={de.staff.resetSecondFactor}
                      confirmLabel={de.staff.resetSecondFactorConfirm}
                      cancelLabel={de.common.cancel}
                      onConfirm={() =>
                        void act(() => client.adminResetStaffSecondFactor(account.id))
                      }
                    />
                  ) : null}
                  {disabled ? (
                    <Button
                      variant="secondary"
                      onClick={() =>
                        void act(() => client.adminSetStaffDisabled(account.id, false))
                      }
                    >
                      {de.staff.enable}
                    </Button>
                  ) : (
                    <ConfirmButton
                      label={de.staff.disable}
                      confirmLabel={de.staff.disableConfirm}
                      cancelLabel={de.common.cancel}
                      onConfirm={() =>
                        void act(() => client.adminSetStaffDisabled(account.id, true))
                      }
                    />
                  )}
                </div>
              </td>
            </tr>
          );
        })}
      </Table>

      <Panel title={de.staff.invite}>
        <div className="space-y-4">
          <Field label={de.staff.name} htmlFor="staff-name">
            <TextInput
              id="staff-name"
              value={displayName}
              maxLength={200}
              onChange={setDisplayName}
            />
          </Field>
          <Field label={de.staff.email} htmlFor="staff-invite-email">
            <TextInput
              id="staff-invite-email"
              type="email"
              value={email}
              maxLength={320}
              onChange={setEmail}
            />
          </Field>
          <Field label={de.staff.role} htmlFor="staff-role" hint={de.staff.roleHint}>
            <Select id="staff-role" value={role} options={ROLES} onChange={setRole} />
          </Field>

          {mustChooseCustomer ? (
            <Field
              label={de.staff.customer}
              htmlFor="staff-customer"
              hint={de.staff.customerHint}
            >
              <Select
                id="staff-customer"
                value={customerId}
                options={[
                  ["", de.staff.customerChoose] as const,
                  ...props.customers.map(
                    (customer) => [customer.id, customer.name] as const,
                  ),
                ]}
                onChange={setCustomerId}
              />
            </Field>
          ) : null}
          <Button
            onClick={() => void invite()}
            disabled={
              busy ||
              email.trim() === "" ||
              displayName.trim() === "" ||
              (mustChooseCustomer && customerId === "")
            }
          >
            {busy ? de.staff.inviting : de.staff.invite}
          </Button>
        </div>
      </Panel>
    </div>
  );
}

function emptyToNull(value: string): string | null {
  return value.trim() === "" ? null : value;
}
