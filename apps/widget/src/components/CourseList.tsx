/**
 * The Fortbildungsbereich — the course list (P5, layout page 01).
 *
 * ## What the server decides and what this decides
 *
 * Filtering, faceting and paging all happen in the API. This screen holds the
 * *selection* and re-fetches; it never filters an array it already has. That
 * is not only about correctness with paging — the facet counts are computed
 * under the rest of the selection, and a client-side filter over one page could
 * not produce them at all.
 *
 * ## The tab row is a registry, not a delivery-type switch
 *
 * The layout draws two tabs, `On Demand` and `Weitere`, and the client's note
 * on this screen says why:
 *
 * > This is the future view, when we would have more then only On-Demand
 * > Courses. In this case we would have a tab menu for the different funtions:
 * > tab 1: on-demand / tab 2: live events using a zoom integration / tab 3: ???
 *
 * So a tab is a **function**, not a value of `courses.delivery_type`. That
 * distinction is the whole reason `CATALOG_SECTIONS` exists: a section owns its
 * own panel component, and adding the Zoom-backed live-events tab means writing
 * that panel and adding one entry to the array. Nothing in this file, in the
 * hero, in the chrome or in the API has to know it happened.
 *
 * Today both sections render the same `CoursePanel`, differing only in which
 * delivery types they ask for — `Weitere` is everything that is not on-demand.
 * That is a truthful empty state rather than a hidden tab: a learner who
 * returns after live events exist finds the page the same shape it was.
 *
 * ## Filters as chips
 *
 * A dropdown sets a filter; the filter then appears as a removable chip. Both
 * controls drive the same state, so a chip's ✕ and re-selecting the placeholder
 * in the dropdown do exactly the same thing — there is no second code path that
 * could clear one but not the other.
 */

import { useState, type ReactElement } from "react";
import type { Branding } from "@ds/domain";
import type { ApiClient, CourseSummary, DeliveryType } from "@ds/sdk";
import { de } from "../locale/de.js";
import { describeError, useAsync } from "../hooks.js";
import { Button, ErrorNotice, ImagePlaceholder, Spinner } from "./primitives.js";
import { CatalogSeal } from "./CatalogSeal.js";

const PER_PAGE = 10;

/**
 * The content column.
 *
 * The layout centres everything below the hero in a column of roughly 1050 px
 * and lets the hero itself run to the edges of the page. Both halves of that
 * are here rather than left to the host theme: a theme container would clip
 * the hero, and a hero that bleeds while the panel is inset only reads as
 * deliberate if the two agree about where the left edge is.
 */
const CONTENT_WIDTH = "w-full max-w-[1082px]";
const CONTENT = `mx-auto ${CONTENT_WIDTH} px-4`;

/**
 * One tab of the catalogue.
 *
 * `Panel` is a component rather than a filter object on purpose. A live-events
 * tab backed by Zoom will not list courses at all — it lists scheduled sessions
 * with dates, a registration state and a join link — so a section that could
 * only vary a query parameter would have to be torn up to accommodate it.
 */
export interface CatalogSection {
  readonly id: string;
  readonly label: string;
  readonly Panel: (props: CatalogPanelProps) => ReactElement;
}

export interface CatalogPanelProps {
  readonly client: ApiClient;
  readonly onOpen: (slug: string) => void;
}

/**
 * The tabs, in the order the layout draws them.
 *
 * Exported so a host build can add to it — and so the shape of "adding a tab"
 * is visible from the outside as one array entry.
 */
export const CATALOG_SECTIONS: readonly CatalogSection[] = [
  {
    id: "on-demand",
    label: de.catalog.sections.onDemand,
    Panel: (props) => <CoursePanel {...props} deliveryTypes={["on_demand"]} />,
  },
  {
    id: "weitere",
    label: de.catalog.sections.weitere,
    // Everything that is not on-demand. Named by exclusion rather than by
    // listing `live` and `praesenz`, so a delivery type added later appears
    // here instead of silently belonging to no tab at all.
    Panel: (props) => <CoursePanel {...props} deliveryTypes={["live", "praesenz"]} />,
  },
];

