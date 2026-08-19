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

### Is it actually reachable from here?

**Settings → DS Education → Verbindung prüfen** asks this WordPress server
whether the configured addresses answer, and says what came back — a 404, an
unreachable host, or a bundle served without the CORS header a browser needs to
execute it.

It checks the **saved** settings, never a URL from the request, so save before
checking. The API line reports reachability only: whether _this site's origin_
may call the API is decided per project in the DigitalSpital console, and a
server-to-server request carries no `Origin`, so it would pass while every
visitor's browser was refused.

This exists because the first person to notice that the bundle 404'd noticed by
typing its URL into a browser.

---

## Pointing a site at staging, or at any other installation

One field decides it: **Basis-Domain**. Both addresses derive from it —
`api.<domain>` and `widget.<domain>` — so a staging WordPress fills in the
staging domain and is done, and nothing about the plugin differs between the
two. A platform whose hostnames follow no convention is what the two optional
URL fields are for.

The bundle is served with `Access-Control-Allow-Origin: *`, which is correct and
is not a weakening: it is public JavaScript carrying no credentials. Any number
of sites — production, staging, a developer's `localhost` — can load the same
file. The narrow policy is the API's, and it is per project.

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
| Feature flag off  | Route is not registered at all — 404 `{"code":"rest_no_route"}`  |
| Not logged in     | 401 from the permission callback; the handler never runs         |
| Missing/bad nonce | Refused. `X-WP-Nonce` for `wp_rest` is required                  |
| No token held     | 404 `{"token":null,"reason":"no_token_held"}`                    |
| Any request       | `Cache-Control: no-store, private` plus WordPress's no-cache set |

**The two 404s are different, and the body is the only thing that says so.** A
browser console prints `404 (Not Found)` for both, so switching the feature flag
on and off changes nothing an observer can see — which is exactly how a
production report was misread for a day (P97-01). The first means _no route_;
the second means _the route ran and WordPress is holding no Keycloak token for
you_. **Verbindung prüfen** tells them apart in words.

Naming the reason is not a disclosure: the caller has already presented their
own session cookie and a valid nonce, so it is a fact about their own session,
not an answer about anybody else's.

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

## Why the plugin ships no JavaScript

The page carries two attributes and no script:

```html
<ds-lms
  api-base="…"
  project="…"
  course="…"
  token-endpoint="/wp-json/ds-lms/v1/token"
  token-header="X-WP-Nonce: …"
  data-ds-plugin="1.0.0"
></ds-lms>
```

Until 1.0.0 the plugin inlined about forty lines of JavaScript that fetched the
endpoint, handled the refresh case and assigned a `tokenProvider` property. Every
one of those lines already existed inside the widget, in
`apps/widget/src/token.ts` — so a change to _how a token is fetched_ meant a
plugin update on every site (P96-03).

Now the plugin says **where** and **what header**, and the widget owns the
**how**. The widget is still host-agnostic: it knows "fetch a token from this URL
with this header", not "WordPress".

`token-header` is deliberately one header and not a mechanism. WordPress needs
exactly this — a nonce proving the request came from a page it rendered rather
than from another origin borrowing the visitor's cookie — and a general header
facility would be a way for a page to make the widget send anything anywhere. A
malformed value is dropped rather than passed to `fetch`, which would throw
inside the provider and surface as "no token".

Neither attribute is emitted for a logged-out visitor: there is no token to
fetch, and the widget shows its signed-out state.

**`data-ds-plugin`** is the plugin's version, beside the `data-ds-build` the
widget writes for its own. Between them, "which build is this site running?" is
answerable from a browser rather than over FTP.

---

## What deactivating does

Nothing destructive. Settings stay so a reactivation does not lose the
configuration, no post content is rewritten, and a shortcode in a page simply
stops rendering — which is the correct behaviour for a plugin that is off.
