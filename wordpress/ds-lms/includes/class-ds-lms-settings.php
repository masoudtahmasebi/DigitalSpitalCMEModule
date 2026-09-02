<?php
/**
 * Plugin configuration (P6-01, P16-03).
 *
 * API base URL, project slug and the default course slug come from WordPress
 * settings rather than from code, because the same plugin has to run against a
 * staging API and a production one without a rebuild.
 *
 * None of these is a secret. The project slug identifies which host surface is
 * calling (ADR-0007); presenting it grants nothing on its own, and the API
 * still validates every bearer token against the realm that slug resolves to.
 *
 * ## One base domain, like everywhere else
 *
 * `base_domain` is the field a site administrator fills in — `digitalspital.com`
 * — and `api_base` is derived from it as `https://api.<base>`. The same rule the
 * server uses (`infra/deploy/domains.sh`), so the two cannot disagree by being
 * typed twice.
 *
 * `api_base` remains settable and still wins when set, because a customer
 * pointing at a staging API on a hostname that follows no convention should not
 * have to abandon the field to do it. A derivation that cannot be overridden is
 * one you eventually delete.
 *
 * @package ds-lms
 */

declare( strict_types = 1 );

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class DS_LMS_Settings {

	public const OPTION = 'ds_lms_settings';

	public static function boot(): void {
		add_action( 'admin_init', array( self::class, 'register' ) );
		add_action( 'admin_menu', array( self::class, 'add_page' ) );
	}

	/**
	 * The label the API lives under. Mirrors `API_LABEL` in domains.sh.
	 *
	 * A constant rather than a fourth settings field: a site that needs a
	 * different label is a site that should fill in `api_base` directly, and
	 * a field nobody changes is a field somebody eventually breaks.
	 */
	private const API_LABEL = 'api';

	/**
	 * The label the widget bundle is served from. Mirrors `WIDGET_LABEL` in
	 * domains.sh, the same way `API_LABEL` mirrors `API_LABEL` (P96-01).
	 *
	 * A separate host and not a path on the API, deliberately: the bundle goes
	 * out with `Access-Control-Allow-Origin: *` because it is public
	 * JavaScript fetched by a `<script type="module">` on the customer's
	 * origin, and the API's policy is a narrow allowlist that also sends
	 * credentials. The fetch specification forbids that pair, so the two
	 * cannot share an origin. `infra/nginx/widget.conf` is where those headers
	 * live.
	 */
	private const WIDGET_LABEL = 'widget';

	/** MEDICE's `Profile::$LOGIN_SESSION_KEY`. See `all()`. */
	public const DEFAULT_SESSION_KEY = 'LOGIN_SESSION';

	/**
	 * The stored settings, with defaults filled in and `api_base` derived.
	 *
	 * @return array{base_domain:string,api_base:string,widget_url:string,project_slug:string,session_key:string,sign_in_url:string,token_endpoint_enabled:bool}
	 */
	public static function all(): array {
		$stored = get_option( self::OPTION, array() );
		if ( ! is_array( $stored ) ) {
			$stored = array();
		}

		$base_domain = isset( $stored['base_domain'] ) ? (string) $stored['base_domain'] : '';
		$api_base    = isset( $stored['api_base'] ) ? (string) $stored['api_base'] : '';
		$widget_url  = isset( $stored['widget_url'] ) ? (string) $stored['widget_url'] : '';
		$session_key = isset( $stored['session_key'] ) ? (string) $stored['session_key'] : '';

		return array(
			'base_domain'  => $base_domain,
			// Explicit wins; otherwise derived. Both may be empty, and the
			// renderer treats that as "not configured yet" and says so to an
			// editor rather than emitting a broken element to a visitor.
			'api_base'     => '' !== $api_base ? $api_base : self::derive_api_base( $base_domain ),
			/*
			 * Where the widget's JavaScript comes from (P96-01).
			 *
			 * **The platform's host, not this plugin's directory.** The bundle
			 * used to be copied into `assets/` by a build step somebody had to
			 * run before packaging the plugin — and a build artefact that a
			 * human must remember to produce is one that is missing, which is
			 * exactly how a staging install came to answer 404 for
			 * `assets/ds-lms.js` with the plugin reporting nothing at all.
			 *
			 * Loading it from us is also what the client asked for and the
			 * better arrangement on its own terms: a fix to the widget reaches
			 * every customer's site on the next deploy, without anybody
			 * reinstalling a plugin. `widget.conf` serves it with a
			 * five-minute revalidating cache so that stays true within minutes.
			 */
			'widget_url'   => self::resolve_widget_url( $widget_url, $base_domain, $api_base ),
			'project_slug' => isset( $stored['project_slug'] ) ? (string) $stored['project_slug'] : '',
			/*
			 * The host's login session key (P98-01).
			 *
			 * `LOGIN_SESSION` by default because that is what MEDICE's theme
			 * uses — `Profile::$LOGIN_SESSION_KEY` in
			 * `functions/login-class.php` — and MEDICE is who this plugin is
			 * for. A site whose login code uses another key changes a field
			 * rather than waiting for a release.
			 */
			'session_key'  => '' !== $session_key ? $session_key : self::DEFAULT_SESSION_KEY,
			// Empty means "derive MEDICE's own login trigger" — see sign_in_url().
			'sign_in_url'  => isset( $stored['sign_in_url'] ) ? (string) $stored['sign_in_url'] : '',
			// The kill switch for P6-02. Default **off**: a token endpoint that
			// appears the moment the plugin is activated is not a decision
			// anyone made.
			'token_endpoint_enabled' => ! empty( $stored['token_endpoint_enabled'] ),
		);
	}

	/**
	 * `digitalspital.com` → `https://api.digitalspital.com`.
	 *
	 * Always https, because the only http these hosts speak is a redirect to
	 * https — and a plain-http API base in a page's markup is a bearer token
	 * one downgrade away from a network.
	 *
	 * @param string $base_domain Bare domain, already sanitised.
	 */
	public static function derive_api_base( string $base_domain ): string {
		if ( '' === $base_domain ) {
			return '';
		}
		return 'https://' . self::API_LABEL . '.' . $base_domain;
	}

	/**
	 * Where the bundle is, in the order the answers are trustworthy.
	 *
	 * 1. **What the operator typed.** Always wins; a derivation that cannot be
	 *    overridden is one you eventually delete.
	 * 2. **From `base_domain`,** the same rule `domains.sh` uses, so the two
	 *    cannot disagree by being typed twice.
	 * 3. **From `api_base`, only when it is the conventional `api.` sibling.**
	 *
	 * The third exists because `api_base` is settable on its own — a customer
	 * pointing at a staging API is expected to use it — and requiring a second
	 * URL from them for a host we can name would be a field nobody should have
	 * to fill in. It is deliberately narrow: the leading label must be exactly
	 * `api`, or this answers nothing and the renderer says so. Guessing harder
	 * would produce a URL that 404s far from the field that caused it, which is
	 * the failure this whole change is about.
	 *
	 * @param string $explicit    The stored `widget_url`, possibly empty.
	 * @param string $base_domain The stored bare domain, possibly empty.
	 * @param string $api_base    The stored API base, possibly empty.
	 */
	private static function resolve_widget_url(
		string $explicit,
		string $base_domain,
		string $api_base
	): string {
		if ( '' !== $explicit ) {
			return $explicit;
		}
		if ( '' !== $base_domain ) {
			return self::derive_widget_url( $base_domain );
		}
		return self::widget_url_beside( $api_base );
	}

	/**
	 * `https://api.medice.example` → `https://widget.medice.example/ds-lms.js`.
	 *
	 * Anything whose first label is not `api` answers empty rather than
	 * guessing — see `resolve_widget_url`.
	 *
	 * @param string $api_base A full URL, or empty.
	 */
	private static function widget_url_beside( string $api_base ): string {
		if ( '' === $api_base ) {
			return '';
		}
		$host = wp_parse_url( $api_base, PHP_URL_HOST );
		if ( ! is_string( $host ) || '' === $host ) {
			return '';
		}
		$prefix = self::API_LABEL . '.';
		if ( 0 !== strpos( $host, $prefix ) ) {
			return '';
		}
		return 'https://' . self::WIDGET_LABEL . '.' . substr( $host, strlen( $prefix ) ) . '/ds-lms.js';
	}

	/**
	 * `digitalspital.com` → `https://widget.digitalspital.com/ds-lms.js`.
	 *
	 * The filename is part of the derivation because it is part of the
	 * deployment: `domains.sh` sets `WIDGET_URL` to exactly this, and a
	 * customer who overrides the field is giving a whole URL rather than a
	 * host, which is the honest shape for "where is the file".
	 *
	 * @param string $base_domain Bare domain, already sanitised.
	 */
	public static function derive_widget_url( string $base_domain ): string {
		if ( '' === $base_domain ) {
			return '';
		}
		return 'https://' . self::WIDGET_LABEL . '.' . $base_domain . '/ds-lms.js';
	}

	/**
	 * A bare domain: no scheme, no port, no path, no trailing dot.
	 *
	 * Pasting `https://digitalspital.com` into this field is the mistake
	 * everybody makes, and left alone it would derive
	 * `https://api.https://digitalspital.com` — a URL that fails in the browser,
	 * far from the field that caused it. So a scheme is stripped rather than
	 * refused, and anything still not domain-shaped becomes empty, which the
	 * settings page reports.
	 *
	 * @param mixed $value Raw submitted value.
	 */
	public static function sanitize_domain( $value ): string {
		$domain = strtolower( trim( (string) $value ) );

		// Strip what a paste brings with it: scheme, any path, a trailing dot.
		$domain = (string) preg_replace( '#^[a-z][a-z0-9+.-]*://#', '', $domain );
		$domain = (string) preg_replace( '#[/?\#].*$#', '', $domain );
		$domain = rtrim( $domain, '.' );

		// A port is not part of a name we can prefix a label onto.
		if ( ! preg_match( '/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/', $domain ) ) {
			return '';
		}

		return $domain;
	}

	public static function register(): void {
		register_setting(
			'ds_lms',
			self::OPTION,
			array(
				'type'              => 'array',
				'sanitize_callback' => array( self::class, 'sanitize' ),
				'default'           => array(),
			)
		);
	}

	/**
	 * @param mixed $input Raw submitted value.
	 * @return array<string,mixed>
	 */
	public static function sanitize( $input ): array {
		if ( ! is_array( $input ) ) {
			return array();
		}

		// `esc_url_raw` on the API base: it ends up in an HTML attribute the
		// browser will fetch from, and an unvalidated one would let an editor
		// point the widget at any host.
		$api_base   = isset( $input['api_base'] ) ? esc_url_raw( trim( (string) $input['api_base'] ) ) : '';
		$widget_url = isset( $input['widget_url'] ) ? esc_url_raw( trim( (string) $input['widget_url'] ) ) : '';

		return array(
			'base_domain'            => self::sanitize_domain( $input['base_domain'] ?? '' ),
			'api_base'               => $api_base,
			'widget_url'             => $widget_url,
			'project_slug'           => self::sanitize_slug( $input['project_slug'] ?? '' ),
			// Validated, not stripped.
			//
			// Stripping `LOGIN']['x` down to `LOGINx` would store a key that
			// looks configured and reads nothing — the worst of the three
			// outcomes, because the screen would then show a setting that is
			// quietly wrong. An unusable value is refused instead, which leaves
			// the field empty and the documented default in force.
			'session_key'            => self::sanitize_session_key( $input['session_key'] ?? '' ),
			'sign_in_url'            => esc_url_raw( trim( (string) ( $input['sign_in_url'] ?? '' ) ) ),
			'token_endpoint_enabled' => ! empty( $input['token_endpoint_enabled'] ),
		);
	}

	/**
	 * Slugs are `[a-z0-9-]` and nothing else.
	 *
	 * Not merely tidiness: these values are printed into HTML attributes, and
	 * constraining the character set at the boundary means the escaping later
	 * is defence in depth rather than the only defence.
	 *
	 * @param mixed $value Raw value.
	 */
	private static function sanitize_slug( $value ): string {
		return (string) preg_replace( '/[^a-z0-9-]/', '', strtolower( trim( (string) $value ) ) );
	}

	/**
	 * A PHP array key, or nothing.
	 *
	 * @param mixed $value Raw value.
	 */
	private static function sanitize_session_key( $value ): string {
		$key = trim( (string) $value );
		return 1 === preg_match( '/^[A-Za-z0-9_]+$/', $key ) ? $key : '';
	}

	/**
	 * Where this site signs somebody in, returning them here afterwards.
	 *
	 * Default is MEDICE's own trigger, read out of their theme:
	 * `header-menu.php` opens the login modal when `showLoginPopup` is present,
	 * and `onlyMediceLogin=1` narrows it to the Keycloak login — which is the
	 * one that matters, because DocCheck yields no token and therefore no CME
	 * point. `redirect_hscp_url` is the theme's own return parameter.
	 *
	 * A setting, because all three of those names belong to a theme rather than
	 * to this plugin, and a site that renames them should change a field rather
	 * than wait for a release. `%s` in a stored value is replaced by the
	 * current page.
	 */
	public static function sign_in_url(): string {
		$stored = self::all()['sign_in_url'];
		$here   = self::current_url();

		if ( '' !== $stored ) {
			return str_contains( $stored, '%s' )
				? str_replace( '%s', rawurlencode( $here ), $stored )
				: $stored;
		}

		return add_query_arg(
			array(
				'showLoginPopup'    => 'required',
				'onlyMediceLogin'   => '1',
				'redirect_hscp_url' => $here,
			),
			$here
		);
	}

	/**
	 * This request's own address, for returning to after signing in.
	 *
	 * Built from `home_url()` plus the path, **never** from the `Host` header.
	 * A sign-in link is somewhere we send a person; a caller-supplied host in
	 * it is an open redirect wearing our name.
	 */
	private static function current_url(): string {
		$path = isset( $_SERVER['REQUEST_URI'] )
			? (string) wp_unslash( $_SERVER['REQUEST_URI'] )
			: '/';
		return home_url( strtok( $path, '?' ) );
	}

	public static function add_page(): void {
		add_options_page(
			__( 'DS Education', 'ds-lms' ),
			__( 'DS Education', 'ds-lms' ),
			'manage_options',
			'ds-lms',
			array( self::class, 'render_page' )
		);
	}

	public static function render_page(): void {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}

		$settings = self::all();

		// The *stored* override, not the derived result: showing the derived
		// value in an override field would make the next save pin it, and the
		// derivation would silently stop applying.
		$stored        = get_option( self::OPTION, array() );
		$stored_api_base = is_array( $stored ) && isset( $stored['api_base'] )
			? (string) $stored['api_base']
			: '';
		$stored_widget_url = is_array( $stored ) && isset( $stored['widget_url'] )
			? (string) $stored['widget_url']
			: '';
		?>
		<div class="wrap">
			<h1><?php esc_html_e( 'DS Education — CME-Modul', 'ds-lms' ); ?></h1>
			<form action="options.php" method="post">
				<?php settings_fields( 'ds_lms' ); ?>
			<table class="form-table" role="presentation">
					<tr>
						<th scope="row">
							<label for="ds-lms-base-domain"><?php esc_html_e( 'Basis-Domain', 'ds-lms' ); ?></label>
						</th>
						<td>
							<input
								id="ds-lms-base-domain"
								name="<?php echo esc_attr( self::OPTION ); ?>[base_domain]"
								type="text"
								class="regular-text"
								value="<?php echo esc_attr( $settings['base_domain'] ); ?>"
								placeholder="digitalspital.com"
							/>
							<p class="description">
								<?php
								esc_html_e(
									'Nur die Domain, ohne https:// und ohne Pfad. Die API-Adresse wird daraus abgeleitet.',
									'ds-lms'
								);
								?>
							</p>
							<?php if ( '' !== $settings['api_base'] ) : ?>
								<p class="description">
									<strong><?php esc_html_e( 'Verwendete API-Adresse:', 'ds-lms' ); ?></strong>
									<code><?php echo esc_html( $settings['api_base'] ); ?></code>
								</p>
							<?php endif; ?>
							<?php if ( '' !== $settings['widget_url'] ) : ?>
								<p class="description">
									<strong><?php esc_html_e( 'Verwendetes Widget-JavaScript:', 'ds-lms' ); ?></strong>
									<code><?php echo esc_html( $settings['widget_url'] ); ?></code>
								</p>
							<?php endif; ?>
						</td>
					</tr>
					<tr>
						<th scope="row">
							<label for="ds-lms-api-base"><?php esc_html_e( 'API-Basis-URL (optional)', 'ds-lms' ); ?></label>
						</th>
						<td>
							<input
								id="ds-lms-api-base"
								name="<?php echo esc_attr( self::OPTION ); ?>[api_base]"
								type="url"
								class="regular-text"
								value="<?php echo esc_attr( $stored_api_base ); ?>"
							/>
							<p class="description">
								<?php
								esc_html_e(
									'Nur ausfüllen, wenn die API nicht unter api.<Basis-Domain> erreichbar ist — etwa auf einem Testsystem. Leer lassen heißt: abgeleitet.',
									'ds-lms'
								);
								?>
							</p>
						</td>
					</tr>
					<tr>
						<th scope="row">
							<label for="ds-lms-widget-url"><?php esc_html_e( 'Widget-JavaScript-URL (optional)', 'ds-lms' ); ?></label>
						</th>
						<td>
							<input
								id="ds-lms-widget-url"
								name="<?php echo esc_attr( self::OPTION ); ?>[widget_url]"
								type="url"
								class="regular-text"
								value="<?php echo esc_attr( $stored_widget_url ); ?>"
							/>
							<p class="description">
								<?php
								esc_html_e(
									'Das Widget-JavaScript wird von der Plattform geladen, nicht aus diesem Plugin — Aktualisierungen erreichen die Seite damit ohne Plugin-Update. Nur ausfüllen, wenn eine andere Adresse gilt. Leer lassen heißt: abgeleitet aus der Basis-Domain.',
									'ds-lms'
								);
								?>
							</p>
						</td>
					</tr>
					<tr>
						<th scope="row">
							<label for="ds-lms-project"><?php esc_html_e( 'Projekt-Slug', 'ds-lms' ); ?></label>
						</th>
						<td>
							<input
								id="ds-lms-project"
								name="<?php echo esc_attr( self::OPTION ); ?>[project_slug]"
								type="text"
								class="regular-text"
								value="<?php echo esc_attr( $settings['project_slug'] ); ?>"
							/>
							<p class="description">
								<?php esc_html_e( 'Wird als X-DS-Project gesendet und bestimmt Mandant und Keycloak-Realm.', 'ds-lms' ); ?>
							</p>
						</td>
					</tr>
					<tr>
						<th scope="row">
							<label for="ds-lms-session-key"><?php esc_html_e( 'Session-Schlüssel des Logins', 'ds-lms' ); ?></label>
						</th>
						<td>
							<input
								id="ds-lms-session-key"
								name="<?php echo esc_attr( self::OPTION ); ?>[session_key]"
								type="text"
								class="regular-text"
								value="<?php echo esc_attr( $settings['session_key'] ); ?>"
								placeholder="<?php echo esc_attr( self::DEFAULT_SESSION_KEY ); ?>"
							/>
							<p class="description">
								<?php
								esc_html_e(
									'Der Schlüssel in $_SESSION, unter dem die Anmeldung dieser Seite die Keycloak-Antwort ablegt. Das Lernmodul liest daraus nur „access_token". Bei MEDICE ist das LOGIN_SESSION.',
									'ds-lms'
								);
								?>
							</p>
						</td>
					</tr>
					<tr>
						<th scope="row"><?php esc_html_e( 'Token-Endpunkt', 'ds-lms' ); ?></th>
						<td>
							<label>
								<input
									name="<?php echo esc_attr( self::OPTION ); ?>[token_endpoint_enabled]"
									type="checkbox"
									value="1"
									<?php checked( $settings['token_endpoint_enabled'] ); ?>
								/>
								<?php esc_html_e( 'Token-Endpunkt aktivieren', 'ds-lms' ); ?>
							</label>
							<p class="description">
								<?php esc_html_e( 'Gibt angemeldeten Nutzenden ihr eigenes Keycloak-Token für das Lernmodul. Kann jederzeit ohne Deployment abgeschaltet werden.', 'ds-lms' ); ?>
							</p>
						</td>
					</tr>
				</table>
				<?php submit_button(); ?>
			</form>

			<?php self::render_diagnostics(); ?>

			<p class="description">
				<?php
				printf(
					/* translators: %s: the plugin's version number. */
					esc_html__( 'DS Education — CME-Modul, Version %s.', 'ds-lms' ),
					esc_html( DS_LMS_VERSION )
				);
				echo ' ';
				esc_html_e(
					'Das Lernmodul selbst wird von der Plattform geladen und dort aktualisiert — dafür ist kein Plugin-Update nötig.',
					'ds-lms'
				);
				?>
			</p>
		</div>
		<?php
	}

	/**
	 * "Is the platform this site points at actually there?" (P96-04)
	 *
	 * Only on request, because it makes two outbound HTTP calls and a settings
	 * screen that does that on every load is a settings screen nobody opens
	 * while a platform is down.
	 *
	 * The nonce is the whole authorisation story alongside `manage_options`
	 * above: without it, a link an administrator follows becomes two requests
	 * this server makes on somebody else's behalf. It cannot be pointed
	 * anywhere — `DS_LMS_Diagnostics` reads the stored settings and never the
	 * request — but a check that costs nothing to trigger is still a check
	 * worth binding to an intent.
	 */
	private static function render_diagnostics(): void {
		$requested = isset( $_GET[ DS_LMS_Diagnostics::ACTION ] )
			&& check_admin_referer( DS_LMS_Diagnostics::ACTION );

		$url = wp_nonce_url(
			add_query_arg(
				array( 'page' => 'ds-lms', DS_LMS_Diagnostics::ACTION => '1' ),
				admin_url( 'options-general.php' )
			),
			DS_LMS_Diagnostics::ACTION
		);
		?>
		<h2><?php esc_html_e( 'Verbindung prüfen', 'ds-lms' ); ?></h2>
		<p class="description">
			<?php
			esc_html_e(
				'Prüft von diesem Server aus, ob die oben hinterlegten Adressen antworten. Speichern Sie Änderungen zuerst — geprüft wird der gespeicherte Stand.',
				'ds-lms'
			);
			?>
		</p>
		<p>
			<a class="button" href="<?php echo esc_url( $url ); ?>">
				<?php esc_html_e( 'Jetzt prüfen', 'ds-lms' ); ?>
			</a>
		</p>
		<?php
		if ( ! $requested ) {
			return;
		}

		foreach ( DS_LMS_Diagnostics::run() as $result ) {
			printf(
				'<div class="notice notice-%1$s inline"><p><strong>%2$s:</strong> %3$s</p></div>',
				$result['ok'] ? 'success' : 'error',
				esc_html( $result['label'] ),
				esc_html( $result['detail'] )
			);
		}
	}
}
