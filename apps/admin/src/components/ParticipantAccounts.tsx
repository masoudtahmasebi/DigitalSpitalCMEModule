/**
 * Participant accounts (P21-04).
 *
 * ## Why this is a separate screen from `Participants.tsx`
 *
 * That one lists **enrolments** — a row per person per course, with a watch
 * percentage and an EIV state — and it lives inside a course. This one lists
 * **people**, across the customer. The distinction is not academic: somebody
 * created two minutes ago has enrolled in nothing and appears on the other
 * screen not at all, which is precisely when an administrator needs to find
 * them to pass on their password.
 *
 * ## The password is shown once, and the screen has to make that obvious
 *
 * The API returns it in the create response and in no other call. There is no
 * column it could be read out of — only an Argon2id hash is stored. So the
 * screen keeps it in component state, says plainly that it will not be shown
 * again, and offers a copy button; closing the panel loses it, and the remedy
 * is a reset rather than a lookup.
 *
 * That is a deliberate trade against mailing an invitation link, which would be
 * friendlier and is a credential-delivery channel nobody has yet decided the
 * SMTP arrangements for (S8).
 */

import { useCallback, useEffect, useState } from "react";
import type { ApiClient, ParticipantAccount } from "@ds/sdk";
import { de } from "../locale/de.js";
import { describeError } from "../api.js";
import { MergeParticipants } from "./MergeParticipants.js";
import {
  Badge,
  Button,
  Field,
  LoadFailure,
  Notice,
  Panel,
  Spinner,
  Table,
  TextInput,
} from "./ui.js";

type Issued = { readonly email: string; readonly password: string };

