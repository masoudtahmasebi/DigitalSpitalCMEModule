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
