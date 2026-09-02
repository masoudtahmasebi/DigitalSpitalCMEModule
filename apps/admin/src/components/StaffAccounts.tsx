/**
 * Operator accounts (P12-05).
 *
 * ## The invitation is emailed when it can be, and shown either way (P40-05)
 *
 * The API sends the invitation itself when the platform has a sender
 * configured (Sicherheit → E-Mail-Versand der Plattform). It comes back either
 * way, because an invitation must not be lost because a mail server was down —
 * so this screen always shows the link and says which of the two happened.
 *
 * **The link, not the token.** It used to render the bare 43-character token
 * under a sentence beginning "Dieser Link", which is how somebody came to try
 * it as a password: they were told to hand over a link, shown a string that was
 * not one, and given nothing else to do with it.
 *
 * It is shown once and stored nowhere this screen can read again, so navigating
 * away loses it and the fix is to invite again. That is a property of the
 * design rather than an oversight: the token's only copy in the database is a
 * hash, deliberately.
 *
 * ## Why nobody can set a password *for* an invited operator
 *
 * There is no field for it and there will not be. An invited account is created
 * with `password_hash NULL` — asserted by an integration test whose name is
 * "creates the account without a password, so the invitation is not a
 * credential" — and the invitee chooses their own. A password an administrator
 * typed is a password an administrator knows, on an account that can read every
 * physician's participation record for a customer.
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
  /**
   * The signed-in operator's own account id (P38-07).
   *
   * Needed to tell their row apart from everybody else's, because the one
   * action on this screen that must not be offered on your own row is exactly
   * the one that looks most useful there — see the reset button below.
   */
  ownAccountId: string;
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
  /*
   * The whole invitation, not just its token: the link an operator has to hand
   * over, and whether the platform already emailed it.
   */
  const [invitation, setInvitation] = useState<
    { link: string; delivered: boolean } | undefined
  >();
  const [copied, setCopied] = useState(false);

  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<Role>("course_editor");
  const [customerId, setCustomerId] = useState("");
  const [busy, setBusy] = useState(false);

  /*
   * The password an administrator sets directly (P64-01).
   *
   * Empty means "invite instead", which keeps the invitation path exactly as it
   * was: a form with one optional field, not two forms. `created` is what came
   * back the last time, so the screen can confirm the account exists and has
   * this password rather than showing an invitation box with nothing in it.
   */
  const [password, setPassword] = useState("");
  const [created, setCreated] = useState<string | undefined>();

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
    setInvitation(undefined);
    try {
      const result = await client.adminInviteStaff({
        email: email.trim(),
        displayName: displayName.trim(),
        role,
        // Omitted entirely when blank, rather than sent as "": the API's two
        // paths are chosen by the field's presence, and an empty string is a
        // password somebody typed nothing into, not a request to invite.
        ...(password === "" ? {} : { password }),
        // `super_admin` spans customers and takes none. Every other role is
        // scoped: to the customer the inviter is acting within, or — when the
        // inviter is a super admin inside none — to the one they picked.
        customerId:
          role === "super_admin" ? null : (props.customerId ?? emptyToNull(customerId)),
        departmentId: null,
      });
      setCopied(false);
      setCreated(undefined);
      setInvitation(undefined);

      if (result.token === null) {
        // A password was set, so there is no link and nothing to hand over
        // except the password the administrator already has. Saying which
        // account it was is the whole confirmation (CLAUDE.md §9.4).
        setCreated(email.trim());
      } else {
        /*
         * Built here, from this page's own origin, because the console is the
         * one place that knows where it is served from. The API builds the same
         * link for the mail it sends — from an origin it trusts rather than one
         * a caller named — and the two agree because both point at the console.
         */
        setInvitation({
          link: `${window.location.origin}/#passwort-neu?token=${encodeURIComponent(result.token)}`,
          delivered: result.delivered,
        });
      }
      setEmail("");
      setDisplayName("");
      setPassword("");
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

      {/*
        What an invitation actually produces (P40-05).

        This used to render the bare token under a sentence beginning "Dieser
        Link" — so an operator was told to hand over a link and shown a
        43-character string that was not one. It was reported exactly that way:
        an account created, a weird string shown, no way to give the person a
        password, and the string tried as a password because nothing said what
        else it could be.

        Now it is the link, it says whether the invitation was emailed, and it
        can be copied in one click.
      */}
      {created === undefined ? null : (
        <Notice tone="success" title={de.staff.createdTitle}>
          {de.staff.createdBody(created)}
        </Notice>
      )}

      {invitation === undefined ? null : (
        <Notice tone="success" title={de.staff.inviteCreated}>
          <p className="mb-2">
            {invitation.delivered ? de.staff.inviteSent : de.staff.inviteHandOver}
          </p>
          <code className="mb-2 block break-all text-xs">{invitation.link}</code>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                void navigator.clipboard
                  ?.writeText(invitation.link)
                  .then(() => setCopied(true))
                  // Silently: the link is on screen and selectable, so a
                  // clipboard the browser refused is an inconvenience rather
                  // than a failure worth an error box.
                  .catch(() => undefined);
              }}
            >
              {copied ? de.staff.inviteCopied : de.staff.inviteCopy}
            </Button>
            <span className="text-xs text-gray-600">{de.staff.inviteValidity}</span>
          </div>
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
              <td className="text-sm font-medium">{account.displayName}</td>
              <td className="text-sm text-gray-600">{account.email}</td>
              <td className="text-sm">
                {account.grants.map((grant) => de.staff.role_[grant.role]).join(", ")}
              </td>
              <td className="text-sm">
                <Badge tone={account.totpEnrolled ? "ok" : "muted"}>
                  {account.totpEnrolled ? de.staff.enrolled : de.staff.notEnrolled}
                </Badge>
              </td>
              <td className="text-sm">
                {account.lastLoginAt === null ? "—" : account.lastLoginAt.slice(0, 10)}
              </td>
              <td>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    variant="secondary"
                    onClick={() =>
                      void act(() => client.adminSignOutStaffEverywhere(account.id))
                    }
                  >
                    {de.staff.signOutEverywhere}
                  </Button>
                  {/*
                    The lost-phone button (P22-02). Only for an account that has
                    one to lose, and **never for your own**.

                    That second condition was stated in this comment and absent
                    from the code (P38-07). The API refuses a self-reset —
                    `canResetSecondFactorOf` returns `self_escalation`, because
                    a path that does not check policy must not be reachable for
                    oneself, or a stolen session could permanently strip its own
                    second factor. So the button rendered on your own row, was
                    the obvious thing to click, and answered 403 every time.

                    Your own factor is the Sicherheit screen's business, where
                    removing it is governed by the policy that applies to you
                    rather than by this unconditional path.
                  */}
                  {account.totpEnrolled && account.id !== props.ownAccountId ? (
                    <ConfirmButton
                      label={de.staff.resetSecondFactor}
                      confirmLabel={de.staff.resetSecondFactorConfirm}
                      cancelLabel={de.common.cancel}
                      onConfirm={() =>
                        void act(() => client.adminResetStaffSecondFactor(account.id))
                      }
                    />
                  ) : null}
                  {/*
                    Change this operator's password (P64-01).

                    On every row including your own: changing your own password
                    is an ordinary thing to want, the API permits it, and a
                    control hidden on the row where it works would be the mirror
                    of the second-factor defect above.
                  */}
                  <SetPassword
                    accountId={account.id}
                    email={account.email}
                    onSet={(next) =>
                      act(() => client.adminSetStaffPassword(account.id, next))
                    }
                  />
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

          {/*
            The optional password (P64-01).

            One form with an optional field rather than two forms, because the
            decision is "do I already know what this person's password should
            be?" and not a different kind of account. The hint says what happens
            in each case, at the point somebody is deciding (CLAUDE.md §9.4) —
            an empty field that silently changes the outcome is exactly the
            thing that had people asking how to create an account with a
            password.
          */}
          <Field
            label={de.staff.password}
            htmlFor="staff-password"
            hint={de.staff.passwordHint}
          >
            <TextInput
              id="staff-password"
              type="password"
              value={password}
              maxLength={200}
              onChange={setPassword}
            />
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
            {busy
              ? de.staff.inviting
              : password === ""
                ? de.staff.invite
                : de.staff.createWithPassword}
          </Button>
        </div>
      </Panel>
    </div>
  );
}