export function CourseList(props: {
  client: ApiClient;
  branding: Branding;
  onOpen: (slug: string) => void;
}) {
  const [sectionId, setSectionId] = useState(CATALOG_SECTIONS[0]?.id ?? "");
  const section =
    CATALOG_SECTIONS.find((entry) => entry.id === sectionId) ?? CATALOG_SECTIONS[0];

  if (section === undefined) return null;

  return (
    <section>
      <CatalogHero branding={props.branding} />

      {/* The tab row sits on the panel's top edge, so the two read as one
          element rather than a strip of buttons above a box.

          `CONTENT` and not the full width: the layout runs the hero edge to
          edge and insets everything below it, and the hero's own heading lines
          up with the panel's left edge. That is the widget's job rather than
          the host theme's, because the hero is the part that must bleed and a
          WordPress container would stop it. */}
      <div className={`${CONTENT} mt-10 sm:mt-16`}>
        <div
          role="tablist"
          aria-label={de.catalog.title}
          className="flex flex-wrap gap-2"
        >
          {CATALOG_SECTIONS.map((entry) => {
            const selected = entry.id === section.id;
            return (
              <button
                key={entry.id}
                role="tab"
                type="button"
                aria-selected={selected}
                onClick={() => setSectionId(entry.id)}
                className={`rounded-t-xl px-8 py-2.5 text-sm font-semibold transition-colors ${
                  selected
                    ? "bg-white text-brand-700 shadow-[0_-2px_6px_rgba(0,0,0,0.04)]"
                    : "bg-brand-600 text-brand-contrast hover:bg-brand-700"
                }`}
              >
                {entry.label}
              </button>
            );
          })}
        </div>

        <section.Panel client={props.client} onOpen={props.onOpen} />
      </div>
    </section>
  );
}

interface Filters {
  readonly thema: string | undefined;
  readonly altersgruppe: string | undefined;
  readonly page: number;
}

const NO_FILTERS: Filters = { thema: undefined, altersgruppe: undefined, page: 1 };

/**
 * A list of courses with its filters and its pagination.
 *
 * Parameterised by delivery types rather than hard-coded to one, because the
 * `Weitere` tab covers several. Its own state, so switching tabs does not carry
 * a Thema chosen on the other one into a catalogue where it may not exist.
 */
