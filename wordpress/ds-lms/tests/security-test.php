<?php
/**
 * The plugin's security properties, executed.
 *
 * Every acceptance criterion in P6-01 and P6-02 that can be checked without a
 * real WordPress is checked here. Run with:
 *
 *     php wordpress/ds-lms/tests/security-test.php
 *
 * Plain PHP with no test framework, on purpose: adding PHPUnit and a composer
 * install to a five-hour plugin would cost more than the tests do, and this
 * file runs anywhere PHP does — including in the MEDICE team's own checkout
 * when they review the diff.
 *
 * @package ds-lms
 */

declare( strict_types = 1 );

require_once __DIR__ . '/harness.php';

$plugin = dirname( __DIR__ );
define( 'DS_LMS_VERSION', '0.1.0' );
define( 'DS_LMS_DIR', $plugin . '/' );
define( 'DS_LMS_URL', 'https://medice.example/wp-content/plugins/ds-lms/' );

require_once $plugin . '/includes/class-ds-lms-settings.php';
require_once $plugin . '/includes/class-ds-lms-token-source.php';
require_once $plugin . '/includes/class-ds-lms-token-endpoint.php';
require_once $plugin . '/includes/class-ds-lms-renderer.php';

// --- tiny assertion helpers ------------------------------------------------

$failures = 0;
$checks   = 0;

function check( string $description, bool $condition ): void {
	global $failures, $checks;
	++$checks;
	if ( $condition ) {
		echo "  ok   $description\n";
		return;
	}
	++$failures;
	echo "  FAIL $description\n";
}

function configure( array $overrides = array() ): void {
	update_option(
		DS_LMS_Settings::OPTION,
		array_merge(
			array(
				'api_base'               => 'https://api.ds-education.de',
				'project_slug'           => 'medice-adhs',
				'course_slug'            => 'adhs-akademie-adult',
				'token_endpoint_enabled' => true,
			),
			$overrides
		)
	);
}

function sign_in( int $user_id, string $token = null ): void {
	$GLOBALS['ds_test']['logged_in'] = true;
	$GLOBALS['ds_test']['user_id']   = $user_id;
	if ( null !== $token ) {
		$GLOBALS['ds_test']['user_meta'][ $user_id ]['keycloak_access_token'] = $token;
	}
}

const SECRET_TOKEN = 'eyJhbGciOiJSUzI1NiJ9.this-is-the-users-token.sig';

// ---------------------------------------------------------------------------
echo "\nThe token endpoint is off unless somebody turns it on\n";
// ---------------------------------------------------------------------------

ds_test_reset();
configure( array( 'token_endpoint_enabled' => false ) );
DS_LMS_Token_Endpoint::register();
check(
	'the route is not registered at all when the flag is off',
	array() === $GLOBALS['ds_test']['routes']
);

ds_test_reset();
update_option( DS_LMS_Settings::OPTION, array() );
check(
	'a fresh install defaults the flag to off',
	false === DS_LMS_Settings::all()['token_endpoint_enabled']
);

ds_test_reset();
configure();
DS_LMS_Token_Endpoint::register();
check(
	'the route exists once the flag is on',
	isset( $GLOBALS['ds_test']['routes']['ds-lms/v1/token'] )
);
check(
	'and it accepts no arguments — there is no user parameter to abuse',
	array() === $GLOBALS['ds_test']['routes']['ds-lms/v1/token']['args']
);
check(
	'and it is GET only',
	'GET' === $GLOBALS['ds_test']['routes']['ds-lms/v1/token']['methods']
);

// ---------------------------------------------------------------------------
echo "\nWho may call it\n";
// ---------------------------------------------------------------------------

ds_test_reset();
configure();
$_SERVER['HTTP_X_WP_NONCE'] = 'good-nonce';
check(
	'a logged-out request is refused even with a valid nonce',
	false === DS_LMS_Token_Endpoint::permitted()
);

ds_test_reset();
configure();
sign_in( 7, SECRET_TOKEN );
check(
	'a logged-in request with no nonce is refused',
	false === DS_LMS_Token_Endpoint::permitted()
);

ds_test_reset();
configure();
sign_in( 7, SECRET_TOKEN );
$_SERVER['HTTP_X_WP_NONCE'] = 'forged';
check(
	'a logged-in request with a forged nonce is refused',
	false === DS_LMS_Token_Endpoint::permitted()
);

ds_test_reset();
configure();
sign_in( 7, SECRET_TOKEN );
$_SERVER['HTTP_X_WP_NONCE'] = 'good-nonce';
check(
	'a logged-in request with the right nonce is allowed',
	true === DS_LMS_Token_Endpoint::permitted()
);

// ---------------------------------------------------------------------------
echo "\nWhat it returns\n";
// ---------------------------------------------------------------------------

ds_test_reset();
configure();
sign_in( 7, SECRET_TOKEN );
$response = DS_LMS_Token_Endpoint::handle( new WP_REST_Request() );
check( 'the caller gets their own token', SECRET_TOKEN === $response->data['token'] );
check( 'with a 200', 200 === $response->status );
check(
	'and no-store, so no cache holds a copy',
	str_contains( $response->headers['Cache-Control'] ?? '', 'no-store' )
);

ds_test_reset();
configure();
sign_in( 7 ); // signed in, but the Keycloak plugin holds nothing
$response = DS_LMS_Token_Endpoint::handle( new WP_REST_Request() );
check( 'no token yields null, not somebody else\'s', null === $response->data['token'] );
check( 'with a 404', 404 === $response->status );

