# `ds-lms` — WordPress plugin

Places the DigitalSpital CME learner widget on a WordPress page and gives it a
way to obtain the visitor's Keycloak token. That is its entire job (P6).

It renders no course content, stores no learner state, and decides nothing. All
of that is the API's, and the API validates every bearer token against Keycloak
JWKS regardless of what this plugin says (ADR-0003, CLAUDE.md §4 invariant 2).

---

## Installing

1. Copy `wordpress/ds-lms/` into `wp-content/plugins/` and activate it.

2. **Settings → DS Education**: Basis-Domain, Projekt-Slug, default course.

There is no build step and no bundle to copy. The plugin folder in this
repository is the plugin — what you see is what you install.

---

## Where the JavaScript comes from

Not from this plugin. `<ds-lms>` is loaded from the platform's own widget host:

```
https://widget.<Basis-Domain>/ds-lms.js
```

derived from the Basis-Domain by the same rule `infra/deploy/domains.sh` uses,
so the two cannot disagree. **Widget-JavaScript-URL** overrides it when a
customer serves the file from somewhere else.

Two consequences, and both are the point:

- **A fix to the widget needs no plugin update.** It ships on our next deploy
  and reaches every site within the five minutes `infra/nginx/widget.conf`
  allows a browser to cache it.
- **There is no `?ver=`.** A plugin version in the URL would pin visitors to
  whatever bundle was current when the plugin was last released, which is the
  coupling this removes. Freshness is the cache header's job.

Until P96-01 the plugin enqueued its own `assets/ds-lms.js`, written by
`pnpm wp:bundle`. That file was a gitignored build artefact, so **every copy of
the plugin taken from this repository was missing it** — the browser 404'd, the
`<ds-lms>` element never upgraded, and WordPress reported nothing at all. A
staging install found it exactly that way. CLAUDE.md §9.9: a step documented for
a human to perform is a step that does not happen.

### What the customer's site has to allow

If the site sends a `Content-Security-Policy`, it must name the widget host in
`script-src` — otherwise the browser refuses the script and the page shows an
empty area with the reason only in its console:

```
script-src 'self' https://widget.digitalspital.de;
```

The API is a separate permission: the site's origin has to be listed in the
project's **Erlaubte Einbettungs-Domains** in the admin console, or every request the widget
makes is refused by CORS.

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
