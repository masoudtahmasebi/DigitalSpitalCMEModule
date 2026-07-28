/**
 * The course list (P11-01).
 *
 * The one screen the portal owns outright. It renders `GET /courses` — the same
 * endpoint the widget's own list uses — with the delivery-type tabs, the Thema
 * and Altersgruppe filters with their server-computed facet counts, and
 * pagination.
 *
 * ## The card's call to action comes from the server
 *
 * `enrolment` on each summary is the caller's own standing, taken from the
 * validated token's user id and never from a parameter. The card says
 * _Fortbildung fortsetzen_ when it is present and _Zur Fortbildung_ when it is
 * not; it deliberately does **not** show a percentage, because a course
 * percentage is the output of `rollupProgress` over the whole tree and there is
 * exactly one path to it (CLAUDE.md §4 invariant 6). A cheap approximation on a
 * card would be a second answer to "how far has this person got".
 *
 * ## Filters are server-side
 *
 * Not because the list is large today, but because the facet counts have to
 * agree with the rows. Filtering client-side over one page would show "Thema
 * ADHS (12)" beside three cards.
 */

import { useCallback, useEffect, useState } from "react";
import { germanDuration } from "@ds/domain";
import type {
  ApiClient,
  CourseListQuery,
  CourseListResponse,
  CourseSummary,
} from "@ds/sdk";
import { de } from "../locale/de.js";
import { describeError } from "../api.js";

type DeliveryType = NonNullable<CourseListQuery["deliveryType"]>;

const DELIVERY_TYPES: ReadonlyArray<readonly [DeliveryType, string]> = [
  ["on_demand", de.catalogue.delivery.on_demand],
  ["live", de.catalogue.delivery.live],
  ["praesenz", de.catalogue.delivery.praesenz],
];

export function Catalogue(props: {
  client: ApiClient;
  onOpenCourse: (slug: string) => void;
}) {
  const { client } = props;
  const [query, setQuery] = useState<CourseListQuery>({ page: 1, perPage: 12 });
  const [result, setResult] = useState<CourseListResponse | undefined>();
  const [problem, setProblem] = useState<string | undefined>();

  const load = useCallback(async () => {
    setProblem(undefined);
    try {
      setResult(await client.listCourses(query));
    } catch (error) {
      setProblem(describeError(error, de.error.generic));
    }
  }, [client, query]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Set or clear one filter, and go back to page 1 — page 4 of a new filter is
   * usually empty.
   *
   * Clearing **removes** the key rather than setting it to `undefined`. The two
   * are the same on the wire, but `exactOptionalPropertyTypes` distinguishes
   * them, and the distinction is the right one: "no Thema filter" is the absence
   * of a parameter, not a parameter whose value is nothing.
   */
  const filter = <K extends keyof CourseListQuery>(
    key: K,
    value: CourseListQuery[K] | undefined,
  ) => {
    const next: CourseListQuery = { ...query, page: 1 };
    if (value === undefined) delete next[key];
    else next[key] = value;
    setQuery(next);
  };

  if (problem !== undefined) {
    return (
      <div className="space-y-3">
        <Alert>{problem}</Alert>
        <button type="button" className="ds-button-secondary" onClick={() => void load()}>
          {de.error.retry}
        </button>
      </div>
    );
  }

  if (result === undefined) {
    return (
      <p className="py-8 text-sm text-gray-600" role="status">
        {de.loading}
      </p>
    );
  }

  const totalPages = Math.max(1, Math.ceil(result.total / result.perPage));
  const filtered =
    query.thema !== undefined ||
    query.altersgruppe !== undefined ||
    query.deliveryType !== undefined;

  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">{de.catalogue.title}</h1>

      <div className="flex flex-wrap gap-4">
        <Tabs
          label={de.catalogue.filterDelivery}
          value={query.deliveryType}
          options={DELIVERY_TYPES}
          onChange={(value) => filter("deliveryType", value)}
        />
        <Facets
          label={de.catalogue.filterThema}
          value={query.thema}
          counts={result.facets.thema}
          onChange={(value) => filter("thema", value)}
        />
        <Facets
          label={de.catalogue.filterAltersgruppe}
          value={query.altersgruppe}
          counts={result.facets.altersgruppe}
          onChange={(value) => filter("altersgruppe", value)}
        />
      </div>

      {result.items.length === 0 ? (
        <div className="space-y-3">
          <p className="text-sm text-gray-600">
            {filtered ? de.catalogue.noMatches : de.catalogue.empty}
          </p>
          {filtered ? (
            <button
              type="button"
              className="ds-button-secondary"
              onClick={() => setQuery({ page: 1, perPage: query.perPage ?? 12 })}
            >
              {de.catalogue.resetFilters}
            </button>
          ) : null}
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {result.items.map((course) => (
            <li key={course.slug}>
              <Card course={course} onOpen={() => props.onOpenCourse(course.slug)} />
            </li>
          ))}
        </ul>
      )}

      {totalPages > 1 ? (
        <nav className="flex items-center gap-3" aria-label={de.catalogue.title}>
          <button
            type="button"
            className="ds-button-secondary"
            disabled={result.page <= 1}
            onClick={() => setQuery({ ...query, page: result.page - 1 })}
          >
            {de.catalogue.previous}
          </button>
          <span className="text-sm text-gray-600">
            {de.catalogue.page(result.page, totalPages)}
          </span>
          <button
            type="button"
            className="ds-button-secondary"
            disabled={result.page >= totalPages}
            onClick={() => setQuery({ ...query, page: result.page + 1 })}
          >
            {de.catalogue.next}
          </button>
        </nav>
      ) : null}
    </section>
  );
}

