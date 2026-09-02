/**
 * The customer registry screen (P12-04).
 *
 * The top of `Kunde → Abteilung → Projekt → Fortbildung → Modul → Kapitel →
 * Inhalt`, and the level that had no screen because it had no endpoint.
 *
 * ## Why the counts are on the list
 *
 * They are what a deletion refusal will be about, so showing them before
 * somebody clicks *Löschen* turns a refusal into something they already
 * expected. They arrive with the list rather than being fetched per row: the
 * API returns them together because a follow-up query would have to open a
 * tenant context on a customer the caller has not been authorised to enter.
 *
 * ## Why the slug is create-only
 *
 * There is no rename field for it, and the API has no parameter to accept one.
 * A slug is what links, bookmarks and runbooks refer to; changing it through
 * the same form that fixes a typo in a company name breaks them silently.
 *
 * ## What this screen does not decide
 *
 * Whether the operator may be here. Only `super_admin` holds the `customer`
 * capability, and the API 403s everyone else regardless of what the console
 * drew. The parent hides the tab as a courtesy; this component still handles
 * the 403, because a URL can be typed.
 */

import { useCallback, useEffect, useState } from "react";
import type { ApiClient, CustomerSummary } from "@ds/sdk";
import { de } from "../locale/de.js";
import { describeError, isForbidden } from "../api.js";
import {
  Button,
  ConfirmButton,
  Field,
  LoadFailure,
  Notice,
  Panel,
  Spinner,
  Table,
  TextInput,
} from "./ui.js";
import { EmptyState } from "./page.js";

export function Customers(props: {
  client: ApiClient;
  /**
   * Tell the shell the registry changed (P22-05).
   *
   * This screen kept its own copy of the customer list and so did `Console`,
   * which fetched once on mount. Creating a customer refreshed *this* copy and
   * not that one — so the customer picker stayed empty and every tenant screen
   * went on saying "no customer has been created yet" while this table listed
   * the customer that had just been created.
   *
   * Two copies of one fact, and the one the rest of the console reads was the
   * one that never updated. The callback is the seam; there is now exactly one
   * fetch that both depend on.
   */
  onChanged: () => void;
}) {
  const { client } = props;
  const [customers, setCustomers] = useState<CustomerSummary[] | undefined>();
  const [problem, setProblem] = useState<string | undefined>();
  const [forbidden, setForbidden] = useState(false);
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setProblem(undefined);
    try {
      setCustomers(await client.adminListCustomers());
    } catch (error) {
      if (isForbidden(error)) setForbidden(true);
      else setProblem(describeError(error, de.customers.loadFailed));
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  async function create(): Promise<void> {
    setBusy(true);
    setProblem(undefined);
    try {
      await client.adminCreateCustomer({ slug: slug.trim(), name: name.trim() });
      setSlug("");
      setName("");
      await load();
      props.onChanged();
    } catch (error) {
      // The API's detail is written for the operator here — "slug already
      // taken" is about what they sent, not about what exists on the server.
      setProblem(describeError(error, de.customers.saveFailed));
    } finally {
      setBusy(false);
    }
  }

  async function remove(customer: CustomerSummary): Promise<void> {
    setProblem(undefined);
    try {
      await client.adminDeleteCustomer(customer.slug);
      await load();
      props.onChanged();
    } catch (error) {
      // A 409 names the counts. Shown verbatim: it is the instruction for what
      // to empty first, and paraphrasing it would drop exactly that.
      setProblem(describeError(error, de.customers.saveFailed));
    }
  }

  if (forbidden) {
    return (
      <Notice tone="warning" title={de.error.title}>
        {de.auth.forbidden}
      </Notice>
    );
  }

  if (customers === undefined) {
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
    // No heading or intro here: `Page` draws both (P30-02).
    <div className="space-y-6">
      {problem === undefined ? null : (
        <Notice tone="error" title={de.error.title}>
          {problem}
        </Notice>
      )}

      {customers.length === 0 ? (
        <EmptyState title={de.customers.empty} description={de.customers.emptyHint} />
      ) : (
        <Table
          headers={[
            de.customers.name,
            de.customers.slug,
            de.customers.departments,
            de.customers.projects,
            de.customers.courses,
            "",
          ]}
        >
          {customers.map((customer) => (
            <tr key={customer.slug} className="border-t border-gray-100">
              <td className="text-sm font-medium">{customer.name}</td>
              <td className="font-mono text-xs text-gray-600">{customer.slug}</td>
              <td className="text-sm tabular-nums">{customer.departmentCount}</td>
              <td className="text-sm tabular-nums">{customer.projectCount}</td>
              <td className="text-sm tabular-nums">{customer.courseCount}</td>
              <td className="text-right">
                <ConfirmButton
                  label={de.customers.remove}
                  confirmLabel={de.customers.removeConfirm}
                  cancelLabel={de.common.cancel}
                  /*
                   * Said before the click, not after. The API refuses a
                   * non-empty customer with a 409 naming the counts; the counts
                   * are already on this row, so the console can explain the
                   * refusal in advance instead of turning it into a surprise.
                   */
                  disabledReason={notEmptyReason(customer)}
                  onConfirm={() => void remove(customer)}
                />
              </td>
            </tr>
          ))}
        </Table>
      )}

      <Panel title={de.customers.create}>
        <div className="space-y-4">
          <Field label={de.customers.name} htmlFor="customer-name">
            <TextInput
              id="customer-name"
              value={name}
              maxLength={200}
              onChange={setName}
            />
          </Field>
          <Field
            label={de.customers.slug}
            htmlFor="customer-slug"
            hint={de.customers.slugHint}
          >
            <TextInput
              id="customer-slug"
              value={slug}
              maxLength={100}
              onChange={setSlug}
            />
          </Field>
          <Button
            onClick={() => void create()}
            disabled={busy || slug.trim() === "" || name.trim() === ""}
          >
            {busy ? de.customers.creating : de.customers.create}
          </Button>
        </div>
      </Panel>
    </div>
  );
}

/**
 * Why this customer cannot be deleted yet, or `undefined` if it can.
 *
 * Mirrors the server's rule rather than replacing it — the API decides, and
 * would refuse this anyway. What it buys is that the operator is not offered a
 * button that cannot work.
 */
function notEmptyReason(customer: CustomerSummary): string | undefined {
  const parts: string[] = [];
  if (customer.departmentCount > 0) {
    parts.push(`${customer.departmentCount} ${de.customers.departments}`);
  }
  if (customer.projectCount > 0) {
    parts.push(`${customer.projectCount} ${de.customers.projects}`);
  }
  if (customer.courseCount > 0) {
    parts.push(`${customer.courseCount} ${de.customers.courses}`);
  }
  return parts.length === 0 ? undefined : `${de.customers.contains} ${parts.join(", ")}`;
}
