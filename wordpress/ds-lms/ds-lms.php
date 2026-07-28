<?php
/**
 * Plugin Name:       DS Education — CME-Modul
 * Description:       Bindet das DigitalSpital CME-Lernmodul als <ds-lms> in Seiten und Beiträge ein.
 * Version:           0.1.0
 * Requires at least: 6.4
 * Requires PHP:      8.1
 * Author:            DigitalSpital
 * License:           proprietary
 * Text Domain:       ds-lms
 *
 * P6-01. Deliberately thin: this plugin places a custom element on a page and
 * loads its bundle. It renders no course content, holds no learner state and
 * makes no decision about anything — all of that is the API's, validated
 * server-side against Keycloak (ADR-0003).
 *
 * Keeping it thin is also what keeps the review conversation with the MEDICE
 * team small, which matters because the companion change (P6-02) touches the
 * login path of a production site.
 *
 * ## What is never in the rendered HTML
 *
 * No token, no secret, no credential. The page carries a project slug, an API
 * base URL and a course slug — all public by construction — plus a WordPress
 * REST nonce, which is not a credential on its own and is worthless without
 * the visitor's own session cookie.
 */

declare( strict_types = 1 );

if ( ! defined( 'ABSPATH' ) ) {
	// Direct file access. Nothing here should run outside WordPress.
	exit;
}

define( 'DS_LMS_VERSION', '0.1.0' );
define( 'DS_LMS_FILE', __FILE__ );
define( 'DS_LMS_DIR', plugin_dir_path( __FILE__ ) );
define( 'DS_LMS_URL', plugin_dir_url( __FILE__ ) );

require_once DS_LMS_DIR . 'includes/class-ds-lms-settings.php';
require_once DS_LMS_DIR . 'includes/class-ds-lms-token-source.php';
require_once DS_LMS_DIR . 'includes/class-ds-lms-token-endpoint.php';
require_once DS_LMS_DIR . 'includes/class-ds-lms-renderer.php';

add_action(
	'plugins_loaded',
	static function (): void {
		DS_LMS_Settings::boot();
		DS_LMS_Renderer::boot();
		DS_LMS_Token_Endpoint::boot();
	}
);

/**
 * Deactivation leaves the site exactly as it was.
 *
 * Nothing is dropped and nothing is rewritten: the settings row stays so a
 * reactivation does not lose the configuration, and no post content is touched
 * — a shortcode in a page simply stops rendering, which is the correct
 * behaviour for a plugin that is off.
 */
register_deactivation_hook(
	__FILE__,
	static function (): void {
		// Intentionally empty. See the docblock above.
	}
);
