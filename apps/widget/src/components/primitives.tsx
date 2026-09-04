/**
 * Shared presentational pieces.
 *
 * Everything here is dumb on purpose: no fetching, no gate decisions, no
 * German copy of its own. Copy arrives as props from `locale/de.ts`.
 *
 * ## The one-odd-corner shape, and why several components repeat it
 *
 * The MEDICE layout does not draw symmetric rounded rectangles. Every teal or
 * orange block in it has **three corners at one radius and a fourth at
 * another**, and which corner is the odd one out is consistent per family:
 *
 * | Element                         | Three corners | The odd corner        |
 * | ------------------------------- | ------------- | --------------------- |
 * | meta bar (white)                | 12 px         | bottom-right, ~28 px  |
 * | CME points badge (orange)       | 4 px          | bottom-right, ~18 px  |
 * | tab, progress card, sticky card | ~20 px / pill | top-right, **square** |
 *
 * Those numbers are measured, not guessed — `docs/design/screens/page-02.png`
 * and `docs/design/mobile/progress-sticky-module.png` at pixel level, written
 * up in `docs/design/README.md` rows 2.2, 2.4 and 8.x. Uniform rounding is what
 * DEP-27, DEP-28 and DEP-29 all reported from three different screens, which is
 * the tell that it is one motif and not three coincidences: get it wrong in one
 * place and the widget stops looking like the layout everywhere at once.
 *
 * `rounded-full rounded-tr-none` is the load-bearing idiom for the second
 * family. CSS clamps a 9999 px radius down so the radii on any one edge fit
 * that edge, which on a box shorter than it is wide lands exactly on
 * half-the-height — the design's radius — without anybody hard-coding the
 * element's height. Where a corner has to survive that clamp at a *fixed*
 * size (the active tab, which rounds only one corner and would otherwise clamp
 * to the full height) the radius is written out in rem and the height it was
 * derived from is named beside it.
 */

import type { ReactNode } from "react";
import type { GateStatus } from "@ds/sdk";

/**
 * The layout's four button skins.
 *
 * `cta` is orange and means "continue what you started" — see the `cta` colour
 * note in the Tailwind preset. It is not a louder primary; using it for a
 * neutral action is a bug, because the catalogue's whole scanning affordance is
 * that orange marks the course already in progress.
 *
 * Fully rounded, because every button in the layout is a pill. That is not
 * decoration here: the pill shape is what distinguishes an action from the
 * square-cornered cards and panels around it.
 */
