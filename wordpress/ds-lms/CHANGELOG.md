# Changelog — `ds-lms`

The plugin's own version, which is **not** the platform's. The whole point of
1.0.0 is that this number can now stand still while the product moves: the
learner widget is loaded from the platform and released with it, so a change to
a screen, a rule, a message or a request never appears here.

What does appear here is a change to the six things the plugin still decides:
where to look for the platform, what the settings are called, what markup goes
on the page, who may call the token endpoint, what the editor is told when
something is missing, and which WordPress and PHP versions are required.

Newest first. `tests/security-test.php` refuses a release whose newest entry
here disagrees with `Version:` in `ds-lms.php`.

## 1.1.0 — 19.08.2026

### The MEDICE login is recognised, and WordPress is out of it (P98-01)

The client supplied their Keycloak plugin **and their theme**, which settled a
question that had been open since July and answered it the other way round from
what we had recorded.

**The token was there all along.** `theme/functions/login-class.php` stores the
entire Keycloak token response — `access_token`, `refresh_token`, `expires_in` —
in `$_SESSION['LOGIN_SESSION']`, and the grant requests `offline_access`. Our
28.07 note said no token was persisted; that was written after reading the
plugin and not the theme.

**But no physician is a WordPress user.** There is no `wp_signon`,
`wp_set_auth_cookie` or `wp_insert_user` anywhere in either. `is_user_logged_in()`
is false for all of them — and this plugin gated three separate things on it, so
a physician got an element with no way to authenticate, an endpoint that refused
them, and a token source that returned null.

All three now ask the only question that means anything on that site: **is there
an access token in this request's session?**

- **New setting: Session-Schlüssel des Logins**, defaulting to `LOGIN_SESSION`.
  Only `access_token` is read from it.
- **DocCheck logins** are handled honestly: no Keycloak token, no token
  endpoint, and the widget's signed-out state rather than a broken screen.
- **Removed:** the user-meta strategies. They needed a WordPress user id, there
  is never one, and code that cannot run is worse than absent.
- **Verbindung prüfen** now separates "no PHP session on this request" from "a
  session with no token in it", and when a token _is_ present it prints the
  token's **Issuer** and **Audience** — the two values that must match the
  project's `keycloak_issuer` and `keycloak_audience` in the DigitalSpital
  console, and the next thing that would otherwise have failed as a silent 401.
  Never the token, the subject or any personal claim.

**Security note, because the change is real:** the token endpoint used to
require a WordPress user and now requires a session holding a token. Same-origin
is checked explicitly rather than inherited from WordPress's CORS defaults. The
`wp_rest` nonce is retained but is **not** a defence here — with no user id
behind it, every anonymous visitor shares a value that is readable from a public
page. This was reviewed as an auth change, not a refactor.

## 1.0.1 — 19.08.2026

### The token endpoint's two 404s are now distinguishable (P97-01)

Reported from production: the widget was signed out on a site where a MEDICE
Keycloak user _was_ logged in, and the console showed `404` on the token
endpoint. Turning **Token-Endpunkt aktivieren** on and then off produced exactly
the same console output both times — because two unrelated conditions answer
404, and a browser prints only the status:

- the flag is off, so WordPress has no route to match;
- the flag is on, the route ran, and nothing is holding a token.

The second now answers `{"token":null,"reason":"no_token_held"}`, and
**Verbindung prüfen** gained a **Token-Endpunkt** line that says which of the
three states the site is in — off, on-but-tokenless, or working — and names the
`ds_lms_access_token` filter when that is what is missing.

The underlying cause is not in this plugin: MEDICE's Keycloak plugin obtains an
access token by password grant and does not persist it, so there is nothing for
`DS_LMS_Token_Source` to read. See `docs/show-stoppers.md` S2.

## 1.0.0 — 18.08.2026

The release that makes the plugin stop needing releases.

### The widget is loaded from the platform (P96-01)

Until now the plugin enqueued `assets/ds-lms.js` from its own folder — a build
artefact written by `pnpm wp:bundle`, gitignored, and therefore **absent from
every copy of the plugin taken from the repository**. The browser answered 404,
the `<ds-lms>` element never upgraded, and nothing in WordPress said so.

It now loads `https://widget.<Basis-Domain>/ds-lms.js`, derived from the
Basis-Domain by the same rule the platform's deploy uses.

- **Update the widget without updating the plugin.** A fix ships on our next
  deploy and reaches every site within five minutes.
- **No build step before installing.** Copy the folder, activate, configure.
- **No `?ver=`.** A plugin version in the bundle's URL would pin visitors to
  whatever was current at the last plugin release, which is the coupling this
  removes.
- **New setting:** Widget-JavaScript-URL (optional), for a site serving the file
  from somewhere else. Empty means derived.
- The settings screen now prints the resolved API and widget addresses, and an
  editor placing a shortcode with no widget address configured is told which
  field to fill rather than seeing an empty page.

### The plugin sends data where it used to send JavaScript (P96-03)

`attach_token_provider()` wrote about forty lines of inline JavaScript into
every page carrying the widget, and those lines were a copy of code that already
exists inside the widget. Any change to how a token is fetched — a retry, a
timeout, a different failure — therefore needed a plugin update on every site.

The page now carries `token-endpoint` and `token-header` attributes and no
script at all. The behaviour behind them belongs to the bundle and updates with
it.

### Diagnostics on the settings screen (P96-04)

**Verbindung prüfen** asks this WordPress server whether the configured
addresses actually answer, and says what came back. This release exists because
a 404 on the bundle was found by a person opening the URL by hand.

### Also

- The version is shown on the settings screen, and the element carries
  `data-ds-plugin`, so "which plugin is on this site" is answerable from a
  browser (CLAUDE.md §9.9).

## 0.1.0 — 28.07.2026

First working plugin (P6-01, P6-02): the block, the shortcode, the settings
screen, and `GET /wp-json/ds-lms/v1/token` returning the calling user's own
Keycloak token behind a feature flag, a nonce and a permission callback.
