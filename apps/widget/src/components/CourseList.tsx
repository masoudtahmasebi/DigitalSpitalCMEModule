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
import type { OpenIntent } from "../intent.js";
import { de } from "../locale/de.js";
import { describeError, useAsync } from "../hooks.js";
import { CONTENT } from "../layout.js";
import {
  Button,
  ErrorNotice,
  ImagePlaceholder,
  Spinner,
  TabbedPanel,
} from "./primitives.js";
import { CatalogSeal } from "./CatalogSeal.js";

const PER_PAGE = 10;

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
  /**
   * One line saying what this section *is*, above its filters (P106-01).
   *
   * The overview layout heads the list **"On-Demand-Fortbildungen – volle
   * Flexibilität und jederzeit verfügbar"**, and the tab that replaced it
   * (P58-02, so Live and Zoom have somewhere to go) kept the first half and
   * dropped the second. A tab label is a *name*; this is the sentence that
   * tells a physician why they would pick it — which is the only part of the
   * heading doing any work, since the name is already on the tab above.
   *
   * Per section rather than one line above the tabs, because it differs per
   * section: "jederzeit verfügbar" is exactly what a live event is not.
   */
  readonly description: string;
  readonly Panel: (props: CatalogPanelProps) => ReactElement;
}

export interface CatalogPanelProps {
  readonly client: ApiClient;
  readonly onOpen: (slug: string, intent: OpenIntent) => void;
  /** The section's own line, drawn above its filters (P106-01). */
  readonly description?: string | undefined;
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
    description: de.catalog.sections.onDemandDescription,
    Panel: (props) => <CoursePanel {...props} deliveryTypes={["on_demand"]} />,
  },
  {
    id: "weitere",
    label: de.catalog.sections.weitere,
    description: de.catalog.sections.weitereDescription,
    // Everything that is not on-demand. Named by exclusion rather than by
    // listing `live` and `praesenz`, so a delivery type added later appears
    // here instead of silently belonging to no tab at all.
    Panel: (props) => <CoursePanel {...props} deliveryTypes={["live", "praesenz"]} />,
  },
];

