<?php
/**
 * Plugin configuration (P6-01).
 *
 * API base URL, project slug and the default course slug come from WordPress
 * settings rather than from code, because the same plugin has to run against a
 * staging API and a production one without a rebuild.
 *
 * None of these is a secret. The project slug identifies which host surface is
 * calling (ADR-0007); presenting it grants nothing on its own, and the API
 * still validates every bearer token against the realm that slug resolves to.
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
	 * The stored settings, with defaults filled in.
	 *
	 * @return array{api_base:string,project_slug:string,course_slug:string,token_endpoint_enabled:bool}
	 */
	public static function all(): array {
		$stored = get_option( self::OPTION, array() );
		if ( ! is_array( $stored ) ) {
			$stored = array();
		}

		return array(
			'api_base'     => isset( $stored['api_base'] ) ? (string) $stored['api_base'] : '',
			'project_slug' => isset( $stored['project_slug'] ) ? (string) $stored['project_slug'] : '',
			'course_slug'  => isset( $stored['course_slug'] ) ? (string) $stored['course_slug'] : '',
			// The kill switch for P6-02. Default **off**: a token endpoint that
			// appears the moment the plugin is activated is not a decision
			// anyone made.
			'token_endpoint_enabled' => ! empty( $stored['token_endpoint_enabled'] ),
		);
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
		?>
		<div class="wrap">
			<h1><?php esc_html_e( 'DS Education — CME-Modul', 'ds-lms' ); ?></h1>
			<form action="options.php" method="post">
				<?php settings_fields( 'ds_lms' ); ?>
				<table class="form-table" role="presentation">
					<tr>
						<th scope="row">
							<label for="ds-lms-api-base"><?php esc_html_e( 'API-Basis-URL', 'ds-lms' ); ?></label>
						</th>
						<td>
							<input
								id="ds-lms-api-base"
								name="<?php echo esc_attr( self::OPTION ); ?>[api_base]"
								type="url"
								class="regular-text"
								value="<?php echo esc_attr( $settings['api_base'] ); ?>"
							/>
							<p class="description">
								<?php esc_html_e( 'z. B. https://api.ds-education.de', 'ds-lms' ); ?>
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
