/**
 * Mounting `<ds-lms>` from React (P11-01, ADR-0007).
 *
 * This component is the entire learner experience in the portal — the
 * catalogue, watching, the Lernerfolgskontrolle, the Evaluationsbogen, the EFN,
 * the certificate — all inside the widget's closed shadow root. The portal
 * draws a header, a back link, and the URL bar.
 *
 * ## Why the catalogue is the widget's and not the portal's
 *
 * It was the portal's, once: a second React screen calling the same
 * `GET /courses`. Two implementations of one approved layout (§4.1) is two
 * places for the delivery-type tabs, the facet dropdowns, the removable filter
 * chips and the numbered pagination to drift, and only one of them had tests.
 * ADR-0007 already said what the portal is — a host adapter — and a catalogue of
 * its own was the one place it stopped being one.
 *
 * What the portal keeps is the part that is genuinely its own: **URLs.** A
 * course here has an address a learner can bookmark and a back button that
 * works, which a widget rendering inside somebody else's WordPress page must
 * not try to provide.
 *
 * ## How the two fit together
 *
 * With no `course` attribute the widget shows the catalogue. Picking a course
 * dispatches a cancelable `ds-lms:course-open`; this component cancels it —
 * saying "I am routing" — and pushes a history entry instead. The widget then
 * stays on the catalogue until React swaps the element for one pinned to the
 * course. Without the cancel, both would navigate and the course would appear
 * twice.
 *
 * ## Why the token provider is set imperatively
 *
 * `tokenProvider` is a property, not an attribute — a function cannot be a
 * string — so React's JSX cannot set it. It is assigned on the element in a
 * ref callback, **before** the element is attached, which is why the widget
 * re-applies own properties on upgrade (see `element.ts`): the property may be
 * set before or after the custom element definition loads, and both orders have
 * to work.
 *
 * ## Why the element is keyed
 *
 * `<ds-lms>` reads its attributes once, at connect time, deliberately: they are
 * page configuration, and re-reading them would let a host swap the course
 * underneath a learner mid-video. So navigating has to produce a *new* element
 * rather than a mutated one, and `key` is what makes React do that.
 */

import { useCallback, useEffect, useRef } from "react";
import type { PortalConfig } from "../config.js";

type TokenProvider = (request: {
  readonly refresh: boolean;
}) => Promise<string | undefined>;

/** Mirrors `CourseOpenDetail` in the widget — see the note on the type below. */
interface CourseOpenDetail {
  readonly slug: string;
}

const COURSE_OPEN_EVENT = "ds-lms:course-open";

/**
 * The element as React sees it.
 *
 * Declared locally rather than imported from the widget: the widget is loaded
 * as a separate script (see `index.html`), so there is no module to import a
 * type from, and inventing a dependency purely for a type would undo that. The
 * attributes and the event name are the `HostContext` contract from ADR-0007 —
 * if this needs another entry, the contract has changed and the ADR is the
 * place that says so.
 */
interface DsLmsAttributes {
  "api-base": string;
  project: string;
  /** Omitted for the catalogue. */
  course?: string;
  ref?: (element: (HTMLElement & { tokenProvider?: TokenProvider }) | null) => void;
  key?: string;
}

declare module "react" {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- React's own augmentation shape
  namespace JSX {
    interface IntrinsicElements {
      "ds-lms": DsLmsAttributes;
    }
  }
}

export function WidgetMount(props: {
  config: PortalConfig;
  /** `undefined` mounts the catalogue. */
  courseSlug: string | undefined;
  tokenProvider: TokenProvider;
  onOpenCourse: (slug: string) => void;
}) {
  const { tokenProvider, onOpenCourse } = props;

  const attach = useCallback(
    (element: (HTMLElement & { tokenProvider?: TokenProvider }) | null) => {
      if (element === null) return;
      element.tokenProvider = tokenProvider;
    },
    [tokenProvider],
  );

  /*
    A native listener on the wrapper, not a React prop: React's synthetic
    system has no name for a colon-separated custom event, and the JSX would
    silently do nothing. It goes on the wrapper rather than the element because
    the wrapper is a plain node React owns for the whole mount, while the
    element is replaced on every navigation.

    `preventDefault` is the protocol, not a formality — it is how the widget is
    told the host took over, and without it both would navigate.
  */
  const wrapper = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = wrapper.current;
    if (node === null) return;

    const listener = (event: Event) => {
      const slug = (event as CustomEvent<CourseOpenDetail>).detail?.slug;
      if (typeof slug !== "string" || slug === "") return;
      event.preventDefault();
      onOpenCourse(slug);
    };

    node.addEventListener(COURSE_OPEN_EVENT, listener);
    return () => node.removeEventListener(COURSE_OPEN_EVENT, listener);
  }, [onOpenCourse]);

  return (
    <div ref={wrapper}>
      <ds-lms
        key={props.courseSlug ?? "__catalogue__"}
        ref={attach}
        api-base={props.config.apiBase}
        project={props.config.projectSlug}
        {...(props.courseSlug === undefined ? {} : { course: props.courseSlug })}
      />
    </div>
  );
}