export function CourseList(props: {
  client: ApiClient;
  branding: Branding;
  onOpen: (slug: string, intent: OpenIntent) => void;
}) {
  const [sectionId, setSectionId] = useState(CATALOG_SECTIONS[0]?.id ?? "");
  const section =
    CATALOG_SECTIONS.find((entry) => entry.id === sectionId) ?? CATALOG_SECTIONS[0];

  if (section === undefined) return null;

  return (
    <section>
      <CatalogHero branding={props.branding} />

      {/*
        `CONTENT` and not the full width: the layout runs the hero edge to edge
        and insets everything below it, and the hero's own heading lines up
        with the panel's left edge. That is the widget's job rather than the
        host theme's, because the hero is the part that must bleed and a
        WordPress container would stop it.

        ## The same three elements, two arrangements (P19-01)

        Wide: folder tabs standing on the panel's top edge. Narrow: the
        selected section's name is a heading inside the card's top edge, and
        the sections that are not selected become full-width buttons below the
        card — which is where the mobile layout draws "Weitere".

        `TabbedPanel` does both, and does them for the course detail too
        (P19-03). It was written here first and then copied; one component is
        what stops the two headings drifting apart and somebody fixing only
        one of them.
      */}
      <div className={`${CONTENT} mt-6 sm:mt-16`}>
        <TabbedPanel
          tabs={CATALOG_SECTIONS.map((entry) => ({
            id: entry.id,
            label: entry.label,
          }))}
          active={section.id}
          label={de.catalog.title}
          onSelect={setSectionId}
        >
          <section.Panel
            client={props.client}
            onOpen={props.onOpen}
            description={section.description}
          />
        </TabbedPanel>
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

  /*
   * `border-t-0` below `sm`: the tab row above supplies the card's top edge
   * there, and the mobile layout draws that edge as one continuous line. Two
   * borders meeting would render as a 2 px rule across the card exactly where
   * the drawing has one.
   *
   * The border is `brand-500` at that width for the same reason — the mobile
   * card's outline is drawn in the brand colour, not in a neutral grey.
   *
   * `brand-100` at the wide width, and it is not a preference (DEP-28). The
   * active tab standing on this card's top edge is drawn by the shared
   * `TabbedPanel`, whose border the course detail's own panel matches; a tab
   * and a card outlined in two different colours draw the seam that the
   * folder-tab shape exists to hide. One component, one outline.
   */
  const panel =
    "rounded-b-xl rounded-tr-xl border border-brand-100 bg-white max-sm:rounded-tr-none max-sm:border-t-0 max-sm:border-brand-500";

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
      <div className="border-b border-gray-200 p-5 sm:p-10">
        {/*
          What this section is, above the controls that narrow it (P106-01).

          The overview layout puts it exactly here, in the brand teal, and it
          is the right place: a physician decides *whether this list is the one
          they want* before they start narrowing it, and two dropdowns above an
          unheaded list answer the second question without having answered the
          first.

          An `<h2>` rather than a styled paragraph. The hero's title is the
          `<h1>`, so this is the only thing between it and the course titles —
          without it, somebody moving by headings goes from the page's name
          straight into a list of courses with nothing saying what the list is.
        */}
        {props.description === undefined ? null : (
          <h2 className="mb-6 text-lg font-bold text-brand-600">{props.description}</h2>
        )}
        <div className="grid gap-5 sm:grid-cols-2 sm:gap-8">
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
        <ul className="space-y-6 p-5 sm:p-10">
          {items.map((course) => (
            <li key={course.slug}>
              <CourseCard
                course={course}
                onOpen={(intent) => props.onOpen(course.slug, intent)}
              />
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
     * ## Two arrangements, one tree (P19-01)
     *
     * On the wide screen the heading sits **on** the photograph, in white, over
     * a teal gradient that clears to the right, and the seal is centred on the
     * content column's right edge. The mobile layout does none of that: the
     * photograph is a band of its own, the heading is underneath it in
     * near-black on white, and the seal sits inside the photograph's
     * bottom-left corner.
     *
     * A different arrangement, not a smaller one — but still one tree. Two
     * trees behind `sm:hidden` / `hidden sm:block` would put the `<h1>` in the
     * document twice, and `display: none` only removes the duplicate for a
     * browser that has the stylesheet. It stays in the DOM for anything
     * reading the markup, including this component's own tests.
     *
     * The previous version hid the photograph and the seal below `sm` and
     * showed flat teal. That was a defensible reading of a layout which did
     * not draw the narrow state, and is wrong now that it does.
     *
     * `overflow-hidden` only from `sm`: the mobile seal is inside the
     * photograph, but the band is `h-[27.5rem]` and clipping it there would
     * cut the seal if a narrower viewport shrank the band under it.
     */
    <div className="relative sm:overflow-hidden sm:rounded-br-[7rem] sm:bg-brand-600">
      {/*
        The photograph.

        A band of its own below `sm` — which is why this is a real element with
        a height rather than a `background-image` on the container. From `sm`
        it becomes the layer behind the heading, `inset-0`, and the height goes
        back to being whatever the heading needs.

        `background-image` rather than `<img>`: it is decorative, it must not
        be announced, and it has to crop rather than letterbox as the hero
        changes width.
      */}
      <div
        className="relative h-[27.5rem] bg-brand-600 bg-cover bg-center sm:absolute sm:inset-0 sm:h-auto sm:bg-right"
        {...(photograph === undefined
          ? {}
          : { style: { backgroundImage: `url("${encodeURI(photograph)}")` } })}
      >
        {/*
          Teal over the photograph, from `sm` only: opaque on the left where
          the heading sits and clearing to the right so the image shows. It is
          what keeps the heading legible on an image nobody has checked the
          contrast of — the customer uploads it. It runs to fully transparent
          because MEDICE's photograph arrives already tinted to the brand
          colour, and a residual wash on top of that would flatten it to a
          block of teal.

          Nothing needs it below `sm`, where no text is over the photograph.
        */}
        <div
          aria-hidden="true"
          className="absolute inset-0 hidden bg-gradient-to-r from-brand-600 from-30% via-brand-600/80 to-transparent sm:block"
        />

        {/*
          The seal, inside the photograph in both arrangements — which is what
          lets one element serve both anchors. Below `sm` the photograph is the
          band, so `bottom-10 left-4` is the band's bottom-left. From `sm` the
          photograph is the whole hero, so the same element re-anchors to the
          content column's right edge.
        */}
        {/*
          `sm:bottom-0 sm:left-0 sm:right-0 sm:top-0` and **not** `sm:inset-0`
          with `bottom-auto`/`left-auto` (P91-01).

          That was the first version and it is why the seal arrived clipped
          into the hero's top-right corner: `bottom:auto; left:auto` shrinks
          this box to its content, so the `h-full` below measured the seal
          rather than the hero and `top-[44%]` centred it on itself. The four
          sides are written out because Tailwind emits `inset-0` *before*
          `bottom-10`, so a bare `sm:inset-0` loses to the mobile anchor.
        */}
        <div className="pointer-events-none absolute bottom-10 left-4 sm:bottom-0 sm:left-0 sm:right-0 sm:top-0">
          {/*
            The content column, repeated, so the seal is anchored to *its* right
            edge rather than to the viewport's — which is where the layout puts
            it, and which stays true at every width without a magic percentage.

            Written out rather than interpolated from `CONTENT_WIDTH`: the
            variant prefixes differ (`sm:`), and a class name Tailwind never
            sees spelled in full is a class name it never generates.
          */}
          <div className="relative mx-auto h-full sm:w-full sm:max-w-[1430px] sm:px-4">
            {/*
              Centred **on** the column's right edge — but only once the gutter
              can take it (P91-01, revisited in P190-01).

              The drawing puts the seal's centre exactly on x = 1659, the
              column's right edge, with 261 px of hero to its right. That is
              `translate-x-1/2` and it is what the 1920 px export shows.

              It is not safe at every width. Below the column's own 1430 px the
              column touches the viewport, so half a 176 px seal would fall
              outside and `sm:overflow-hidden` would cut it — which is exactly
              what the portal was showing before P91-01 pulled it inside.

              1606 px is the width at which the gutter first exceeds the seal's
              half-width: 1430 + 2 × 88. Below it the seal sits flush inside the
              column edge; at and above it, it straddles the edge as drawn. The
              number is derived rather than chosen, which is why it is written
              as an arbitrary variant instead of a new breakpoint nothing else
              would use.
            */}
            <div className="sm:absolute sm:right-4 sm:top-1/2 sm:-translate-y-1/2 min-[1606px]:translate-x-1/2">
              <HeroSeal
                branding={branding}
                className="h-[11rem] w-[11rem] sm:h-44 sm:w-44"
              />
            </div>
          </div>
        </div>
      </div>

      {/*
        The heading.

        Near-black on white below `sm` and white on teal from `sm`, because the
        photograph is beside it in one arrangement and behind it in the other.
        `relative` so it stacks above the photograph's layer once that is
        `absolute`.
      */}
      <div
        className={`relative ${CONTENT} pb-2 pt-9 text-gray-900 sm:py-[5.5rem] sm:text-brand-contrast`}
      >
        <p className="text-[0.95rem] uppercase tracking-[0.06em] text-gray-600 sm:tracking-[0.1em] sm:text-inherit">
          {de.catalog.eyebrow}
        </p>
        {/*
          `break-words` because this is German and the customer writes it.
          "Fortbildungsbereich" is 302 px at this size and the narrowest phone
          still in use gives it 288 — one unbreakable word, and the whole page
          scrolls sideways for it. Measured at 320 px: 334 px of document in a
          320 px window, caused by exactly this heading.

          It breaks only when a word cannot fit, so nothing changes at any
          width where it does.
        */}
        <h1 className="mt-3 max-w-[48rem] break-words text-[1.75rem] font-bold leading-tight sm:mt-2.5 sm:text-[2.35rem]">
          {branding.catalogTitle ?? de.catalog.title}
        </h1>
        <p className="mt-5 max-w-[43rem] text-[0.95rem] leading-relaxed text-gray-700 sm:text-brand-50">
          {branding.catalogIntro ?? de.catalog.intro}
        </p>
      </div>
    </div>
  );
}

/**
 * The CME seal, wherever it is placed.
 *
 * Extracted because the two arrangements differ only in size and position, and
 * the part that is easy to get wrong — that a customer-supplied seal must
 * never invent its own alternative text — should exist once.
 */
function HeroSeal(props: { branding: Branding; className: string }) {
  const { branding } = props;

  if (branding.catalogSealImageUrl === undefined) {
    return <CatalogSeal className={`${props.className} drop-shadow-xl`} />;
  }

  return (
    <img
      src={branding.catalogSealImageUrl}
      // Never derived: `parseBranding` refuses a seal without alternative
      // text, so if this renders, the text came from the customer.
      alt={branding.catalogSealAlt ?? ""}
      className={`${props.className} object-contain drop-shadow-xl`}
      referrerPolicy="no-referrer"
    />
  );
}

function CourseCard(props: {
  course: CourseSummary;
  onOpen: (intent: OpenIntent) => void;
}) {
  const { course } = props;

  /*
   * Started but not finished — the case the layout gives two buttons.
   *
   * They are genuinely two destinations. **Zur Fortbildung** opens the course's
   * start page: description, Referenten, Zertifizierung, the outline. **
   * Fortbildung fortsetzen** skips all of it and lands in the video the learner
   * was watching, or the next one if they finished it — which content that is,
   * the server decides (`resumeContentId`).
   *
   * Only the second gets the accent colour: it is the one action a returning
   * learner almost always wants, and giving both equal weight would make them
   * read the labels every time.
   */
  /*
   * `courseComplete`, not `complete` (P52-05).
   *
   * A physician who has watched every video and passed the
   * Lernerfolgskontrolle has **nothing to resume**, whether or not they have
   * filled in the Evaluationsbogen. Keying this on `complete` — which
   * additionally waits for the evaluation and the EFN — offered them
   * "Fortbildung fortsetzen" and described a finished course as in progress.
   *
   * P51-01 fixed exactly this on the course-detail screen and stopped there.
   * The catalogue is the screen a returning learner sees first.
   */
  const inProgress = course.enrolment !== null && !course.enrolment.courseComplete;
  const certificationOpen =
    course.enrolment !== null &&
    course.enrolment.courseComplete &&
    !course.enrolment.complete;

  return (
    <article className="flex flex-col overflow-hidden rounded-2xl bg-white shadow-[0_2px_12px_rgba(0,0,0,0.08)] sm:flex-row">
      {/*
        Flush to the card's left edge and full height, as the layout draws it —
        no padding around the image.

        `sm:h-full` and not `sm:h-auto` (P190-01). The widget's own reset
        carries preflight's `img { height: auto }`, which beat `self-stretch`
        and sized the picture to its intrinsic aspect ratio — so a card whose
        description ran to four lines drew a strip of card-coloured nothing
        under its own artwork, visible on the first card of the catalogue at
        every width above `sm`. `h-full` plus `object-cover` is what the
        drawing has: the picture fills the card and crops.

        `w-[39.8%]` is the drawing's own proportion — a 525 px picture on a
        1320 px card — rather than a fixed rem width, so the split survives the
        column narrowing on a laptop instead of the text column taking all of
        the loss.
      */}
      {course.heroImageUrl === null ? (
        /* `sm:h-auto` and not `sm:h-full` here: this is a `<div>`, so
           `height: 100%` resolves against a flex container whose own height is
           `auto` and collapses to the icon inside it — a 40 px grey strip where
           the drawing has the card's full height. `self-stretch` is what sizes
           it, and only the `<img>` below needs `h-full` to beat the reset's
           `height: auto`. */
        <ImagePlaceholder className="h-52 w-full shrink-0 sm:h-auto sm:w-[39.8%] sm:self-stretch" />
      ) : (
        <img
          src={course.heroImageUrl}
          // Decorative: the course title is the accessible name, immediately
          // beside it. An alt repeating the title makes a screen reader say
          // it twice.
          alt=""
          className="h-52 w-full shrink-0 object-cover sm:h-full sm:w-[39.8%] sm:self-stretch"
          referrerPolicy="no-referrer"
        />
      )}

      {/* The drawing's gap between the picture and the first line of text is
          55 px, wider than the padding on the card's other three sides — the
          text column is inset from the artwork, not merely padded away from
          it. */}
      <div className="min-w-0 flex-1 p-5 sm:py-8 sm:pl-14 sm:pr-8">
        <p className="text-sm font-semibold text-brand-600">
          {de.catalog.cardMeta(course)}
        </p>

        {/* `break-words` for the same reason as the hero heading: a course
            title is German prose an author types, and one long compound noun
            should wrap rather than widen the page. */}
        <h2 className="mt-1.5 break-words text-xl font-bold leading-snug text-gray-900 sm:text-2xl">
          {course.title}
        </h2>

        {course.description === null ? null : (
          <p className="mt-3 line-clamp-4 text-sm leading-relaxed text-gray-700">
            {course.description}
          </p>
        )}

        {/* The CTA is the server's answer, not a guess from the card's own
            fields: `enrolment` is the caller's row, or null. */}
        <div className="mt-6 flex flex-wrap gap-4">
          <Button onClick={() => props.onOpen("start")}>
            {course.enrolment !== null && course.enrolment.courseComplete
              ? de.catalog.review
              : de.catalog.open}
          </Button>
          {inProgress ? (
            <Button variant="cta" onClick={() => props.onOpen("resume")}>
              {de.overview.resume}
            </Button>
          ) : null}
        </div>

        {/*
          The one state the card could not previously express: finished, but
          the point not yet claimed. Without it a physician who stopped before
          the Evaluationsbogen sees a card that looks identical to a course
          they have fully certified, and no reason to open it again.

          The sentence was where it stopped, and that is what the client found
          (P168-04): *"why not a new button to go the needed layout?"* Naming a
          state and leaving the person to find their own way to it is §9.4 — the
          screen knows exactly which page they need. `"certify"` opens the
          course on the Punktemeldung, which is a real address (§9.8), so it can
          equally be arrived at by link.
        */}
        {certificationOpen ? (
          <div className="mt-3">
            <p className="text-sm font-medium text-brand-700">
              {de.catalog.certificationOpen}
            </p>
            <div className="mt-2">
              <Button variant="cta" onClick={() => props.onOpen("certify")}>
                {de.overview.claim}
              </Button>
            </div>
          </div>
        ) : null}

        {/*
          And the state after it: certified, with a Teilnahmebescheinigung
          waiting (P168-04). It differed from a course nobody had ever opened by
          the word "ansehen" in a button, which is why the client's finished
          course looked "normal" beside the one that still owed an EFN.
        */}
        {course.enrolment !== null && course.enrolment.complete ? (
          <div className="mt-3">
            <p className="text-sm font-medium text-status-completed">
              {de.catalog.certified}
            </p>
            {/*
              And the way to it (P176-02). The line above says the
              Teilnahmebescheinigung is available; the client asked the question
              that answer invites — *"where can one download it?"* — and the
              honest fix is the control, not more prose.

              `"certificate"` opens the course on its Zertifizierung tab, which
              is a real address (§9.8) and carries the accreditation the document
              belongs to rather than dropping a file on its own.
            */}
            <div className="mt-2">
              <Button variant="cta" onClick={() => props.onOpen("certificate")}>
                {de.catalog.toCertificate}
              </Button>
            </div>
          </div>
        ) : null}
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
          className="h-11 w-full appearance-none rounded-full bg-gray-100 pl-5 pr-16 text-sm text-gray-800"
        >
          <option value="">{props.placeholder}</option>
          {props.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.value} ({option.count})
            </option>
          ))}
        </select>

        {/* Decorative: the `<select>` beside it is the control, already named
            by its label.

            A **full-height block with one rounded corner**, bottom-right — not
            an inset rounded square, which is what this was. The mobile export
            draws it unambiguously at 2× and the desktop export agrees, so the
            earlier reading was of the PDF's softer edges rather than of the
            drawing (P19-01).

            The pill's own right rounding is behind it and never seen; the
            block squares off that end, which is the shape the layout has. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-br-2xl bg-cta-500 text-cta-contrast"
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
    /*
     * One row at desktop width — previous, the numbers, next — and two on the
     * narrow layout, where the numbers take a line of their own above the two
     * steps (P19-01).
     *
     * `flex-wrap` and a full-width `ul` rather than a `flex-col` with an
     * explicit order: wrapping is what the drawing is, and it also means the
     * transition happens when the three genuinely stop fitting rather than at
     * a number chosen here.
     */
    <nav
      className="flex flex-wrap items-center justify-between gap-4 border-t border-gray-100 px-5 py-5"
      aria-label={de.catalog.pagination}
    >
      <PageStep
        direction="previous"
        label={de.catalog.previous}
        disabled={props.page <= 1}
        onClick={() => props.onPage(props.page - 1)}
      />

      <ul className="flex flex-wrap items-center gap-1 max-sm:order-first max-sm:w-full max-sm:justify-center max-sm:gap-3">
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
                /*
                 * The marker sits *above* the number, which is where the
                 * layout puts it.
                 *
                 * Two ways of drawing the same thing. Wide: a 2 px top border
                 * on the button itself. Narrow: the numbers have a rule of
                 * their own running the card's full width — the `nav`'s top
                 * border — and the marker sits *on* that rule rather than
                 * against the number, so it is positioned up out of the
                 * button, past the row's padding.
                 */
                className={`relative min-w-8 border-t-2 px-2 pb-2 pt-2 text-sm max-sm:border-t-0 ${
                  entry === props.page
                    ? "border-brand-600 font-bold text-brand-700 max-sm:after:absolute max-sm:after:-top-[21px] max-sm:after:left-1/2 max-sm:after:h-[3px] max-sm:after:w-8 max-sm:after:-translate-x-1/2 max-sm:after:rounded-full max-sm:after:bg-brand-600 max-sm:after:content-['']"
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
      /*
       * Disabled is a *pale brand* disc with a white arrow, not a grey disc
       * with a grey one. The layout keeps the shape at full strength and
       * drains the colour — which reads as "not now" rather than as "broken",
       * and keeps the arrow legible, which a grey-on-grey glyph does not.
       */
      className={`inline-flex h-9 w-9 items-center justify-center rounded-full ${
        props.disabled ? "bg-brand-100 text-white" : "bg-brand-600 text-brand-contrast"
      }`}
    >
      {/*
        A long arrow — shaft and head — not a bare chevron. At 16 px the two
        are genuinely different marks, and the layout draws the former.
      */}
      <svg
        viewBox="0 0 20 20"
        className="h-[1.05rem] w-[1.05rem]"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path
          d={
            props.back === true
              ? "M16 10H4.5m0 0L9 5.5M4.5 10 9 14.5"
              : "M4 10h11.5m0 0L11 5.5m4.5 4.5L11 14.5"
          }
        />
      </svg>
    </span>
  );
}