export function Button(props: {
  onClick?: () => void;
  type?: "button" | "submit";
  variant?: "primary" | "cta" | "secondary" | "ghost";
  /**
   * The drawing has two pill heights and they mean different things.
   *
   * `md` is 44 px and is every ordinary action — the catalogue card's **Zur
   * Fortbildung** (measured 170 × 44), the player's **Zurück zur Übersicht**
   * (242 × 45), the exam's buttons. `lg` is the 58 px pill the course meta
   * strip uses for **Fortbildung fortsetzen**, which is the one action on that
   * screen and is drawn larger than everything around it. `sm` is the chip
   * scale, unchanged.
   */
  size?: "lg" | "md" | "sm";
  disabled?: boolean;
  children: ReactNode;
}) {
  const variant = props.variant ?? "primary";
  const size = props.size ?? "md";

  const base =
    "inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-colors " +
    "disabled:cursor-not-allowed disabled:opacity-60";
  const metrics = {
    sm: "px-4 py-1.5 text-xs",
    md: "px-6 py-3 text-sm",
    lg: "px-8 py-4 text-base",
  }[size];

  const skin: Record<NonNullable<typeof props.variant>, string> = {
    primary: "bg-brand-600 text-brand-contrast hover:bg-brand-700",
    cta: "bg-cta-500 text-cta-contrast hover:bg-cta-600",
    secondary: "border border-brand-600 bg-white text-brand-700 hover:bg-brand-50",
    ghost: "text-brand-700 hover:bg-brand-50",
  };

  return (
    <button
      type={props.type ?? "button"}
      className={`${base} ${metrics} ${skin[variant]}`}
      disabled={props.disabled === true}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

/** The white, softly-shadowed panel every screen in the layout is built from. */
export function Card(props: { className?: string; children: ReactNode }) {
  return (
    <div
      className={`rounded-2xl border border-gray-100 bg-white shadow-sm ${props.className ?? ""}`}
    >
      {props.children}
    </div>
  );
}

/**
 * Tabs above a panel — and, on a narrow screen, something else entirely
 * (P19-03).
 *
 * ## The two arrangements
 *
 * Wide: folder tabs standing on the panel's top edge, the selected one white
 * and continuous with the panel below it.
 *
 * Narrow: the selected tab's name is a **heading inside the panel's top edge**,
 * and the tabs that are not selected become full-width buttons **below** the
 * panel. That is how the mobile export draws both the catalogue ("On Demand"
 * over the filters, "Weitere" underneath) and the course detail ("Übersicht"
 * over the description) — twice, which is the strongest evidence available
 * that it is the intended pattern rather than an accident of one screen.
 *
 * ## Why it is one component
 *
 * Because it appeared on two screens and the second one was about to be a
 * copy. A copy would drift: the catalogue's heading and the detail's would
 * gain different padding, and then somebody would fix one of them.
 *
 * ## What the caller still owns
 *
 * The panel's own styling, passed as `children` — the catalogue's is a
 * bordered card and the detail's is a shadowed one, and neither is this
 * component's business. What the caller **must** do is drop the panel's top
 * border and its top rounding below `sm`, because the heading supplies both
 * there; two borders meeting render as a 2 px rule across the middle of what
 * the drawing has as one line.
 */
export function TabbedPanel<T extends string>(props: {
  tabs: ReadonlyArray<{ id: T; label: string }>;
  active: T;
  onSelect: (id: T) => void;
  /** Names the tablist for a screen reader. */
  label: string;
  /** Extra classes for the mobile heading, for a panel with a different fill. */
  headingClassName?: string;
  children: ReactNode;
}) {
  const active = props.tabs.find((tab) => tab.id === props.active);

  return (
    <div className="flex flex-col">
      {active === undefined ? null : (
        <h2
          className={
            "order-1 rounded-t-xl border-x border-t border-brand-500 bg-white px-5 pb-1 pt-6 text-center text-base font-semibold text-brand-700 sm:hidden " +
            (props.headingClassName ?? "")
          }
        >
          {active.label}
        </h2>
      )}

      <div className="order-2 min-w-0">{props.children}</div>

      <div
        role="tablist"
        aria-label={props.label}
        className="order-3 flex flex-wrap gap-2 sm:order-1 max-sm:mt-6 max-sm:flex-col max-sm:gap-3"
      >
        {props.tabs.map((tab) => {
          const selected = tab.id === props.active;
          return (
            <button
              key={tab.id}
              role="tab"
              type="button"
              aria-selected={selected}
              onClick={() => {
                props.onSelect(tab.id);
              }}
              className={
                /* `sm:px-10` (P190-01). Measured on the 01.09.2026 export a
                   "Weitere" tab is 154 px wide for a seven-character word —
                   roughly 40 px of padding a side, which is what gives the row
                   its folder-tab proportion. At `px-6` the tabs were two thirds
                   the drawn width and read as small buttons resting on the
                   panel rather than as tabs standing on it.

                   Padding only. The rounding is per-state below and derived
                   from this box's 40 px height (DEP-27a), which `py-2.5` keeps
                   unchanged. */
                "px-6 py-2.5 text-sm font-semibold transition-colors sm:px-10 " +
                (selected
                  ? // The active tab is white and joins the panel below it,
                    // which is what makes the row read as tabs rather than as
                    // buttons. Hidden below `sm`, where the heading above the
                    // panel *is* this tab — a selected tab rendered among the
                    // buttons underneath would read as somewhere else to go.
                    //
                    // `rounded-tl-[1.25rem]`, not `rounded-tl-full`: only one
                    // corner is rounded here, so the clamp that gives the
                    // inactive tab its half-height radius would instead give
                    // this one the *full* height. 1.25rem is half of the tab's
                    // 40 px box (20 px line-height + `py-2.5`), which is the
                    // radius the inactive tab beside it resolves to — the two
                    // have to agree or the row steps.
                    //
                    // Teal border, not grey (DEP-28): the panel it merges into
                    // is outlined in the same light teal, and a grey tab on a
                    // teal panel draws the seam it exists to hide.
                    //
                    // `relative -mb-px` is what makes "merges into the panel"
                    // true rather than nearly true. `border-b-0` removes the
                    // tab's own bottom edge, but the panel underneath still
                    // draws its top edge across the full width — so the tab sat
                    // on a hairline the drawing does not have. The negative
                    // margin lets the tab's white fill overlap that line by the
                    // one pixel it is wide, and `relative` puts it in front:
                    // the tablist is after the panel in the DOM (`order-*`
                    // reorders what you see, never what paints on top).
                    "relative -mb-px rounded-tl-[1.25rem] border border-b-0 border-brand-100 bg-white text-brand-700 max-sm:hidden"
                  : // Half-height on three corners, square on the top-right —
                    // the layout's shape for every teal block (see the file
                    // header). It was `rounded-t-xl`, which squares off the two
                    // bottom corners the drawing sweeps.
                    //
                    // Below `sm` the radius is moderate rather than a pill
                    // (DEP-31). At full width a `rounded-full` button is a
                    // 24 px sweep on a 430 px bar, which reads as a chip rather
                    // than as the stacked navigation the mobile export draws;
                    // the design has the same 1.25rem family as every other
                    // teal block here. The top-right stays square in both, so
                    // the shape is still recognisably one family.
                    "rounded-full rounded-tr-none bg-brand-600 text-brand-contrast hover:bg-brand-700 max-sm:rounded-[1.25rem] max-sm:rounded-tr-none max-sm:py-3.5 max-sm:text-base")
              }
            >
              {tab.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The meta strip under the course hero: points, duration, module count, and the
 * resume action.
 *
 * It overlaps the hero by design — measured, the 86 px strip sits 48 px above
 * the hero's lower edge — which is what ties the two together in the layout.
 * The CME points sit in an orange chip because that number is the reason the
 * learner is here.
 *
 * No horizontal inset of its own from `sm` up: the drawing runs this strip to
 * the content column's own edges (x = 261 … 1657 at 1920 px), so the caller's
 * column is what positions it. `max-sm:mx-4` keeps the narrow arrangement,
 * where the strip is a card inside a full-bleed hero rather than flush to it.
 */
export function CourseMetaBar(props: {
  points: string | null;
  pointsLabel: string;
  duration: string | null;
  modules: string | null;
  action: ReactNode;
}) {
  return (
    /*
     * One row at desktop width, a **centred stack** below `sm` (P19-03).
     *
     * The mobile export does not wrap this row — it re-lays it: the points
     * pill, the duration and the module count each get a line of their own,
     * centred, and the action becomes a full-width button under them. Wrapping
     * the desktop row would produce three left-aligned lines and a button
     * floating off to one side, which is a different drawing.
     */
    /*
     * `rounded-br-[1.75rem]` is the odd corner (see this file's header). The
     * bar was uniformly `rounded-xl`, which is the shape DEP-27a reported: at
     * 12 px on all four corners the card reads as a plain rectangle beside a
     * hero whose own bottom-right sweeps, and the two stop looking like one
     * masthead. Both exports draw the sweep at roughly half the bar's height.
     *
     * `-mt-12` and `py-3.5` are the 01.09.2026 export's own figures (P190-01):
     * the strip is 86 px tall and sits 48 px above the hero's lower edge. The
     * horizontal inset went with them — from `sm` up the drawing runs this
     * strip to the content column's own edges, which the caller's column now
     * supplies, so `mx-4` survives only below `sm` where the strip is a card
     * inside a full-bleed hero rather than flush to it.
     */
    <div className="relative z-10 -mt-12 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl rounded-br-[1.75rem] bg-white px-5 py-3.5 shadow-md max-sm:mx-4 max-sm:-mt-7 max-sm:flex-col max-sm:gap-y-4 max-sm:px-5 max-sm:py-6">
      {props.points === null ? null : (
        /*
         * **One orange pill with an internal hairline**, at every width — not
         * an orange square beside grey text, which is what this was.
         *
         * Both exports draw it the same way and they agree: the number and the
         * words are one object, divided by a white rule, both in white on
         * orange. The earlier reading came from the PDF's softer edges, where
         * the hairline is hard to see and the pill reads as two elements.
         *
         * `overflow-hidden` on the badge and square corners on the halves: the
         * outer radius is the badge's, and letting each half round its own end
         * would put a notch where the hairline is.
         *
         * **Not a full pill** (DEP-27c). It was `rounded-full`, and both
         * exports draw something else: 4 px on three corners and a single long
         * sweep on the bottom-right, the same odd-corner shape the white bar
         * around it has. A full pill and a square badge are equally wrong, and
         * they are wrong in opposite directions — which is why the report and
         * the drawing can both be right about "this is not the shape".
         */
        <span className="flex items-center overflow-hidden rounded rounded-br-[1.125rem] bg-cta-500 text-cta-contrast">
          <span className="px-4 py-2.5 text-base font-bold max-sm:py-2 max-sm:text-lg">
            {props.points}
          </span>
          <span className="border-l border-white/60 px-4 py-2.5 text-base font-semibold max-sm:py-2">
            {props.pointsLabel}
          </span>
        </span>
      )}

      {/*
        `border-l` is a divider between columns, and there are no columns below
        `sm`. Left in place there it would draw a stub of a rule to the left of
        centred text.
      */}
      {props.duration === null ? null : (
        <span className="flex items-center gap-2 border-l border-gray-200 pl-6 text-sm text-gray-800 max-sm:border-l-0 max-sm:pl-0 max-sm:text-base max-sm:font-semibold">
          <ClockIcon />
          {props.duration}
        </span>
      )}

      {props.modules === null ? null : (
        <span className="flex items-center gap-2 border-l border-gray-200 pl-6 text-sm text-gray-800 max-sm:border-l-0 max-sm:pl-0 max-sm:text-base max-sm:font-semibold">
          <ModulesIcon />
          {props.modules}
        </span>
      )}

      <span className="ml-auto max-sm:ml-0 max-sm:w-full max-sm:[&>button]:w-full">
        {props.action}
      </span>
    </div>
  );
}

export function ClockIcon(props: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      // Orange, not teal. Both exports draw the meta strip's glyphs in the
      // accent colour beside the points pill — they are one group.
      className={props.className ?? "h-5 w-5 text-cta-500"}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M10 1a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 2a7 7 0 1 1 0 14A7 7 0 0 1 10 3Zm-.75 2.5v5c0 .27.14.52.37.65l3.5 2 .75-1.3-3.12-1.79V5.5h-1.5Z" />
    </svg>
  );
}

/**
 * The glyph beside `N Module` in the meta strip.
 *
 * It was a 2 × 2 grid of filled squares — the generic "tiles" icon — and the
 * layout draws something specific instead (DEP-27b): **two stacked sheets, the
 * top one tilted, with a play badge over the lower-right corner.** That is not
 * decoration. A grid says "several things"; the drawing says "several things
 * you watch", which is what a Modul is on this platform, and it is the only
 * place in the meta strip that says the course is video at all.
 *
 * Stroked outline for the sheets, solid for the badge, exactly as both exports
 * draw it. The play triangle is a hole punched with `evenodd` rather than a
 * white triangle, so the glyph still reads on a fill that is not white.
 */
export function ModulesIcon(props: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      // Orange, for the reason on ClockIcon.
      className={props.className ?? "h-5 w-5 text-cta-500"}
      aria-hidden="true"
    >
      {/*
        One polyline, drawn from the right edge anticlockwise: down the short
        right side, up over the tilted top sheet, down the left side and along
        the bottom. It stops short of the lower-right corner because the badge
        occupies it — the drawing has a gap there, not an overlap.
      */}
      <path
        d="M14.8 11.4V8.2L12.2 4.6 4.4 8.2v11.4h6.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* The lower sheet's own top edge, which is what makes the pair a stack
          rather than one sheet with a bent lid. */}
      <path
        d="M4.4 8.2h10.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
      <path
        d="M17 12.2a5 5 0 1 0 0 10 5 5 0 0 0 0-10Zm-1.4 2.5 3.7 2.5-3.7 2.5v-5Z"
        fill="currentColor"
        fillRule="evenodd"
      />
    </svg>
  );
}

export function DownloadIcon(props: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={props.className ?? "h-4 w-4"}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M8 1a1 1 0 0 1 1 1v6.6l2.3-2.3 1.4 1.4L8 12.4 3.3 7.7l1.4-1.4L7 8.6V2a1 1 0 0 1 1-1ZM2 13h12v2H2v-2Z" />
    </svg>
  );
}

/** The filled orange tick beside every Lernziel in the layout. */
export function CheckBullet(props: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={props.className ?? "mt-0.5 h-4 w-4 shrink-0 text-cta-500"}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0Zm3.86 5.9-4.5 5a1 1 0 0 1-1.46.04L3.9 8.94a1 1 0 1 1 1.42-1.42l1.25 1.25 3.8-4.22a1 1 0 0 1 1.49 1.34Z" />
    </svg>
  );
}

/** A placeholder where artwork is missing, rather than a collapsed empty box. */
export function ImagePlaceholder(props: { className?: string }) {
  return (
    <div
      className={`flex items-center justify-center bg-gray-200 ${props.className ?? ""}`}
      aria-hidden="true"
    >
      <svg viewBox="0 0 24 24" className="h-10 w-10 text-gray-400" fill="currentColor">
        <path d="M21 5H3a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h18a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1Zm-1 12H4v-1.6l4-3.9 3.5 3.4L16 10l4 4.3V17ZM8.5 10.5a1.75 1.75 0 1 1 0-3.5 1.75 1.75 0 0 1 0 3.5Z" />
      </svg>
    </div>
  );
}

/**
 * The progress ring from the layout (§4.2).
 *
 * ## Why it counts modules rather than taking a percentage
 *
 * The layout's ring reads **"2 von 5"**, and the requirements record is
 * explicit that it counts *modules*: `moduleCompletion`, which the server
 * returns separately from `course.percent` precisely because the two
 * legitimately differ — the latter is content-weighted, so a learner one long
 * video into a five-module course is at 0 modules and some non-zero percent.
 *
 * Taking `completed`/`total` instead of a ready-made percent is what makes the
 * arc and the caption incapable of disagreeing: they are the same two numbers.
 * An earlier version fed the arc from `progress.percent` while labelling it
 * with the module counts, and the ring silently told a different story from the
 * sentence beside it.
 *
 * The fraction is still not a compliance figure — both numbers are the
 * server's, and this only draws them.
 */
export function ProgressRing(props: {
  completed: number;
  total: number;
  /** Centre text, "2 von 5". */
  value: string;
  /** Accessible name — the full sentence, since "2 von 5" alone says nothing. */
  label: string;
  /** `onBrand` draws white-on-teal for the sidebar card. */
  tone?: "onBrand" | "onLight";
}) {
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  const total = Math.max(0, props.total);
  const completed = Math.max(0, Math.min(total, props.completed));
  // A course with no modules draws an empty ring rather than dividing by zero.
  const fraction = total === 0 ? 0 : completed / total;
  const dash = fraction * circumference;
  const onBrand = (props.tone ?? "onLight") === "onBrand";

  // The layout stacks the number over the word: a large "2", then "von 5"
  // small beneath it. `value` arrives as "2 von 5" so the caption beside the
  // ring and the ring itself can never disagree; splitting it here is
  // presentation only, and a value that is not in that shape simply renders
  // whole.
  const [count, ...rest] = props.value.split(" ");
  const remainder = rest.join(" ");

  return (
    <div
      className="relative inline-flex h-24 w-24 shrink-0 items-center justify-center"
      role="img"
      aria-label={props.label}
    >
      <svg className="h-24 w-24 -rotate-90" viewBox="0 0 80 80" aria-hidden="true">
        <circle
          cx="40"
          cy="40"
          r={radius}
          fill="none"
          stroke={onBrand ? "rgba(255,255,255,0.28)" : "#e5e7eb"}
          strokeWidth="5"
        />
        {/*
          Omitted entirely at zero rather than drawn with a zero-length dash.
          `strokeLinecap="round"` gives a zero-length segment two round caps,
          which the browser paints as a dot — so a learner who had completed
          nothing saw a stray mark floating on the ring, reading as one unit of
          progress they had not made.
        */}
        {dash === 0 ? null : (
          <circle
            cx="40"
            cy="40"
            r={radius}
            fill="none"
            stroke={onBrand ? "#ffffff" : "var(--ds-brand-600, #17788d)"}
            strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circumference}`}
          />
        )}
      </svg>
      <span
        className={`absolute flex flex-col items-center leading-none ${
          onBrand ? "text-white" : "text-brand-700"
        }`}
      >
        <span className="text-2xl font-bold">{count}</span>
        {remainder === "" ? null : (
          <span className="mt-1 text-xs font-medium">{remainder}</span>
        )}
      </span>
    </div>
  );
}

/**
 * The teal "Ihr Fortschritt" card that sits beside every course tab.
 *
 * It repeats on all four tabs in the layout, and that repetition is load-
 * bearing rather than lazy: the Mediathek's padlocks and the Zertifizierung
 * tab's locked sections are both consequences of module completion, so the
 * count that explains them has to be visible next to them.
 */
export function ProgressPanel(props: {
  title: string;
  completed: number;
  total: number;
  value: string;
  sentence: string;
  action: ReactNode;
  footnote?: string;
}) {
  return (
    /*
     * `rounded-[1.25rem] rounded-tr-none` — the teal family's shape, and the
     * card DEP-29 asks the sticky one to be "consistent with". Measured at
     * 21 px on a 284 px-wide card in the desktop export, against this card's
     * `18rem`; the top-right is square there, as it is on the sticky card and
     * on every tab.
     */
    <aside className="rounded-[1.25rem] rounded-tr-none bg-brand-600 p-5 text-center text-brand-contrast shadow-md">
      <p className="text-base font-bold">{props.title}</p>
      <div className="mt-3 flex justify-center">
        <ProgressRing
          completed={props.completed}
          total={props.total}
          value={props.value}
          label={props.sentence}
          tone="onBrand"
        />
      </div>
      <p className="mt-3 text-sm leading-snug">{props.sentence}</p>
      {props.footnote === undefined ? null : (
        <p className="mt-1 text-xs text-brand-100">{props.footnote}</p>
      )}
      <div className="mt-4">{props.action}</div>
    </aside>
  );
}

export function GateBadge(props: {
  gate: GateStatus;
  labels: Record<GateStatus, string>;
}) {
  const skin: Record<GateStatus, string> = {
    locked: "bg-gray-100 text-status-locked",
    available: "bg-brand-50 text-brand-700",
    completed: "bg-green-50 text-status-completed",
  };

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${skin[props.gate]}`}
    >
      {props.gate === "locked" ? <LockIcon /> : null}
      {props.labels[props.gate]}
    </span>
  );
}

export function LockIcon(props: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={props.className ?? "h-3 w-3"}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M8 1a3 3 0 0 0-3 3v2H4.5A1.5 1.5 0 0 0 3 7.5v6A1.5 1.5 0 0 0 4.5 15h7a1.5 1.5 0 0 0 1.5-1.5v-6A1.5 1.5 0 0 0 11.5 6H11V4a3 3 0 0 0-3-3Zm2 5H6V4a2 2 0 1 1 4 0v2Z" />
    </svg>
  );
}

/**
 * The state glyphs of the player's Fortbildungsfortschritt (layout §4.3).
 *
 * `role="img"` with a name rather than `aria-hidden`, because in this sidebar
 * the icon is the *only* thing distinguishing a finished chapter from a locked
 * one. A decorative padlock would leave a screen-reader user with an
 * undifferentiated list of titles and no way to tell what they may open.
 *
 * Colour carries the same information a second time and never alone (WCAG
 * 1.4.1): every state has a distinct shape.
 *
 * ## The palette is the layout's, and I had half of it backwards (P95-02)
 *
 * The complete desktop layout draws a **finished module as a teal disc with a
 * white tick** and a **module under way as an orange disc with pause bars**.
 * P94-02 made both orange, from an older Zeplin export in which the finished
 * module is orange too — the newer PDF is the authority and this follows it.
 *
 * The split is meaningful and worth keeping straight: teal is the platform's
 * own colour and marks what is *done*; orange is what
 * `tailwind.preset.js` calls *"resume the thing you started"* and marks the one
 * place in the list that wants the learner back. Making both orange gives a
 * finished course five things all asking for attention.
 *
 * `tone` is the level the glyph is drawn at. A finished **chapter** is a bare
 * orange tick in the drawing rather than a disc — the disc belongs to the
 * module, which is the row somebody scans for. Both are branded variables, so a
 * customer restyling the widget restyles these; `status.completed` was a fixed
 * green no customer could reach.
 *
 * A disc is filled and its tick is the hole in it, so the readable pairing is
 * white-on-colour rather than colour-on-white, which is what keeps it above the
 * contrast floor at 16 px while matching the drawing.
 */
export function StateIcon(props: {
  state: "completed" | "playing" | "paused" | "inProgress" | "available" | "locked";
  label: string;
  /** `module` is the disc; `item` is the lighter glyph a chapter or content gets. */
  tone?: "module" | "item";
  /**
   * `exam` draws a clipboard instead of the neutral circle (P103-02).
   *
   * A Lernerfolgskontrolle now sits in its chapter beside the videos, and in a
   * list of identical circles the only thing marking it as the exam is its
   * title — which an author may have called anything. The glyph says what kind
   * of thing it is at a glance, which is what the client asked for.
   *
   * Deliberately **not** applied to `locked` or `completed`. Those two shapes
   * carry information no other row carries — may I open this, and did I pass —
   * and replacing either with a clipboard would trade a state a physician needs
   * for a category they can read in the title. Every state keeps a distinct
   * shape (WCAG 1.4.1); this only replaces the two neutral ones.
   */
  kind?: "exam";
}) {
  const item = props.tone === "item";
  const skin: Record<typeof props.state, string> = {
    completed: item ? "text-cta-500" : "text-brand-600",
    playing: "text-brand-600",
    paused: "text-cta-500",
    inProgress: "text-cta-500",
    available: "text-gray-400",
    locked: "text-gray-500",
  };

  return (
    <span
      role="img"
      aria-label={props.label}
      className={`inline-flex h-4 w-4 shrink-0 items-center justify-center ${skin[props.state]}`}
    >
      {props.state === "locked" ? (
        <LockIcon className="h-4 w-4" />
      ) : props.kind === "exam" && props.state !== "completed" ? (
        <ExamIcon className="h-4 w-4" />
      ) : (
        <svg
          viewBox="0 0 16 16"
          className="h-4 w-4"
          fill="currentColor"
          aria-hidden="true"
        >
          {props.state === "completed" ? (
            item ? (
              /* A bare tick, as the drawing gives a finished chapter. */
              <path d="M6.2 12.3 2.4 8.5a1 1 0 0 1 1.42-1.42l2.4 2.4 6-6.06A1 1 0 0 1 13.6 4.8l-6.7 6.75a1 1 0 0 1-1.42 0Z" />
            ) : (
              <path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0Zm3.86 5.9-4.5 5a1 1 0 0 1-1.46.04L3.9 8.94a1 1 0 1 1 1.42-1.42l1.25 1.25 3.8-4.22a1 1 0 0 1 1.49 1.34Z" />
            )
          ) : props.state === "paused" || props.state === "inProgress" ? (
            <path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0ZM7 11H5.5V5H7v6Zm3.5 0H9V5h1.5v6Z" />
          ) : props.state === "playing" ? (
            <path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0Zm-1.5 4.6 4.4 2.9a.6.6 0 0 1 0 1L6.5 11.4a.6.6 0 0 1-.93-.5V5.1a.6.6 0 0 1 .93-.5Z" />
          ) : (
            /* available — an outline, so "not started" is not a filled state. */
            <path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0Zm0 1.6A6.4 6.4 0 1 1 8 14.4 6.4 6.4 0 0 1 8 1.6Z" />
          )}
        </svg>
      )}
    </span>
  );
}

/**
 * A ticked checklist — the Lernerfolgskontrolle's own glyph (P103-02, P106-03).
 *
 * A checklist rather than a question mark or a pencil: the exam is a set of
 * questions the physician works through and is marked on, and a question mark
 * reads as "help" in every other interface they use that day. `aria-hidden`
 * because `StateIcon` names the row; a second announcement of "exam" beside a
 * row already titled *Lernerfolgskontrolle* is noise to a screen reader.
 *
 * ## Why it is not the clipboard it started as
 *
 * The clipboard was drawn eight units wide in a sixteen-unit box, full height —
 * a tall, narrow, rounded shape. At the 16 px this actually renders at, in
 * `text-gray-400`, beside a column of circles, it read as a grey pill: the
 * client's report was *"maybe another icon for Lernerfolgskontrolle to make it
 * distinguished"*, and looking at the screenshot it is not distinguishable at
 * all — the detail that made it a clipboard is below the size it is used at.
 *
 * This one is built out of the box's full width in strokes, so what survives
 * downscaling is the silhouette — two ticks and two lines — rather than an
 * outline whose interior disappears. Nothing else in the sidebar is wider than
 * it is tall, which is the property doing the work.
 */
export function ExamIcon(props: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={props.className}
      aria-hidden="true"
      // Named so a test can tell this glyph from the state circle. Without it
      // `querySelector("svg")` is true of every row and the assertion cannot go
      // red — a gate that only ever agrees (§9.1).
      data-ds-icon="exam"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* Two ticked items. The ticks are the half that says "answered". */}
      <path d="M0.9 4.1 2.4 5.6 5.1 2.5" />
      <path d="M0.9 11.6 2.4 13.1 5.1 10" />
      <path d="M7.6 4.4h7.5" />
      <path d="M7.6 11.9h7.5" />
    </svg>
  );
}

export function Spinner(props: { label: string }) {
  return (
    <div className="flex items-center gap-2 py-8 text-sm text-gray-600" role="status">
      <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" aria-hidden="true">
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="4"
          fill="none"
        />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4Z"
        />
      </svg>
      {props.label}
    </div>
  );
}

/**
 * `role="alert"` so a screen reader announces a failure the learner did not
 * cause and cannot see coming.
 */
export function ErrorNotice(props: {
  title: string;
  message: string;
  retryLabel?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="rounded-md border border-red-200 bg-red-50 p-4" role="alert">
      <p className="text-sm font-semibold text-red-800">{props.title}</p>
      <p className="mt-1 text-sm text-red-700">{props.message}</p>
      {props.onRetry !== undefined && props.retryLabel !== undefined ? (
        <div className="mt-3">
          <Button variant="secondary" onClick={props.onRetry}>
            {props.retryLabel}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Not signed in — deliberately not an `ErrorNotice` (P99-03).
 *
 * A red alert box with `role="alert"` is for something the learner did not
 * cause and cannot see coming. Not being signed in is neither: it is the
 * ordinary state of anybody who has not logged in yet, and the only thing it
 * needs is a way to do so. Rendering it as a failure is what produced the
 * previous message — a physician told to contact the site's operator because
 * they had not logged in.
 *
 * The action is an `<a>`, not a button: signing in is a navigation, it belongs
 * in the browser's history, and a physician may reasonably want it in a new
 * tab.
 */
export function SignedOutNotice(props: {
  title: string;
  message: string;
  actionLabel: string;
  /** Where signing in happens. Absent when the host named none. */
  signInUrl?: string | undefined;
}) {
  return (
    <div className="rounded-md border border-gray-200 bg-gray-50 p-6 text-center">
      <p className="text-base font-semibold text-gray-900">{props.title}</p>
      <p className="mx-auto mt-2 max-w-prose text-sm text-gray-700">{props.message}</p>
      {props.signInUrl !== undefined && props.signInUrl !== "" ? (
        <a
          className="mt-4 inline-block rounded-full bg-cta-500 px-6 py-2.5 text-sm font-semibold text-white no-underline hover:opacity-90"
          href={props.signInUrl}
        >
          {props.actionLabel}
        </a>
      ) : null}
    </div>
  );
}

export function Section(props: {
  title: string;
  children: ReactNode;
  /**
   * Extra classes on the `<section>` — the Übersicht tab's rules between
   * sections (#63). Appended rather than replacing, so a caller cannot
   * accidentally drop the heading spacing every other tab relies on.
   */
  className?: string;
}) {
  return (
    <section className={`space-y-3 ${props.className ?? ""}`}>
      <h2 className="text-lg font-semibold text-gray-900">{props.title}</h2>
      {props.children}
    </section>
  );
}