function emptyToNull(value: string): string | null {
  return value.trim() === "" ? null : value;
}

/**
 * The per-row password change (P64-01).
 *
 * Inline rather than a modal, on `ConfirmButton`'s reasoning: a modal has to
 * trap focus, restore it and handle Escape, and getting any of that subtly
 * wrong makes the console unusable by keyboard — for one field.
 *
 * The field is `type="password"` so a shoulder-surfer in an open-plan office
 * does not read it off the screen, and it is cleared as soon as the change
 * succeeds so it does not sit in the DOM afterwards. The administrator knows
 * what they typed; nothing needs to show it back.
 */
function SetPassword(props: {
  accountId: string;
  email: string;
  onSet: (password: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <Button
        variant="secondary"
        ariaLabel={de.staff.setPasswordFor(props.email)}
        onClick={() => setOpen(true)}
      >
        {de.staff.setPassword}
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field
        label={de.staff.newPassword}
        htmlFor={`staff-pw-${props.accountId}`}
        hint={de.staff.newPasswordHint}
      >
        <TextInput
          id={`staff-pw-${props.accountId}`}
          type="password"
          value={value}
          maxLength={200}
          onChange={setValue}
        />
      </Field>
      <Button
        disabled={busy || value === ""}
        onClick={() => {
          setBusy(true);
          void props.onSet(value).finally(() => {
            setBusy(false);
            setValue("");
            setOpen(false);
          });
        }}
      >
        {busy ? de.staff.settingPassword : de.common.save}
      </Button>
      <Button
        variant="secondary"
        onClick={() => {
          setValue("");
          setOpen(false);
        }}
      >
        {de.common.cancel}
      </Button>
    </div>
  );
}
