/**
 * A failed load, told apart from a session that has ended (P214-01).
 *
 * ## Why this is a component and not two branches at each call site
 *
 * Because there are several call sites and the branch was missing from all of
 * them. Every screen that could not load rendered a red `ErrorNotice` headed
 * *"Es ist ein Fehler aufgetreten"* — correct for a 500, for a network drop,
 * for a course that vanished, and wrong for the commonest cause of all: the
 * physician's Keycloak session expired while they were reading.
 *
 * That is P99-03's defect, which was fixed once for the case the **host page**
 * reports (`signed-in="no"`) and never for the case only the *token fetch* can
 * discover — the page believed they were signed in, and by the time the widget
 * asked, WordPress had nothing to give. A physician was told the site was
 * broken and to contact its operator.
 *
 * ## Why the copy is the *expired* wording and not "please sign in"
 *
 * Reaching this component at all means `App` did **not** take the
 * `signedIn === false` branch — the host page said somebody was signed in. So
 * this is not a visitor who never logged in; it is a session that ended. The
 * difference is what a physician needs to hear next, and
 * `de.signedOut.expiredMessage` is the sentence written for it: *"Ihr
 * Fortschritt ist gespeichert. Bitte melden Sie sich erneut an, um dort
 * weiterzumachen, wo Sie aufgehört haben."*
 *
 * Those two strings have existed in the locale since P99-02 and were rendered
 * by **nothing** — CLAUDE.md §9.3, found by `grep` while fixing the endpoint
 * that made them reachable.
 *
 * ## And why it is not an alert
 *
 * `SignedOutNotice`, not `ErrorNotice`: a red box with `role="alert"` is for
 * something the reader did not cause and cannot fix. A session timing out is
 * neither — it is ordinary, and the only thing it needs is a way back in.
 */

import { de } from "../locale/de.js";
import { NO_TOKEN_HELD, TokenUnavailableError } from "../token.js";
import { describeError } from "../hooks.js";
import { ErrorNotice, SignedOutNotice } from "./primitives.js";

/**
 * Did this fail because the session is gone, rather than because something
 * broke?
 *
 * Exactly one reason qualifies: the token endpoint answered, correctly, that
 * it holds nothing for this visitor. A transport failure reaching that endpoint
 * is **not** this — `endpoint_500` or a refused fetch is a fault somebody has
 * to fix, and dressing it as "please sign in again" would send a physician
 * round a loop that cannot end (P101-03's lesson, kept).
 */
export function isSessionExpired(error: Error | undefined): boolean {
  return error instanceof TokenUnavailableError && error.reason === NO_TOKEN_HELD;
}

export function FailureNotice(props: {
  error: Error | undefined;
  /** Where the host signs somebody in. Absent when the page named none. */
  signInUrl: string | undefined;
  onRetry: () => void;
}) {
  if (isSessionExpired(props.error)) {
    return (
      <SignedOutNotice
        title={de.signedOut.expiredTitle}
        message={de.signedOut.expiredMessage}
        actionLabel={de.signedOut.action}
        signInUrl={props.signInUrl}
      />
    );
  }

  return (
    <ErrorNotice
      title={de.error.title}
      message={describeError(props.error, de.error)}
      retryLabel={de.error.retry}
      onRetry={props.onRetry}
    />
  );
}
