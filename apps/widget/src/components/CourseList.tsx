/**
 * The Fortbildungsbereich — the course list (P5, layout §4.1).
 *
 * ## What the server decides and what this decides
 *
 * Filtering, faceting and paging all happen in the API. This screen holds the
 * *selection* and re-fetches; it never filters an array it already has. That
 * is not only about correctness with paging — the facet counts have to reflect
 * the tenant's whole catalogue, and a client-side filter over one page would
 * show counts that shrink as the learner pages through.
 *
 * ## Delivery-type tabs
 *
 * `On Demand · Live · Präsenz` are in the layout and the schema, and only
 * `on_demand` has content for launch (`docs/show-stoppers.md` S8). The tabs are
 * rendered anyway rather than hidden: a tab that shows "keine Fortbildungen"
 * is a truthful empty state, whereas hiding two of three tabs and adding them
 * later changes the shape of the page under a returning learner.
 *
 * ## Filters as chips
 *
 * A dropdown sets a filter; the filter then appears as a removable chip. Both
 * controls drive the same state, so a chip's ✕ and re-selecting "Alle" in the
 * dropdown do exactly the same thing — there is no second code path that could
 * clear one but not the other.
 */

import { useState } from "react";
import type { ApiClient, CourseSummary, DeliveryType } from "@ds/sdk";
import { de } from "../locale/de.js";
import { describeError, useAsync } from "../hooks.js";
import { Button, ErrorNotice, Spinner } from "./primitives.js";

const DELIVERY_TYPES: readonly DeliveryType[] = ["on_demand", "live", "praesenz"];
const PER_PAGE = 10;

interface Filters {
  readonly deliveryType: DeliveryType;
  readonly thema: string | undefined;
  readonly altersgruppe: string | undefined;
  readonly page: number;
}

const INITIAL: Filters = {
  deliveryType: "on_demand",
  thema: undefined,
  altersgruppe: undefined,
  page: 1,
};