function Card(props: { course: CourseSummary; onOpen: () => void }) {
  const { course } = props;
  const complete = course.enrolment?.complete === true;

  return (
    <article className="flex h-full flex-col overflow-hidden rounded-lg border border-gray-200 bg-white">
      {course.heroImageUrl === null ? null : (
        <img
          src={course.heroImageUrl}
          alt=""
          className="h-40 w-full object-cover"
          loading="lazy"
        />
      )}
      <div className="flex flex-1 flex-col gap-2 p-4">
        <h2 className="text-base font-semibold text-gray-900">{course.title}</h2>
        {course.description === null ? null : (
          <p className="line-clamp-3 text-sm text-gray-600">{course.description}</p>
        )}

        <p className="mt-auto text-xs text-gray-500">
          {[
            course.cmePoints === null
              ? undefined
              : de.catalogue.points(course.cmePoints, course.cmeCategory),
            de.catalogue.modules(course.moduleCount),
            germanDuration(course.totalDurationSec),
          ]
            .filter((part): part is string => part !== undefined)
            .join(" | ")}
        </p>

        <button
          type="button"
          className="ds-button mt-2 self-start"
          onClick={props.onOpen}
        >
          {complete
            ? de.catalogue.completed
            : course.enrolment === null
              ? de.catalogue.start
              : de.catalogue.resume}
        </button>
      </div>
    </article>
  );
}

/**
 * A single-select filter row.
 *
 * Radio-shaped rather than a `<select>` because the counts belong beside the
 * labels — "ADHS (12)" is the useful part, and a listbox hides it until opened.
 */
function Facets(props: {
  label: string;
  value: string | undefined;
  counts: ReadonlyArray<{ readonly value: string; readonly count: number }>;
  onChange: (value: string | undefined) => void;
}) {
  if (props.counts.length === 0) return null;

  return (
    <fieldset className="min-w-0">
      <legend className="text-xs font-semibold uppercase tracking-wide text-gray-500">
        {props.label}
      </legend>
      <div className="mt-1 flex flex-wrap gap-1">
        <Chip
          label={de.catalogue.filterAll}
          selected={props.value === undefined}
          onClick={() => props.onChange(undefined)}
        />
        {props.counts.map((facet) => (
          <Chip
            key={facet.value}
            label={`${facet.value} (${facet.count})`}
            selected={props.value === facet.value}
            onClick={() => props.onChange(facet.value)}
          />
        ))}
      </div>
    </fieldset>
  );
}

function Tabs<T extends string>(props: {
  label: string;
  value: T | undefined;
  options: ReadonlyArray<readonly [T, string]>;
  onChange: (value: T | undefined) => void;
}) {
  return (
    <fieldset className="min-w-0">
      <legend className="text-xs font-semibold uppercase tracking-wide text-gray-500">
        {props.label}
      </legend>
      <div className="mt-1 flex flex-wrap gap-1">
        <Chip
          label={de.catalogue.filterAll}
          selected={props.value === undefined}
          onClick={() => props.onChange(undefined)}
        />
        {props.options.map(([value, label]) => (
          <Chip
            key={value}
            label={label}
            selected={props.value === value}
            onClick={() => props.onChange(value)}
          />
        ))}
      </div>
    </fieldset>
  );
}

function Chip(props: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={props.selected}
      onClick={props.onClick}
      className={`rounded-full border px-3 py-1 text-xs font-medium ${
        props.selected
          ? "border-brand-600 bg-brand-600 text-white"
          : "border-gray-300 bg-white text-gray-700"
      }`}
    >
      {props.label}
    </button>
  );
}

export function Alert(props: { children: React.ReactNode }) {
  return (
    <div
      className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"
      role="alert"
    >
      <p className="font-semibold">{de.error.title}</p>
      {props.children}
    </div>
  );
}
