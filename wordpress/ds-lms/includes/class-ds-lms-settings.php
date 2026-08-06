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
	 * The stored settings, with defaults filled in and `api_base` derived.
	 *
	 * @return array{base_domain:string,api_base:string,project_slug:string,course_slug:string,token_endpoint_enabled:bool}
	 */
	public static function all(): array {
		$stored = get_option( self::OPTION, array() );
		if ( ! is_array( $stored ) ) {
			$stored = array();
		}

		$base_domain = isset( $stored['base_domain'] ) ? (string) $stored['base_domain'] : '';
		$api_base    = isset( $stored['api_base'] ) ? (string) $stored['api_base'] : '';

		return array(
			'base_domain'  => $base_domain,
			// Explicit wins; otherwise derived. Both may be empty, and the
			// renderer treats that as "not configured yet" and says so to an
			// editor rather than emitting a broken element to a visitor.
			'api_base'     => '' !== $api_base ? $api_base : self::derive_api_base( $base_domain ),
			'project_slug' => isset( $stored['project_slug'] ) ? (string) $stored['project_slug'] : '',
			'course_slug'  => isset( $stored['course_slug'] ) ? (string) $stored['course_slug'] : '',
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
		$api_base = isset( $input['api_base'] ) ? esc_url_raw( trim( (string) $input['api_base'] ) ) : '';

		return array(
			'base_domain'            => self::sanitize_domain( $input['base_domain'] ?? '' ),
			'api_base'               => $api_base,
			'project_slug'           => self::sanitize_slug( $input['project_slug'] ?? '' ),
			'course_slug'            => self::sanitize_slug( $input['course_slug'] ?? '' ),
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
							<label for="ds-lms-course"><?php esc_html_e( 'Standard-Fortbildung', 'ds-lms' ); ?></label>
						</th>
						<td>
							<input
								id="ds-lms-course"
								name="<?php echo esc_attr( self::OPTION ); ?>[course_slug]"
								type="text"
								class="regular-text"
								value="<?php echo esc_attr( $settings['course_slug'] ); ?>"
							/>
							<p class="description">
								<?php esc_html_e( 'Kann je Block oder Shortcode überschrieben werden.', 'ds-lms' ); ?>
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
		</div>
		<?php
	}
}
