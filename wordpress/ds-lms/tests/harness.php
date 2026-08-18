<?php
/**
 * A minimal WordPress stand-in, so the plugin's security logic can be executed
 * rather than only read.
 *
 * This is not an attempt to reimplement WordPress. It defines exactly the
 * functions the plugin calls, with the semantics the plugin relies on, so that
 * the refusals — logged out, bad nonce, feature flag off — can be *run*. The
 * alternative is a plugin whose security properties are asserted only in a
 * code review, on a file that touches the login path of a production site.
 *
 * @package ds-lms
 */

declare( strict_types = 1 );

define( 'ABSPATH', __DIR__ . '/' );

// --- Test-controlled state -------------------------------------------------

$GLOBALS['ds_test'] = array(
	'logged_in'    => false,
	'user_id'      => 0,
	'options'      => array(),
	'user_meta'    => array(),
	'valid_nonces' => array( 'wp_rest' => 'good-nonce' ),
	'routes'       => array(),
	'actions'      => array(),
	'filters'      => array(),
	'shortcodes'   => array(),
	'scripts'      => array(),
	'enqueued'     => array(),
	'inline'       => array(),
	'capabilities' => array(),
);

function ds_test_reset(): void {
	$GLOBALS['ds_test']['logged_in'] = false;
	$GLOBALS['ds_test']['user_id']   = 0;
	$GLOBALS['ds_test']['options']   = array();
	$GLOBALS['ds_test']['user_meta'] = array();
	$GLOBALS['ds_test']['routes']    = array();
	$GLOBALS['ds_test']['scripts']   = array();
	$GLOBALS['ds_test']['enqueued']  = array();
	$GLOBALS['ds_test']['inline']    = array();
	$GLOBALS['ds_test']['filters']   = array();
	unset( $_SERVER['HTTP_X_WP_NONCE'] );
}

// --- WordPress API surface the plugin uses ---------------------------------

function add_action( string $hook, $callback, int $priority = 10, int $args = 1 ): void {
	$GLOBALS['ds_test']['actions'][ $hook ][] = $callback;
}

function do_action( string $hook, ...$args ): void {
	foreach ( $GLOBALS['ds_test']['actions'][ $hook ] ?? array() as $callback ) {
		call_user_func_array( $callback, $args );
	}
}

function add_filter( string $hook, $callback, int $priority = 10, int $args = 1 ): void {
	$GLOBALS['ds_test']['filters'][ $hook ][] = $callback;
}

function apply_filters( string $hook, $value, ...$args ) {
	foreach ( $GLOBALS['ds_test']['filters'][ $hook ] ?? array() as $callback ) {
		$value = call_user_func_array( $callback, array_merge( array( $value ), $args ) );
	}
	return $value;
}

function is_user_logged_in(): bool {
	return (bool) $GLOBALS['ds_test']['logged_in'];
}

function get_current_user_id(): int {
	return (int) $GLOBALS['ds_test']['user_id'];
}

function get_user_meta( int $user_id, string $key, bool $single = false ) {
	return $GLOBALS['ds_test']['user_meta'][ $user_id ][ $key ] ?? '';
}

function get_option( string $name, $default = false ) {
	return $GLOBALS['ds_test']['options'][ $name ] ?? $default;
}

function update_option( string $name, $value ): void {
	$GLOBALS['ds_test']['options'][ $name ] = $value;
}

function register_setting( string $group, string $name, array $args = array() ): void {}
function add_options_page( ...$args ): void {}
function settings_fields( string $group ): void {}
function submit_button( ...$args ): void {}
function checked( $a, $b = true, bool $echo = true ) {}

function current_user_can( string $capability ): bool {
	return in_array( $capability, $GLOBALS['ds_test']['capabilities'], true );
}

function wp_verify_nonce( $nonce, string $action = '-1' ) {
	return ( $GLOBALS['ds_test']['valid_nonces'][ $action ] ?? null ) === $nonce ? 1 : false;
}

function wp_create_nonce( string $action = '-1' ): string {
	return $GLOBALS['ds_test']['valid_nonces'][ $action ] ?? 'nonce';
}

