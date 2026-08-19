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

## 1.4.0 — 19.08.2026

### `[ds_lms catalogue="1"]` — the Fortbildungsbereich, not one Fortbildung (P99-04)

Reported: _"the original page … should load all of the courses, not a certain
course"_.

A bare `[ds_lms]` falls back to **Standard-Fortbildung**, so on a site that has
configured one there was **no way to ask for the list at all**. The catalogue —
the teal hero, the CME seal, the Thema and Altersgruppe filters, a card per
Fortbildung — has been built since P58 and was unreachable from any such page.
§9.2's mirror image: not offering what the system will do.

`catalogue="1"` overrides the default and any `course` beside it, so a landing
page says what it wants and gets it.

## 1.3.0 — 19.08.2026

### The page says whether somebody is signed in, so the widget stops guessing (P99-03)

Asked for directly: _"if the user is not logged in to medice keycloak, we don't
even show the errors, we tell them to login, and our source of truth for being
logged in can even be the website"_.

The element now carries **`signed-in="yes|no"`** and **`sign-in-url`**. A
visitor with no Keycloak token sees an invitation to sign in with a working
**Anmelden** link, and the widget makes **no API request at all** — so a
signed-out page has a clean console instead of a wall of 401s.

Until now that visitor got _"Diese Fortbildung ist nicht korrekt eingebunden.
Bitte wenden Sie sich an den Betreiber der Seite."_ — a physician told to ring
the webmaster because they had not logged in. Wrong diagnosis, wrong audience,
nothing to click.

**This is presentation, and only presentation.** It decides what a person sees
and nothing about what they may do: every request still carries a token the API
validates against Keycloak's JWKS, so a page asserting `signed-in="yes"` gains a
caller precisely nothing. CLAUDE.md §4 invariant 2 — _never trust WordPress that
a user is authenticated_ — is untouched. We trust the page about what to draw.

- **DocCheck counts as signed out here**, because it yields no Keycloak token
  and a CME point cannot be awarded to somebody the accreditation chain cannot
  name. Those visitors get the same invitation, which is what they need.
- **New setting: Anmelde-URL.** Empty derives MEDICE's own trigger, read from
  their theme — `showLoginPopup=required&onlyMediceLogin=1&redirect_hscp_url=…`.
  `onlyMediceLogin=1` is deliberate: it excludes DocCheck. `%s` in a custom
  value is replaced by the current page.
- The return address is built from `home_url()`, **never** from the `Host`
  header: a sign-in link is somewhere we send a person, and a caller-supplied
  host in it is an open redirect wearing our name.

**Requires the platform deploy that ships widget support for these attributes.**
An older widget ignores them and behaves exactly as before.

## 1.2.0 — 19.08.2026

### The token is renewed instead of expiring under the learner (P99-02)

Reported from the live site: _"my user was still logged in on the wordpress
website for medice keycloak, but our system said your session is done, please
try again, and it had the try again button, and that did not work"_.

The theme writes the Keycloak token response into the session **once, at login**,
and nothing anywhere ever touches it again — `grep refresh_token` across the
theme and the Keycloak plugin finds nothing. A Keycloak access token lives five
minutes by default; a MEDICE session lives as long as the browser does. So the
_normal_ state of the site an hour after anyone signed in was a live session
holding a dead token, the API refusing it, and a **Erneut versuchen** button that
re-read the same dead token and could never succeed. A 25-minute module could not
be completed at all.

The `refresh_token` was in the same array the whole time, and the login grant
asks for `offline_access`, so it outlives the access token by design.

- An expired token — or one within a minute of expiring, because four seconds
  left is a race that reads as a random sign-out — is **refreshed** before it is
  handed over.
- The new pair is **written back into the session**, which is what the login
  wrote, so the whole site gets the fresh token rather than just the widget.
- The client id, secret and realm come from **MEDICE's own plugin**
  (`Keycloak::getSettings()`), so there is exactly one client secret on the site
  and nothing to keep in step.
- A refresh the realm refuses — a revoked offline token — yields no token and
  says so. That person really must sign in again, and the realm's error text
  never reaches a screen or a log: it is about their credential.
- Without the Keycloak plugin present, refresh is unavailable and **Verbindung
  prüfen** says so in those words, instead of the product failing mid-video.

**Verbindung prüfen** now also shows how many minutes the current token has left.
Without it, the condition that caused this had no symptom on any screen: the
website said signed in, the widget said signed out, and nothing mentioned a
clock.

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
