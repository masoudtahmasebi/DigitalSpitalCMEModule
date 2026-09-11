/**
 * The API client a visitor holding no platform token gets (P213-01).
 *
 * ## Why this exists at all
 *
 * On the MEDICE site there are two logins. One goes through Keycloak and
 * produces an access token the API validates against JWKS; the other is
 * **DocCheck**, a cookie the site sets to say "this is a healthcare
 * professional", which involves no realm of ours and therefore yields no token.
 * `class-ds-lms-token-source.php` has said so since P96, and the plugin renders
 * `signed-in="no"` for such a visitor — which is how this file is reached.
 *
 * Until now that visitor saw one sentence inviting them to sign in. The client
 * asked for the catalogue and the course descriptions to be readable first, and
 * for the invitation to arrive at the moment they reach for something that
 * needs an identity.
 *
 * ## What makes this safe, and why it is a *client* rather than a mode
 *
 * The preview routes are the only two this client may usefully call. Everything
 * else on `ApiClient` still points at the authenticated routes and will be
 * refused, because there is no token to send — which is correct and is not
 * something this file works around. A widget in preview never reaches them:
 * `PreviewApp` renders descriptions and a dialog, and mounts no player, no
 * exam and no Punktemeldung.
 *
 * Substituting the two catalogue methods rather than adding a `preview` flag to
 * every component is deliberate. `CourseList`, `OverviewTab`, `ExpertsTab` and
 * `CertificationTab` render the preview unchanged, so the two audiences cannot
 * drift into two different catalogues — which is the same argument the API
 * makes for running the preview through the ordinary catalogue query (§9.10b).
 *
 * ## The project's permission is the server's answer, not a flag from the page
 *
 * Nothing here asks whether the preview is allowed. The widget calls
 * `listCourses` and the API answers 404 when the project has not set
 * `doccheck_login_allowed` — the same 404 it gives for a project that does not
 * exist, so this cannot be used to enumerate them (ADR-0007). A host page
 * attribute would be a claim by the page about its own permissions, which is
 * exactly what §4 invariant 2 refuses to accept anywhere else.
 */

import { createClient, type ApiClient } from "@ds/sdk";
import type { WidgetConfig } from "./api.js";

export function createPreviewClient(config: WidgetConfig): ApiClient {
  const client = createClient({
    baseUrl: config.apiBase,
    projectSlug: config.projectSlug,
    ...(config.profileHint === undefined ? {} : { profileHint: config.profileHint }),
    /*
     * No `getToken`, and no `credentials: "include"`.
     *
     * There is nothing to send: a DocCheck visitor has no bearer and no
     * participant session cookie of ours. Sending credentials on a route that
     * is `@Public()` would also mean every preview request carried whatever
     * same-origin cookie the browser happens to hold, for no purpose.
     */
  });

  return {
    ...client,
    listCourses: client.listPreviewCourses,
    getCourseBySlug: client.getPreviewCourseBySlug,
  };
}