function CoursePanel(
  props: CatalogPanelProps & { deliveryTypes: readonly DeliveryType[] },
) {
  const { client } = props;
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);

  // The API takes the set as one comma-separated parameter; see the note on
  // `deliveryTypeSet` in `catalog.dto.ts` for why it is not a repeated one.
  const deliveryType = props.deliveryTypes.join(",");

  const list = useAsync(
    () =>
      client.listCourses({
        deliveryType,
        ...(filters.thema === undefined ? {} : { thema: filters.thema }),
        ...(filters.altersgruppe === undefined
          ? {}
          : { altersgruppe: filters.altersgruppe }),
        page: filters.page,
        perPage: PER_PAGE,
      }),
    [client, deliveryType, filters],
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

  const panel = "rounded-b-xl rounded-tr-xl border border-gray-200 bg-white";

  if (list.loading && list.data === undefined) {
    return (
      <div className={panel}>
        <Spinner label={de.loading} />
      </div>
    );
  }

  if (list.data === undefined) {
    return (
      <div className={panel}>
        <ErrorNotice
          title={de.error.title}
          message={describeError(list.error, de.error)}
          retryLabel={de.error.retry}
          onRetry={list.reload}
        />
      </div>
    );
  }

  const { items, facets, total, page, perPage } = list.data;
  const lastPage = Math.max(1, Math.ceil(total / perPage));
  const hasChips = filters.thema !== undefined || filters.altersgruppe !== undefined;

  return (
    <div className={panel}>
      <div className="border-b border-gray-200 p-5 sm:p-7">
        <div className="grid gap-5 sm:grid-cols-2">
          <FacetSelect
            id={`ds-thema-${props.deliveryTypes.join("-")}`}
            label={de.catalog.thema}
            placeholder={de.catalog.selectThema}
            value={filters.thema}
            options={facets.thema}
            onChange={(thema) => set({ thema })}
          />
          <FacetSelect
            id={`ds-altersgruppe-${props.deliveryTypes.join("-")}`}
            label={de.catalog.altersgruppe}
            placeholder={de.catalog.selectAltersgruppe}
            value={filters.altersgruppe}
            options={facets.altersgruppe}
            onChange={(altersgruppe) => set({ altersgruppe })}
          />
        </div>

        {!hasChips ? null : (
          <ul className="mt-4 flex flex-wrap gap-2" aria-label={de.catalog.activeFilters}>
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
        /*
         * Cards, not rows. The layout gives every course its own rounded white
         * card with a shadow and a gap to the next one, rather than a divided
         * list — a distinction worth keeping, because the card is the click
         * target and its edges are what say so.
         */
        <ul className="space-y-6 p-5 sm:p-7">
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
  );
}

/**
 * The teal banner from layout page 01.
 *
 * Three things on it come from the project's branding rather than from this
 * bundle: the heading, the photograph and the seal. The layout's heading is
 * "Fortbildungsbereich für ADHS", which is MEDICE's, and compiling it in would
 * have meant customer two reading MEDICE's heading over their own courses.
 *
 * The photograph is `background-image` on a layer rather than an `<img>`: it is
 * decorative, it must not be announced, and it has to crop rather than letterbox
 * as the hero changes width. The teal gradient over it is what keeps the
 * heading legible on an image nobody has checked the contrast of — the customer
 * uploads it, so the widget cannot assume anything about how dark it is.
 */
function CatalogHero(props: { branding: Branding }) {
  const { branding } = props;
  const photograph = branding.catalogHeroImageUrl;

  return (
    /*
     * One large rounded corner at the bottom right, as the layout draws it,
     * and square at the top: the hero meets the host page's header there and a
     * radius would leave two mismatched curves against MEDICE's own chrome.
     */
    <div className="relative overflow-hidden rounded-b-[2.5rem] bg-brand-600 sm:rounded-bl-none sm:rounded-br-[7rem]">
      {photograph === undefined ? null : (
        /*
          Both layers are hidden below `sm`. The hero is as wide as the
          photograph there, so the gradient has no room to clear and the
          heading ends up white text over an image whose contrast nobody has
          checked — the customer uploads it. The layout does not draw a narrow
          state, so the safe reading of it is flat teal.
        */
        <>
          <div
            aria-hidden="true"
            className="absolute inset-0 hidden bg-cover bg-right sm:block"
            style={{ backgroundImage: `url("${encodeURI(photograph)}")` }}
          />
          {/*
            Teal over the photograph: opaque on the left where the heading sits
            and clearing to the right so the image shows — the layout's
            arrangement, and the reason the heading stays legible whatever the
            customer uploaded. It runs to fully transparent because MEDICE's
            photograph arrives already tinted to the brand colour; a residual
            wash on top of that would flatten it to a block of teal.
          */}
          <div
            aria-hidden="true"
            className="absolute inset-0 hidden bg-gradient-to-r from-brand-600 from-30% via-brand-600/80 to-transparent sm:block"
          />
        </>
      )}

      <div className={`relative ${CONTENT} py-12 text-brand-contrast sm:py-[5.5rem]`}>
        <p className="text-[0.95rem] uppercase tracking-[0.1em]">{de.catalog.eyebrow}</p>
        <h1 className="mt-2.5 max-w-[48rem] text-3xl font-bold sm:text-[2.35rem] sm:leading-tight">
          {branding.catalogTitle ?? de.catalog.title}
        </h1>
        <p className="mt-5 max-w-[43rem] text-[0.95rem] leading-relaxed text-brand-50">
          {branding.catalogIntro ?? de.catalog.intro}
        </p>
      </div>

      {/*
        Hidden below `sm`: at 360 px the seal would sit on top of the heading,
        and it repeats what the CME points on every card already say.
      */}
      <div className="pointer-events-none absolute inset-0 hidden sm:block">
        {/*
          Its own copy of the content column, so the seal is centred on that
          column's right edge — which is where the layout puts it, and which
          stays true at every width without a magic percentage.
        */}
        <div className={`relative mx-auto h-full ${CONTENT_WIDTH}`}>
          <div className="absolute right-4 top-[44%] -translate-y-1/2 translate-x-1/2">
            {branding.catalogSealImageUrl === undefined ? (
              <CatalogSeal className="h-[8.2rem] w-[8.2rem] drop-shadow-xl" />
            ) : (
              <img
                src={branding.catalogSealImageUrl}
                // Never derived: `parseBranding` refuses a seal without
                // alternative text, so if this renders, the text came from the
                // customer.
                alt={branding.catalogSealAlt ?? ""}
                className="h-[8.2rem] w-[8.2rem] object-contain drop-shadow-xl"
                referrerPolicy="no-referrer"
              />
            )}
          </div>
        </div>
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
    <article className="flex flex-col overflow-hidden rounded-2xl bg-white shadow-[0_2px_12px_rgba(0,0,0,0.08)] sm:flex-row">
      {/*
        Flush to the card's left edge and full height, as the layout draws it —
        no padding around the image. `self-stretch` rather than a fixed height
        so a card with a long description does not leave a strip of white under
        its own picture.
      */}
      {course.heroImageUrl === null ? (
        <ImagePlaceholder className="h-52 w-full shrink-0 sm:h-auto sm:w-[24.5rem] sm:self-stretch" />
      ) : (
        <img
          src={course.heroImageUrl}
          // Decorative: the course title is the accessible name, immediately
          // beside it. An alt repeating the title makes a screen reader say
          // it twice.
          alt=""
          className="h-52 w-full shrink-0 object-cover sm:h-auto sm:w-[24.5rem] sm:self-stretch"
          referrerPolicy="no-referrer"
        />
      )}

      <div className="min-w-0 flex-1 p-5 sm:p-6">
        <p className="text-sm font-semibold text-brand-600">
          {de.catalog.cardMeta(course)}
        </p>

        <h2 className="mt-1.5 text-xl font-bold leading-snug text-gray-900 sm:text-2xl">
          {course.title}
        </h2>

        {course.description === null ? null : (
          <p className="mt-3 line-clamp-4 text-sm leading-relaxed text-gray-700">
            {course.description}
          </p>
        )}

        {/* The CTA is the server's answer, not a guess from the card's own
            fields: `enrolment` is the caller's row, or null. */}
        <div className="mt-5 flex flex-wrap gap-3">
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
 * A native `<select>`, styled to the layout's pill with an orange chevron.
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
      <div className="relative mt-1.5">
        <select
          id={props.id}
          value={props.value ?? ""}
          onChange={(event) =>
            props.onChange(event.target.value === "" ? undefined : event.target.value)
          }
          // A full pill on a light grey fill with no border, per the layout.
          className="w-full appearance-none rounded-full bg-gray-100 py-2.5 pl-5 pr-16 text-sm text-gray-800"
        >
          <option value="">{props.placeholder}</option>
          {props.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.value} ({option.count})
            </option>
          ))}
        </select>

        {/* Decorative: the `<select>` beside it is the control, already named
            by its label. A rounded square inset from the pill's edge, which is
            what the layout draws — not a full-height block. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-md bg-cta-500 text-cta-contrast"
        >
          {/* A stroked chevron, not a filled triangle — the layout draws
              the former and at this size the two do not look alike. */}
          <svg
            viewBox="0 0 20 20"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m5.5 8 4.5 4.5L14.5 8" />
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
        className="inline-flex items-center gap-2 rounded-full bg-gray-200 px-3 py-1 text-[0.7rem] text-gray-700 hover:bg-gray-300"
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
      className="flex items-center justify-between gap-4 border-t border-gray-100 px-5 py-5"
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
                // The marker sits *above* the number, which is where the
                // layout puts it.
                className={`min-w-8 border-t-2 px-2 pb-2 pt-2 text-sm ${
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
      className={`inline-flex h-9 w-9 items-center justify-center rounded-full ${
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
