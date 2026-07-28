/**
 * Mounting `<ds-lms>` from React (P11-01, ADR-0007).
 *
 * This component is the entire learner experience in the portal: everything a
 * physician does — watching, the Lernerfolgskontrolle, the Evaluationsbogen,
 * the EFN, the certificate — happens inside the widget's closed shadow root.
 * The portal draws a header and a back link and nothing else.
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
 * ## Why the element is keyed by course slug
 *
 * `<ds-lms>` reads its attributes once, at connect time, deliberately: they are
 * page configuration, and re-reading them would let a host swap the course
 * underneath a learner mid-video. So navigating between courses has to produce
 * a *new* element rather than a mutated one, and `key` is what makes React do
 * that instead of reusing the node.
 */

import { useCallback } from "react";
import type { PortalConfig } from "../config.js";

type TokenProvider = (request: {
  readonly refresh: boolean;
}) => Promise<string | undefined>;

/**
 * The element as React sees it.
 *
 * Declared locally rather than imported from the widget: the widget is loaded
 * as a separate script (see `index.html`), so there is no module to import a
 * type from, and inventing a dependency purely for a type would undo that.
 * These four attributes are the `HostContext` contract from ADR-0007 — if this
 * list needs a fifth entry, the contract has changed and the ADR is the place
 * that says so.
 */
interface DsLmsAttributes {
  "api-base": string;
  project: string;
  course: string;
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

export function CourseMount(props: {
  config: PortalConfig;
  courseSlug: string;
  tokenProvider: TokenProvider;
}) {
  const { tokenProvider } = props;

  const attach = useCallback(
    (element: (HTMLElement & { tokenProvider?: TokenProvider }) | null) => {
      if (element === null) return;
      element.tokenProvider = tokenProvider;
    },
    [tokenProvider],
  );

  return (
    <ds-lms
      key={props.courseSlug}
      ref={attach}
      api-base={props.config.apiBase}
      project={props.config.projectSlug}
      course={props.courseSlug}
    />
  );
}
