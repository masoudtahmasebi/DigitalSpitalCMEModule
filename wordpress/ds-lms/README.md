# `ds-lms` — WordPress plugin

Places the DigitalSpital CME learner widget on a WordPress page and gives it a
way to obtain the visitor's Keycloak token. That is its entire job (P6).

It renders no course content, stores no learner state, and decides nothing. All
of that is the API's, and the API validates every bearer token against Keycloak
JWKS regardless of what this plugin says (ADR-0003, CLAUDE.md §4 invariant 2).

---

## Installing

1. Build the widget bundle and copy it in:

   ```
   pnpm wp:bundle
   ```

   This writes `assets/ds-lms.js`. It is **not committed** — it is a build
   artefact of `apps/widget`, and a committed copy would drift from the source
   it was built from.

2. Copy `wordpress/ds-lms/` into `wp-content/plugins/` and activate it.

3. **Settings → DS Education**: API base URL, project slug, default course.

---

## Using it

Either the block (**DS Education — Fortbildung**) or the shortcode:

```
[ds_lms]
[ds_lms course="adhs-akademie-adult"]
```

Both go through the same `DS_LMS_Renderer::render()`, so they cannot disagree
about what they produce. The bundle is enqueued only on pages that actually use
one of them.

---

## The token endpoint

`GET /wp-json/ds-lms/v1/token` returns the **calling user's own** Keycloak
access token, so the widget can present it to the API.

It is **off by default**. Enable it in the settings screen; the checkbox is a
kill switch that takes effect immediately with no deployment.

| Condition         | Behaviour                                                        |
| ----------------- | ---------------------------------------------------------------- |
| Feature flag off  | Route is not registered at all — 404, not a 403 that confirms it |
| Not logged in     | 401 from the permission callback; the handler never runs         |
| Missing/bad nonce | Refused. `X-WP-Nonce` for `wp_rest` is required                  |
| No token held     | `404 {"token": null}` — whether one exists is not disclosed      |
| Any request       | `Cache-Control: no-store, private` plus WordPress's no-cache set |

**There is no `user` parameter, and there cannot be one.**
`DS_LMS_Token_Source::current()` takes no arguments — "returns only the
caller's token" is not a check that could be forgotten, it is the only thing
the code is able to express.

The token appears in no rendered HTML, no enqueued asset, no log and no
transient.

### The part that is not yet verified

`DS_LMS_Token_Source` reads the token that MEDICE's existing
`keycloakWordPressPlugin` holds. **We have not seen that plugin's code** —
`S3` in `docs/show-stoppers.md` is still open — so the read strategies in that
file are written against the developer's description and are unverified.

That is why they live in one small file with one method. When repository access
arrives, the work is to confirm which strategy fires and delete the others.
Nothing else in this plugin, the widget or the API changes.

**The smallest possible change on the MEDICE side** is one filter, added
anywhere, modifying no existing function — which is exactly what P6-02's
"purely additive" acceptance criterion asks for:

```php
add_filter( 'ds_lms_access_token', function () {
    return my_keycloak_plugin_current_access_token(); // whatever they call it
} );
```

If they add that, none of the fallback strategies run.

---

## Why the token provider is installed by an inline script

The widget exposes a `tokenProvider` property and knows nothing about
WordPress — no nonce header, no REST route, no cookie assumptions. The
WordPress-specific half lives in `DS_LMS_Renderer::attach_token_provider()`, so
the same bundle runs unchanged in the dev harness and anywhere else it is
embedded later.

The inline script runs **before** the deferred module that defines the custom
element, so it assigns the property to an element that has not upgraded yet.
The widget handles that explicitly (`#upgradeProperty` in `element.ts`); the
naive implementation loses the value at upgrade and shows "not correctly
embedded" on a perfectly configured page. There is a test for that exact
ordering.

---

## What deactivating does

Nothing destructive. Settings stay so a reactivation does not lose the
configuration, no post content is rewritten, and a shortcode in a page simply
stops rendering — which is the correct behaviour for a plugin that is off.