function sanitize_text_field( $value ): string {
	return trim( strip_tags( (string) $value ) );
}

function wp_unslash( $value ) {
	return is_string( $value ) ? stripslashes( $value ) : $value;
}

/**
 * WordPress's own wp_parse_url() is a thin wrapper over parse_url() with a
 * default component of -1. The plugin uses it because WordPress asks plugins
 * to, so the harness has to answer the same way.
 */
function wp_parse_url( string $url, int $component = -1 ) {
	return parse_url( $url, $component );
}

function esc_url_raw( string $url ): string {
	return filter_var( $url, FILTER_VALIDATE_URL ) === false ? '' : $url;
}

function esc_url( string $url ): string {
	return htmlspecialchars( esc_url_raw( $url ), ENT_QUOTES, 'UTF-8' );
}

function esc_attr( string $value ): string {
	return htmlspecialchars( $value, ENT_QUOTES, 'UTF-8' );
}

function esc_html( string $value ): string {
	return htmlspecialchars( $value, ENT_QUOTES, 'UTF-8' );
}

function esc_html__( string $text, string $domain = '' ): string {
	return $text;
}

function esc_html_e( string $text, string $domain = '' ): void {
	echo $text;
}

function __( string $text, string $domain = '' ): string {
	return $text;
}

function plugin_dir_path( string $file ): string {
	return dirname( $file ) . '/';
}

function plugin_dir_url( string $file ): string {
	return 'https://medice.example/wp-content/plugins/ds-lms/';
}

function rest_url( string $path = '' ): string {
	return 'https://medice.example/wp-json/' . ltrim( $path, '/' );
}

function register_rest_route( string $namespace, string $route, array $args ): void {
	$GLOBALS['ds_test']['routes'][ $namespace . $route ] = $args;
}

function register_deactivation_hook( string $file, $callback ): void {}

function add_shortcode( string $tag, $callback ): void {
	$GLOBALS['ds_test']['shortcodes'][ $tag ] = $callback;
}

function shortcode_atts( array $pairs, $atts, string $shortcode = '' ): array {
	$atts = (array) $atts;
	$out  = array();
	foreach ( $pairs as $name => $default ) {
		$out[ $name ] = array_key_exists( $name, $atts ) ? $atts[ $name ] : $default;
	}
	return $out;
}

function register_block_type( string $path, array $args = array() ): void {}

function wp_register_script( string $handle, string $src, array $deps, $version, $args = array() ): void {
	// The version is kept as well as the source: a plugin version appended as
	// `?ver=` is exactly what P96-01 removes, and a test cannot see it if the
	// harness throws it away.
	$GLOBALS['ds_test']['scripts'][ $handle ] = array(
		'src'     => $src,
		'version' => $version,
		'args'    => $args,
	);
}

function wp_enqueue_script( string $handle ): void {
	$GLOBALS['ds_test']['enqueued'][] = $handle;
}

function wp_add_inline_script( string $handle, string $data, string $position = 'after' ): void {
	$GLOBALS['ds_test']['inline'][] = $data;
}

function wp_json_encode( $value ) {
	return json_encode( $value, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE );
}

function wp_get_nocache_headers(): array {
	return array(
		'Expires'       => 'Wed, 11 Jan 1984 05:00:00 GMT',
		'Cache-Control' => 'no-cache, must-revalidate, max-age=0',
	);
}

class WP_REST_Request {
	/** @var array<string,mixed> */
	private array $params;

	/** @param array<string,mixed> $params */
	public function __construct( array $params = array() ) {
		$this->params = $params;
	}

	public function get_param( string $key ) {
		return $this->params[ $key ] ?? null;
	}
}

class WP_REST_Response {
	/** @var mixed */
	public $data;
	public int $status;
	/** @var array<string,string> */
	public array $headers = array();

	public function __construct( $data = null, int $status = 200 ) {
		$this->data   = $data;
		$this->status = $status;
	}

	public function header( string $name, string $value ): void {
		$this->headers[ $name ] = $value;
	}
}
