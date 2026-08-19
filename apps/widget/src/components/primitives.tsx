/**
 * Shared presentational pieces.
 *
 * Everything here is dumb on purpose: no fetching, no gate decisions, no
 * German copy of its own. Copy arrives as props from `locale/de.ts`.
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
  size?: "md" | "sm";
  disabled?: boolean;
  children: ReactNode;
}) {
  const variant = props.variant ?? "primary";
  const size = props.size ?? "md";

  const base =
    "inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-colors " +
    "disabled:cursor-not-allowed disabled:opacity-60";
  const metrics = size === "sm" ? "px-4 py-1.5 text-xs" : "px-6 py-2.5 text-sm";

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
                "rounded-t-xl px-6 py-2.5 text-sm font-semibold transition-colors " +
                (selected
                  ? // The active tab is white and joins the panel below it,
                    // which is what makes the row read as tabs rather than as
                    // buttons. Hidden below `sm`, where the heading above the
                    // panel *is* this tab — a selected tab rendered among the
                    // buttons underneath would read as somewhere else to go.
                    "border border-b-0 border-gray-100 bg-white text-brand-700 max-sm:hidden"
                  : "bg-brand-600 text-brand-contrast hover:bg-brand-700 max-sm:rounded-full max-sm:py-3.5 max-sm:text-base")
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
 * It overlaps the hero by design (`-mt-7`), which is what ties the two together
 * in the layout. The CME points sit in an orange chip because that number is
 * the reason the learner is here.
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
    <div className="relative z-10 mx-4 -mt-7 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl bg-white px-5 py-3 shadow-md max-sm:flex-col max-sm:gap-y-4 max-sm:px-5 max-sm:py-6">
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
         * `overflow-hidden` on the pill and square corners on the halves: the
         * outer radius is the pill's, and letting each half round its own end
         * would put a notch where the hairline is.
         */
        <span className="flex items-center overflow-hidden rounded-full bg-cta-500 text-cta-contrast">
          <span className="px-4 py-1.5 text-base font-bold max-sm:py-2 max-sm:text-lg">
            {props.points}
          </span>
          <span className="border-l border-white/60 px-4 py-1.5 text-base font-semibold max-sm:py-2">
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

export function ModulesIcon(props: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      // Orange, for the reason on ClockIcon.
      className={props.className ?? "h-5 w-5 text-cta-500"}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M3 3h6v6H3V3Zm0 8h6v6H3v-6Zm8-8h6v6h-6V3Zm0 8h6v6h-6v-6Z" />
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
    <aside className="rounded-2xl bg-brand-600 p-5 text-center text-brand-contrast shadow-md">
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
 * The state glyphs of the player's Modul Übersicht (layout §4.3).
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