export function ParticipantAccounts(props: { client: ApiClient }) {
  const { client } = props;
  const [rows, setRows] = useState<readonly ParticipantAccount[] | undefined>();
  const [search, setSearch] = useState("");
  const [problem, setProblem] = useState<string | undefined>();
  const [busy, setBusy] = useState<string | undefined>();

  /** The one and only copy of a password we just caused to exist. */
  const [issued, setIssued] = useState<Issued | undefined>();

  const load = useCallback(
    async (term: string) => {
      try {
        setRows(await client.adminListParticipantAccounts(term));
        setProblem(undefined);
      } catch (error) {
        setProblem(describeError(error, de.participantAccounts.title));
      }
    },
    [client],
  );

  useEffect(() => {
    // Debounced, because this fires on every keystroke and the query is a
    // `LIKE` over every person on the platform.
    const timer = setTimeout(() => void load(search), 250);
    return () => clearTimeout(timer);
  }, [load, search]);

  async function act(key: string, run: () => Promise<void>) {
    setBusy(key);
    setProblem(undefined);
    try {
      await run();
      await load(search);
    } catch (error) {
      setProblem(describeError(error, de.participantAccounts.title));
    } finally {
      setBusy(undefined);
    }
  }

  if (rows === undefined && problem !== undefined) {
    return (
      <LoadFailure
        title={de.participantAccounts.title}
        retryLabel={de.error.retry}
        problem={problem}
        onRetry={() => void load(search)}
      />
    );
  }

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">
            {de.participantAccounts.title}
          </h2>
          <p className="text-sm text-gray-600">{de.participantAccounts.intro}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {/*
            Next to "Neuen Zugang anlegen" because the two answer the same
            question from opposite ends: this person has no account, or this
            person has two. An operator who has just been refused a create with
            "Für diese E-Mail-Adresse existiert bereits ein Zugang" is standing
            exactly here.

            The API refuses anybody but a `super_admin`, and does so with a 403
            the panel shows — rather than the console hiding the button, which
            would leave a customer admin with no way to find out that the
            operation exists and who can perform it.
          */}
          <MergeParticipants client={client} onMerged={() => void load(search)} />
          <NewParticipant
            client={client}
            onCreated={(next) => {
              setIssued(next);
              void load(search);
            }}
            onProblem={setProblem}
          />
        </div>
      </header>

      {issued === undefined ? null : (
        <IssuedPassword issued={issued} onDismiss={() => setIssued(undefined)} />
      )}

      {problem === undefined ? null : <Notice tone="error">{problem}</Notice>}

      <Field label={de.participantAccounts.search} htmlFor="participant-search">
        <TextInput id="participant-search" value={search} onChange={setSearch} />
      </Field>

      {rows === undefined ? (
        <Spinner label={de.loading} />
      ) : rows.length === 0 ? (
        // An empty state that names the next step, rather than "keine Daten".
        // This screen is reached most often by somebody who has just been given
        // a customer and has nobody in it yet.
        <Notice tone="warning">{de.participantAccounts.empty}</Notice>
      ) : (
        <Table headers={de.participantAccounts.headers}>
          {rows.map((row) => (
            <tr key={row.userId} className="border-t border-gray-100">
              <td className="px-3 py-2">
                <div className="font-medium text-gray-900">
                  {[row.firstName, row.lastName].filter(Boolean).join(" ") || "—"}
                </div>
                <div className="text-xs text-gray-600">{row.email ?? "—"}</div>
              </td>
              <td className="px-3 py-2 text-sm text-gray-700">
                {row.completedCount} / {row.enrolmentCount}
              </td>
              <td className="px-3 py-2">
                <StatusBadge account={row} />
              </td>
              <td className="px-3 py-2">
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    // A federated participant has no password here to reset.
                    // Disabled rather than hidden, so the reason can be read.
                    disabled={
                      row.credential === null ||
                      row.credential === undefined ||
                      busy === row.userId
                    }
                    onClick={() =>
                      void act(row.userId, async () => {
                        const { temporaryPassword } =
                          await client.adminResetParticipantPassword(row.userId);
                        setIssued({
                          email: row.email ?? "",
                          password: temporaryPassword,
                        });
                      })
                    }
                  >
                    {de.participantAccounts.reset}
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={
                      row.credential === null ||
                      row.credential === undefined ||
                      busy === row.userId
                    }
                    onClick={() =>
                      void act(row.userId, () =>
                        client.adminSetParticipantDisabled(
                          row.userId,
                          row.credential?.disabled !== true,
                        ),
                      )
                    }
                  >
                    {row.credential?.disabled === true
                      ? de.participantAccounts.enable
                      : de.participantAccounts.disable}
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </Table>
      )}
    </section>
  );
}

function StatusBadge(props: { account: ParticipantAccount }) {
  const credential = props.account.credential;
  if (credential === null || credential === undefined) {
    return <Badge tone="muted">{de.participantAccounts.federated}</Badge>;
  }
  if (credential.disabled) {
    return <Badge tone="warn">{de.participantAccounts.disabled}</Badge>;
  }
  if (credential.lockedUntil !== null) {
    return <Badge tone="warn">{de.participantAccounts.locked}</Badge>;
  }
  if (credential.mustChange) {
    return <Badge tone="muted">{de.participantAccounts.mustChange}</Badge>;
  }
  return <Badge tone="ok">{de.participantAccounts.active}</Badge>;
}

/**
 * The password, once.
 *
 * Loud on purpose. Somebody who closes this without copying it has to reset,
 * and a quiet grey line is how that happens.
 */
function IssuedPassword(props: { issued: Issued; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false);

  return (
    <Panel title={de.participantAccounts.issuedTitle}>
      <p className="text-sm text-gray-700">{de.participantAccounts.issuedBody}</p>
      <dl className="mt-3 space-y-1 text-sm">
        <div className="flex gap-2">
          <dt className="w-28 text-gray-600">{de.participantAccounts.email}</dt>
          <dd className="font-mono text-gray-900">{props.issued.email}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-28 text-gray-600">{de.participantAccounts.password}</dt>
          <dd className="font-mono text-gray-900">{props.issued.password}</dd>
        </div>
      </dl>
      <div className="mt-3 flex gap-2">
        <Button
          variant="secondary"
          onClick={() => {
            // `navigator.clipboard` is absent over plain HTTP and in some
            // embedded browsers. Failing silently would leave the button doing
            // nothing; the password is on screen either way, so the fallback is
            // simply not to claim success.
            void navigator.clipboard
              ?.writeText(props.issued.password)
              .then(() => setCopied(true))
              .catch(() => setCopied(false));
          }}
        >
          {copied ? de.participantAccounts.copied : de.participantAccounts.copy}
        </Button>
        <Button variant="secondary" onClick={props.onDismiss}>
          {de.participantAccounts.dismiss}
        </Button>
      </div>
    </Panel>
  );
}

function NewParticipant(props: {
  client: ApiClient;
  onCreated: (issued: Issued) => void;
  onProblem: (problem: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [saving, setSaving] = useState(false);

  if (!open) {
    return <Button onClick={() => setOpen(true)}>{de.participantAccounts.create}</Button>;
  }

  return (
    <Panel title={de.participantAccounts.create}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={de.participantAccounts.firstName} htmlFor="p-first">
          <TextInput id="p-first" value={firstName} onChange={setFirstName} />
        </Field>
        <Field label={de.participantAccounts.lastName} htmlFor="p-last">
          <TextInput id="p-last" value={lastName} onChange={setLastName} />
        </Field>
        <Field label={de.participantAccounts.email} htmlFor="p-email">
          <TextInput id="p-email" type="email" value={email} onChange={setEmail} />
        </Field>
      </div>
      <p className="mt-2 text-xs text-gray-600">{de.participantAccounts.nameWhy}</p>
      <div className="mt-3 flex gap-2">
        <Button
          // Both names required, because a Teilnahmebescheinigung prints one
          // and cannot be issued without it. The API refuses too; disabling the
          // button is so nobody has to discover that at the end of a course.
          disabled={saving || email === "" || firstName === "" || lastName === ""}
          onClick={() => {
            setSaving(true);
            props.client
              .adminCreateParticipant({ email, firstName, lastName })
              .then(({ temporaryPassword }) => {
                props.onCreated({ email, password: temporaryPassword });
                setOpen(false);
                setEmail("");
                setFirstName("");
                setLastName("");
              })
              .catch((error: unknown) =>
                props.onProblem(describeError(error, de.participantAccounts.create)),
              )
              .finally(() => setSaving(false));
          }}
        >
          {saving ? de.common.saving : de.participantAccounts.create}
        </Button>
        <Button variant="secondary" onClick={() => setOpen(false)}>
          {de.common.cancel}
        </Button>
      </div>
    </Panel>
  );
}
