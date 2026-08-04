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
import { Button, ErrorNotice, ImagePlaceholder, Spinner } from "./primitives.js";

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

  const hasChips = filters.thema !== undefined || filters.altersgruppe !== undefined;

  return (
    <section>
      <CatalogHero />

      {/* The tab row sits on the panel's top edge, so the two are one element
          rather than a strip of buttons above a box. */}
      <div className="mt-6 px-1">
        <div
          role="tablist"
          aria-label={de.catalog.title}
          className="flex flex-wrap gap-2"
        >
          {DELIVERY_TYPES.map((value) => {
            const selected = filters.deliveryType === value;
            return (
              <button
                key={value}
                role="tab"
                type="button"
                aria-selected={selected}
                onClick={() => set({ deliveryType: value })}
                className={`rounded-t-xl px-7 py-2.5 text-sm font-semibold transition-colors ${
                  selected
                    ? "border border-b-0 border-gray-100 bg-white text-brand-700"
                    : "bg-brand-600 text-brand-contrast hover:bg-brand-700"
                }`}
              >
                {de.catalog.deliveryType[value]}
              </button>
            );
          })}
        </div>

        <div className="rounded-b-2xl rounded-tr-2xl border border-gray-100 bg-white shadow-sm">
          <div className="border-b border-gray-200 p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <FacetSelect
                id="ds-thema"
                label={de.catalog.thema}
                placeholder={de.catalog.selectThema}
                value={filters.thema}
                options={facets.thema}
                onChange={(thema) => set({ thema })}
              />
              <FacetSelect
                id="ds-altersgruppe"
                label={de.catalog.altersgruppe}
                placeholder={de.catalog.selectAltersgruppe}
                value={filters.altersgruppe}
                options={facets.altersgruppe}
                onChange={(altersgruppe) => set({ altersgruppe })}
              />
            </div>

            {!hasChips ? null : (
              <ul
                className="mt-4 flex flex-wrap gap-2"
                aria-label={de.catalog.activeFilters}
              >
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
          </div>

          {items.length === 0 ? (
            <p className="p-8 text-sm text-gray-600">{de.catalog.empty}</p>
          ) : (
            <ul className="divide-y divide-gray-200">
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
        </div>
      </div>
    </section>
  );
}

/**
 * The teal banner from layout §4.1.
 *
 * Text only — the layout's photograph belongs to the customer and there is no
 * field for it on a *catalogue* (only courses carry a hero image), so putting
 * one here would mean either a hard-coded asset or a third-party URL. ADR-0009
 * rules out the second and multi-tenancy rules out the first. The gradient
 * stands in for it and the seal, which is meaningful rather than decorative,
 * is drawn.
 */
function CatalogHero() {
  return (
    <div className="relative overflow-hidden rounded-2xl bg-brand-600 px-6 py-10 text-brand-contrast sm:px-10 sm:py-12">
      <p className="text-xs font-semibold uppercase tracking-widest">
        {de.catalog.eyebrow}
      </p>
      <h1 className="mt-2 max-w-2xl text-3xl font-bold sm:text-4xl">
        {de.catalog.title}
      </h1>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-brand-100">
        {de.catalog.intro}
      </p>

      {/* Hidden below `sm`: at 360 px it would overlap the heading, and it
          repeats what the CME points on every card already say. */}
      <div className="absolute right-8 top-1/2 hidden h-28 w-28 -translate-y-1/2 items-center justify-center rounded-full bg-cta-500 text-center text-cta-contrast shadow-lg sm:flex">
        <span className="flex flex-col leading-tight">
          <span className="text-[10px] font-medium">{de.catalog.sealTop}</span>
          <span className="text-2xl font-extrabold">{de.catalog.sealMain}</span>
          <span className="text-[10px] font-medium">{de.catalog.sealBottom}</span>
        </span>
      </div>
    </div>
  );
}

function CourseCard(props: { course: CourseSummary; onOpen: () => void }) {
  const { course } = props;

  // Started but not finished. The layout gives this case a second, orange
  // button beside the neutral one — "Zur Fortbildung" opens the detail page,
  // "Fortbildung fortsetzen" goes straight back to where they stopped. Both
  // land on the same screen here; the distinction the layout draws is between
  // *browsing* and *resuming*, and only the second is worth an accent colour.
  const inProgress = course.enrolment !== null && !course.enrolment.complete;

  return (
    <article className="flex flex-col gap-5 p-5 sm:flex-row">
      {course.heroImageUrl === null ? (
        <ImagePlaceholder className="h-44 w-full shrink-0 rounded-xl sm:h-auto sm:min-h-[11rem] sm:w-64" />
      ) : (
        <img
          src={course.heroImageUrl}
          // Decorative: the course title is the accessible name, immediately
          // beside it. An alt repeating the title makes a screen reader say
          // it twice.
          alt=""
          className="h-44 w-full shrink-0 rounded-xl object-cover sm:h-auto sm:min-h-[11rem] sm:w-64"
          referrerPolicy="no-referrer"
        />
      )}

      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-brand-600">
          {de.catalog.cardMeta(course)}
        </p>

        <h2 className="mt-1 text-xl font-bold leading-snug text-gray-900">
          {course.title}
        </h2>

        {course.description === null ? null : (
          <p className="mt-2 line-clamp-4 text-sm leading-relaxed text-gray-700">
            {course.description}
          </p>
        )}

        {/* The CTA is the server's answer, not a guess from the card's own
            fields: `enrolment` is the caller's row, or null. */}
        <div className="mt-4 flex flex-wrap gap-3">
          <Button onClick={props.onOpen}>
            {course.enrolment !== null && course.enrolment.complete
              ? de.catalog.review
              : de.catalog.open}
          </Button>
          {inProgress ? (
            <Button variant="cta" onClick={props.onOpen}>
              {de.overview.resume}
            </Button>
          ) : null}
        </div>
      </div>
    </article>
  );
}

/**
 * A native `<select>`, styled to the layout's orange-chevron control.
 *
 * Native rather than a custom listbox, deliberately. The layout draws a
 * bespoke dropdown, but a hand-built one has to reimplement typeahead, arrow
 * keys, Home/End, touch behaviour and the platform's own picker on mobile — and
 * this is a filter on a page a physician uses once. `appearance-none` plus an
 * absolutely-positioned chevron gets the layout's appearance while the control
 * stays the one the OS knows how to open.
 */
function FacetSelect(props: {
  id: string;
  label: string;
  placeholder: string;
  value: string | undefined;
  options: readonly { value: string; count: number }[];
  onChange: (value: string | undefined) => void;
}) {
  return (
    <div>
      <label htmlFor={props.id} className="block text-sm font-medium text-gray-900">
        {props.label}
      </label>
      <div className="relative mt-1">
        <select
          id={props.id}
          value={props.value ?? ""}
          onChange={(event) =>
            props.onChange(event.target.value === "" ? undefined : event.target.value)
          }
          className="w-full appearance-none rounded-lg border border-gray-300 bg-white py-2.5 pl-3 pr-14 text-sm text-gray-800"
        >
          <option value="">{props.placeholder}</option>
          {props.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.value} ({option.count})
            </option>
          ))}
        </select>

        {/* Decorative: the `<select>` beside it is the control, already named
            by its label. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg bg-cta-500 text-cta-contrast"
        >
          <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor">
            <path d="M5.5 7.5 10 12l4.5-4.5H5.5Z" />
          </svg>
        </span>
      </div>
    </div>
  );
}

/**
 * An active filter, with its own removal.
 *
 * The whole chip is the button and `aria-label` is its accessible name — the
 * visible text is marked decorative so a screen reader announces "Filter
 * „ADHS“ entfernen" once, rather than the value followed by an instruction.
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
        className="inline-flex items-center gap-2 rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-700 hover:bg-gray-200"
      >
        <span aria-hidden="true">{props.label}</span>
        <span aria-hidden="true" className="text-sm leading-none">
          ✕
        </span>
      </button>
    </li>
  );
}

/**
 * The page numbers to show, with gaps collapsed — `1 2 … 8 9 10` in the layout.
 *
 * Exported and pure so the windowing can be tested without rendering: the
 * interesting cases are all arithmetic (a current page near either end, a
 * single-gap run that should print the number rather than an ellipsis wider
 * than it).
 */
export function pageWindow(page: number, lastPage: number): readonly (number | "gap")[] {
  const keep = new Set<number>([1, lastPage, page, page - 1, page + 1]);
  const shown = [...keep].filter((n) => n >= 1 && n <= lastPage).sort((a, b) => a - b);

  const out: (number | "gap")[] = [];
  let previous = 0;
  for (const n of shown) {
    // A gap of exactly one is printed as that page: "1 … 3" is both wider than
    // "1 2 3" and hides a page the learner could have reached in one click.
    if (previous !== 0 && n - previous === 2) out.push(previous + 1);
    else if (previous !== 0 && n - previous > 2) out.push("gap");
    out.push(n);
    previous = n;
  }
  return out;
}

function Pagination(props: {
  page: number;
  lastPage: number;
  onPage: (page: number) => void;
}) {
  return (
    <nav
      className="flex items-center justify-between gap-4 border-t border-gray-200 px-5 py-4"
      aria-label={de.catalog.pagination}
    >
      <PageStep
        direction="previous"
        label={de.catalog.previous}
        disabled={props.page <= 1}
        onClick={() => props.onPage(props.page - 1)}
      />

      <ul className="flex flex-wrap items-center gap-1">
        {pageWindow(props.page, props.lastPage).map((entry, index) =>
          entry === "gap" ? (
            <li
              // Position is the only identity a gap has, and the list is
              // rebuilt whole on every page change.
              key={`gap-${String(index)}`}
              aria-hidden="true"
              className="px-2 text-sm text-gray-500"
            >
              …
            </li>
          ) : (
            <li key={entry}>
              <button
                type="button"
                aria-current={entry === props.page ? "page" : undefined}
                aria-label={de.catalog.goToPage(entry)}
                onClick={() => props.onPage(entry)}
                className={`min-w-8 border-b-2 px-2 pb-1 pt-2 text-sm ${
                  entry === props.page
                    ? "border-brand-600 font-bold text-brand-700"
                    : "border-transparent text-gray-700 hover:text-brand-700"
                }`}
              >
                {entry}
              </button>
            </li>
          ),
        )}
      </ul>

      <PageStep
        direction="next"
        label={de.catalog.next}
        disabled={props.page >= props.lastPage}
        onClick={() => props.onPage(props.page + 1)}
      />
    </nav>
  );
}

function PageStep(props: {
  direction: "previous" | "next";
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  const next = props.direction === "next";
  return (
    <button
      type="button"
      disabled={props.disabled}
      onClick={props.onClick}
      className={`inline-flex items-center gap-2 text-sm font-medium ${
        props.disabled ? "cursor-not-allowed text-gray-400" : "text-gray-800"
      }`}
    >
      {next ? null : <StepArrow back disabled={props.disabled} />}
      {props.label}
      {next ? <StepArrow disabled={props.disabled} /> : null}
    </button>
  );
}

function StepArrow(props: { back?: boolean; disabled: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex h-8 w-8 items-center justify-center rounded-full ${
        props.disabled ? "bg-gray-100 text-gray-400" : "bg-brand-600 text-brand-contrast"
      }`}
    >
      <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor">
        <path
          d={
            props.back === true
              ? "M12 4 6 10l6 6 1.4-1.4L8.8 10l4.6-4.6Z"
              : "M8 4l6 6-6 6-1.4-1.4L11.2 10 6.6 5.4Z"
          }
        />
      </svg>
    </span>
  );
}