// The endpoint must not be talked into another user's token. There is no
// parameter for it, so this asserts that adding one changes nothing.
ds_test_reset();
configure();
$GLOBALS['ds_test']['user_meta'][8]['keycloak_access_token'] = 'someone-elses-token';
sign_in( 7, SECRET_TOKEN );
$response = DS_LMS_Token_Endpoint::handle(
	new WP_REST_Request( array( 'user' => 8, 'user_id' => 8, 'sub' => 8 ) )
);
check(
	'a user parameter is ignored — the caller still gets only their own token',
	SECRET_TOKEN === $response->data['token']
);

// The additive integration seam MEDICE will use.
ds_test_reset();
configure();
sign_in( 7 );
add_filter( 'ds_lms_access_token', static fn() => 'from-medice-plugin' );
check(
	'the ds_lms_access_token filter supplies the token when MEDICE wires it up',
	'from-medice-plugin' === DS_LMS_Token_Source::current()
);

ds_test_reset();
add_filter( 'ds_lms_access_token', static fn() => 'from-medice-plugin' );
check(
	'and even that filter yields nothing when nobody is logged in',
	null === DS_LMS_Token_Source::current()
);

// ---------------------------------------------------------------------------
echo "\nWhat reaches the page\n";
// ---------------------------------------------------------------------------

ds_test_reset();
configure();
sign_in( 7, SECRET_TOKEN );
$html   = DS_LMS_Renderer::shortcode( array() );
$inline = implode( "\n", $GLOBALS['ds_test']['inline'] );

check( 'the shortcode renders the element', str_contains( $html, '<ds-lms ' ) );
check(
	'with the configured project and course',
	str_contains( $html, 'project="medice-adhs"' )
		&& str_contains( $html, 'course="adhs-akademie-adult"' )
);
check( 'no token in the rendered HTML', ! str_contains( $html, SECRET_TOKEN ) );
check( 'no token in the inline script either', ! str_contains( $inline, SECRET_TOKEN ) );
check(
	'the inline script installs a token provider',
	str_contains( $inline, 'tokenProvider' )
);
check(
	'and sends the REST nonce, which is what binds the call to this session',
	str_contains( $inline, 'X-WP-Nonce' )
);
check( 'the bundle is enqueued for this page', in_array( 'ds-lms-widget', $GLOBALS['ds_test']['enqueued'], true ) );

ds_test_reset();
configure();
// Not logged in: nothing to provide, so no provider is installed.
$html = DS_LMS_Renderer::shortcode( array() );
check(
	'a logged-out visitor gets the element but no token provider',
	str_contains( $html, '<ds-lms ' ) && array() === $GLOBALS['ds_test']['inline']
);

ds_test_reset();
configure();
check(
	'the bundle is not enqueued on a page that uses neither block nor shortcode',
	array() === $GLOBALS['ds_test']['enqueued']
);

// The block and the shortcode must not drift apart.
ds_test_reset();
configure();
sign_in( 7, SECRET_TOKEN );
$from_shortcode = DS_LMS_Renderer::shortcode( array( 'course' => 'kurs-zwei' ) );
ds_test_reset();
configure();
sign_in( 7, SECRET_TOKEN );
$from_block = DS_LMS_Renderer::block( array( 'courseSlug' => 'kurs-zwei' ) );
check( 'block and shortcode render identical markup', $from_shortcode === $from_block );

// ---------------------------------------------------------------------------
echo "\nUntrusted input reaching an HTML attribute\n";
// ---------------------------------------------------------------------------

ds_test_reset();
configure();
sign_in( 7, SECRET_TOKEN );
$html = DS_LMS_Renderer::shortcode( array( 'course' => '" onload="alert(1)' ) );
// The slug filter reduces this to `onloadalert1`, which is inert — asserting
// the absence of the substring "onload" would be asserting the wrong thing.
// What matters is that no quote survived to end the attribute and no second
// attribute was created.
check(
	'a shortcode attribute cannot break out of the attribute',
	1 === preg_match(
		'/^<ds-lms api-base="[^"]*" project="[^"]*" course="[a-z0-9-]*"><\/ds-lms>$/',
		$html
	)
);
check(
	'and no event-handler attribute appears in the markup',
	0 === preg_match( '/\son[a-z]+\s*=/i', $html )
);

$settings = DS_LMS_Settings::sanitize(
	array(
		'api_base'     => 'javascript:alert(1)',
		'project_slug' => 'Böse<script>',
		'course_slug'  => '../../etc/passwd',
	)
);
check( 'a javascript: API base is rejected', '' === $settings['api_base'] );
check( 'a project slug is reduced to [a-z0-9-]', 'bsescript' === $settings['project_slug'] );
check( 'and so is a course slug', 'etcpasswd' === $settings['course_slug'] );

// ---------------------------------------------------------------------------
echo "\nWhen the plugin is not configured\n";
// ---------------------------------------------------------------------------

ds_test_reset();
update_option( DS_LMS_Settings::OPTION, array() );
check(
	'a visitor sees nothing rather than a broken widget',
	'' === DS_LMS_Renderer::shortcode( array() )
);

ds_test_reset();
update_option( DS_LMS_Settings::OPTION, array() );
$GLOBALS['ds_test']['capabilities'] = array( 'edit_posts' );
check(
	'an editor is told what is missing',
	str_contains( DS_LMS_Renderer::shortcode( array() ), 'Einstellungen' )
);

// ---------------------------------------------------------------------------

echo "\n$checks checks, $failures failed\n";
exit( $failures === 0 ? 0 : 1 );