export function CourseList(props: { client: ApiClient; onOpen: (slug: string) => void }) {
  const { client } = props;
  const [filters, setFilters] = useState<Filters>(INITIAL);

  const list = useAsync(
    () =>
      client.listCourses({
        deliveryType: filters.deliveryType,
        ...(filters.thema === undefined ? {} : { thema: filters.thema }),
        ...(filters.altersgruppe === undefined
          ? {}
          : { altersgruppe: filters.altersgruppe }),
        page: filters.page,
        perPage: PER_PAGE,
      }),
    [client, filters],
  );

  /**
   * Any change to what is being asked for resets to page 1. Without this, a
   * learner on page 3 who narrows a filter lands on an empty page 3 of a
   * shorter result set and sees "keine Fortbildungen" for a filter that
   * matches several.
   */
  function set(patch: Partial<Omit<Filters, "page">>): void {
    setFilters((current) => ({ ...current, ...patch, page: 1 }));
  }

  if (list.loading && list.data === undefined) return <Spinner label={de.loading} />;

  if (list.data === undefined) {
    return (
      <ErrorNotice
        title={de.error.title}
        message={describeError(list.error, de.error)}
        retryLabel={de.error.retry}
        onRetry={list.reload}
      />
    );
  }

  const { items, facets, total, page, perPage } = list.data;
  const lastPage = Math.max(1, Math.ceil(total / perPage));

  return (
    <section className="space-y-5">
      <h1 className="text-xl font-bold text-gray-900">{de.catalog.title}</h1>

      <nav className="flex gap-1 border-b border-gray-200" aria-label={de.catalog.title}>
        {DELIVERY_TYPES.map((value) => (
          <button
            key={value}
            type="button"
            aria-current={filters.deliveryType === value ? "page" : undefined}
            onClick={() => set({ deliveryType: value })}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
              filters.deliveryType === value
                ? "border-brand-600 text-brand-700"
                : "border-transparent text-gray-600"
            }`}
          >
            {de.catalog.deliveryType[value]}
          </button>
        ))}
      </nav>

      <div className="flex flex-wrap items-end gap-4">
        <FacetSelect
          id="ds-thema"
          label={de.catalog.thema}
          value={filters.thema}
          options={facets.thema}
          onChange={(thema) => set({ thema })}
        />
        <FacetSelect
          id="ds-altersgruppe"
          label={de.catalog.altersgruppe}
          value={filters.altersgruppe}
          options={facets.altersgruppe}
          onChange={(altersgruppe) => set({ altersgruppe })}
        />
      </div>

      {filters.thema === undefined && filters.altersgruppe === undefined ? null : (
        <ul className="flex flex-wrap gap-2" aria-label={de.catalog.activeFilters}>
          {filters.thema === undefined ? null : (
            <FilterChip
              label={filters.thema}
              onRemove={() => set({ thema: undefined })}
            />
          )}
          {filters.altersgruppe === undefined ? null : (
            <FilterChip
              label={filters.altersgruppe}
              onRemove={() => set({ altersgruppe: undefined })}
            />
          )}
        </ul>
      )}

      {items.length === 0 ? (
        <p className="py-8 text-sm text-gray-600">{de.catalog.empty}</p>
      ) : (
        <ul className="space-y-4">
          {items.map((course) => (
            <li key={course.slug}>
              <CourseCard course={course} onOpen={() => props.onOpen(course.slug)} />
            </li>
          ))}
        </ul>
      )}

      {lastPage > 1 ? (
        <Pagination
          page={page}
          lastPage={lastPage}
          onPage={(next) => setFilters((current) => ({ ...current, page: next }))}
        />
      ) : null}
    </section>
  );
}

function CourseCard(props: { course: CourseSummary; onOpen: () => void }) {
  const { course } = props;

  return (
    <article className="rounded-[var(--ds-radius)] border border-gray-200 p-4">
      <div className="flex gap-4">
        {course.heroImageUrl === null ? null : (
          <img
            src={course.heroImageUrl}
            // Decorative: the course title is the accessible name, immediately
            // beside it. An alt repeating the title makes a screen reader say
            // it twice.
            alt=""
            className="hidden h-24 w-32 rounded object-cover sm:block"
            referrerPolicy="no-referrer"
          />
        )}

        <div className="min-w-0 flex-1 space-y-2">
          <h2 className="text-base font-semibold text-gray-900">{course.title}</h2>

          <p className="text-sm text-gray-600">{de.catalog.cardMeta(course)}</p>

          {course.description === null ? null : (
            <p className="line-clamp-2 text-sm text-gray-700">{course.description}</p>
          )}

          {/* The CTA is the server's answer, not a guess from the card's own
              fields: `enrolment` is the caller's row, or null. */}
          <Button onClick={props.onOpen}>
            {course.enrolment === null
              ? de.catalog.open
              : course.enrolment.complete
                ? de.catalog.review
                : de.overview.resume}
          </Button>
        </div>
      </div>
    </article>
  );
}

function FacetSelect(props: {
  id: string;
  label: string;
  value: string | undefined;
  options: readonly { value: string; count: number }[];
  onChange: (value: string | undefined) => void;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={props.id} className="block text-sm font-medium text-gray-900">
        {props.label}
      </label>
      <select
        id={props.id}
        value={props.value ?? ""}
        onChange={(event) =>
          props.onChange(event.target.value === "" ? undefined : event.target.value)
        }
        className="rounded-[var(--ds-radius)] border border-gray-300 px-3 py-2 text-sm"
      >
        <option value="">{de.catalog.all}</option>
        {props.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.value} ({option.count})
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * An active filter, with its own removal.
 *
 * The whole chip is the button and `aria-label` is its accessible name — the
 * visible text is marked decorative so a screen reader announces "Filter
 * „ADHS" entfernen" once, rather than the value followed by an instruction.
 * A chip whose name is just the value would tell somebody what is filtered
 * without telling them that activating it undoes that.
 */
function FilterChip(props: { label: string; onRemove: () => void }) {
  return (
    <li>
      <button
        type="button"
        aria-label={de.catalog.removeFilter(props.label)}
        onClick={props.onRemove}
        className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-800"
      >
        <span aria-hidden="true">{props.label}</span>
        <span aria-hidden="true">✕</span>
      </button>
    </li>
  );
}

function Pagination(props: {
  page: number;
  lastPage: number;
  onPage: (page: number) => void;
}) {
  const pages = Array.from({ length: props.lastPage }, (_, index) => index + 1);

  return (
    <nav className="flex flex-wrap items-center gap-2" aria-label={de.catalog.pagination}>
      <Button
        variant="secondary"
        disabled={props.page <= 1}
        onClick={() => props.onPage(props.page - 1)}
      >
        {de.catalog.previous}
      </Button>

      {pages.map((page) => (
        <button
          key={page}
          type="button"
          aria-current={page === props.page ? "page" : undefined}
          aria-label={de.catalog.goToPage(page)}
          onClick={() => props.onPage(page)}
          className={`min-w-9 rounded-[var(--ds-radius)] px-3 py-2 text-sm font-medium ${
            page === props.page
              ? "bg-brand-600 text-[var(--ds-brand-contrast)]"
              : "border border-gray-300 text-gray-800"
          }`}
        >
          {page}
        </button>
      ))}

      <Button
        variant="secondary"
        disabled={props.page >= props.lastPage}
        onClick={() => props.onPage(props.page + 1)}
      >
        {de.catalog.next}
      </Button>
    </nav>
  );
}
