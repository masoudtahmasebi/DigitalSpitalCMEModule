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
		'/^<ds-lms api-base="[^"]*" project="[^"]*"(?: course="[a-z0-9-]+")?><\/ds-lms>$/',
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
echo "\nCatalogue mode\n";
// ---------------------------------------------------------------------------

ds_test_reset();
update_option(
	DS_LMS_Settings::OPTION,
	array(
		'api_base'               => 'https://api.example.test',
		'project_slug'           => 'medice-adhs',
		// No default course: this site lists several Fortbildungen.
		'course_slug'            => '',
		'token_endpoint_enabled' => true,
	)
);
sign_in( 7, SECRET_TOKEN );
$catalogue = DS_LMS_Renderer::shortcode( array() );

check(
	'a site with no default course still renders the element',
	str_contains( $catalogue, '<ds-lms' )
);
check(
	'and omits the course attribute rather than emitting an empty one',
	! str_contains( $catalogue, 'course=' )
);

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
echo "\nOne base domain, the API address derived from it (P16-03)\n";
// ---------------------------------------------------------------------------

check(
	'a bare domain derives the API address',
	'https://api.digitalspital.com' === DS_LMS_Settings::derive_api_base( 'digitalspital.com' )
);

// The mistake everybody makes. Left alone it would derive
// `https://api.https://digitalspital.com`, which fails in a browser far from
// the field that caused it.
foreach (
	array(
		'https://digitalspital.com'      => 'digitalspital.com',
		'http://digitalspital.com/'      => 'digitalspital.com',
		'  DigitalSpital.com  '          => 'digitalspital.com',
		'digitalspital.com.'             => 'digitalspital.com',
		'digitalspital.com/cme'          => 'digitalspital.com',
		'https://digitalspital.com/a?b=c' => 'digitalspital.com',
	) as $input => $expected
) {
	check(
		"a pasted '$input' becomes '$expected'",
		$expected === DS_LMS_Settings::sanitize_domain( $input )
	);
}

// Anything still not domain-shaped becomes empty, which the settings page
// reports and the renderer treats as "not configured".
foreach ( array( 'localhost', 'digitalspital.com:8443', 'not a domain', '', '<script>' ) as $bad ) {
	check(
		"'$bad' is not accepted as a base domain",
		'' === DS_LMS_Settings::sanitize_domain( $bad )
	);
}

ds_test_reset();
update_option(
	DS_LMS_Settings::OPTION,
	array( 'base_domain' => 'digitalspital.com', 'project_slug' => 'medice-adhs' )
);
$derived = DS_LMS_Settings::all();
check(
	'the derived address is what the element carries',
	'https://api.digitalspital.com' === $derived['api_base']
);
check(
	'and it reaches the rendered markup',
	str_contains(
		DS_LMS_Renderer::shortcode( array() ),
		'api-base="https://api.digitalspital.com"'
	)
);

// A derivation that cannot be overridden is one you eventually delete: a
// staging API on a hostname following no convention has to remain reachable.
ds_test_reset();
update_option(
	DS_LMS_Settings::OPTION,
	array(
		'base_domain'  => 'digitalspital.com',
		'api_base'     => 'https://staging-api.example.org',
		'project_slug' => 'medice-adhs',
	)
);
check(
	'an explicit API base still wins',
	'https://staging-api.example.org' === DS_LMS_Settings::all()['api_base']
);

// A base domain alone is not enough — the project slug still has to be set, and
// an editor is told rather than a visitor being shown a broken widget.
ds_test_reset();
update_option( DS_LMS_Settings::OPTION, array( 'base_domain' => 'digitalspital.com' ) );
$GLOBALS['ds_test']['capabilities'] = array( 'edit_posts' );
check(
	'a base domain without a project slug is still incomplete',
	str_contains( DS_LMS_Renderer::shortcode( array() ), 'Einstellungen' )
);

// The sanitiser is what the settings form runs, so the stored value is already
// domain-shaped and `derive_api_base` never sees a scheme.
check(
	'the form sanitises the domain before it is stored',
	'digitalspital.com' === DS_LMS_Settings::sanitize(
		array( 'base_domain' => 'https://digitalspital.com/' )
	)['base_domain']
);

// ---------------------------------------------------------------------------
echo "\nThe bundle comes from the platform, not from the plugin (P96-01)\n";
// ---------------------------------------------------------------------------

// The defect this replaces: `assets/ds-lms.js` is a gitignored build artefact,
// so every checkout of the plugin shipped without it and the browser 404'd
// while WordPress reported nothing. Loading it from the widget host also means
// a widget fix reaches every site on our deploy, with no plugin update.

check(
	'a base domain derives the widget bundle beside the API',
	'https://widget.digitalspital.com/ds-lms.js'
		=== DS_LMS_Settings::derive_widget_url( 'digitalspital.com' )
);

check(
	'no base domain derives nothing rather than guessing a host',
	'' === DS_LMS_Settings::derive_widget_url( '' )
);

// A site configured before P16-03 has an `api_base` and no `base_domain`. The
// widget host sits beside the API host, so it is derivable — but only when the
// API address follows the convention. Anything else answers empty and the
// editor is asked, rather than a plausible-looking 404 being emitted.
ds_test_reset();
update_option(
	DS_LMS_Settings::OPTION,
	array( 'api_base' => 'https://api.digitalspital.com', 'project_slug' => 'medice-adhs' )
);
check(
	'an api.* base alone still yields the widget URL',
	'https://widget.digitalspital.com/ds-lms.js' === DS_LMS_Settings::all()['widget_url']
);

ds_test_reset();
update_option(
	DS_LMS_Settings::OPTION,
	array( 'api_base' => 'https://staging-api.example.org', 'project_slug' => 'medice-adhs' )
);
check(
	'an API host following no convention derives no widget URL',
	'' === DS_LMS_Settings::all()['widget_url']
);

// And an editor is told which field to fill, naming the widget rather than the
// API base they have already filled in (§9.4).
$GLOBALS['ds_test']['capabilities'] = array( 'edit_posts' );
$message = DS_LMS_Renderer::shortcode( array() );
check(
	'an editor is told the widget address is missing',
	str_contains( $message, 'Widget' ) && str_contains( $message, 'Basis-Domain' )
);
check(
	'and it is not the API-base message repeated',
	! str_contains( $message, 'API-Basis-URL' )
);
$GLOBALS['ds_test']['capabilities'] = array();
check(
	'a visitor sees nothing rather than a widget that cannot load',
	'' === DS_LMS_Renderer::shortcode( array() )
);

// An explicit URL wins over both derivations: a customer serving the bundle
// from their own CDN, or a developer pointing at a local Vite server, has to
// remain able to say so.
ds_test_reset();
update_option(
	DS_LMS_Settings::OPTION,
	array(
		'base_domain'  => 'digitalspital.com',
		'widget_url'   => 'https://cdn.medice.example/ds-lms.js',
		'project_slug' => 'medice-adhs',
	)
);
check(
	'an explicit widget URL still wins',
	'https://cdn.medice.example/ds-lms.js' === DS_LMS_Settings::all()['widget_url']
);

// What actually reaches the page. `register()` is where the address is
// decided, so the assertion is on the registration rather than on the
// derivation it used — §9.7, name the caller.
ds_test_reset();
update_option(
	DS_LMS_Settings::OPTION,
	array( 'base_domain' => 'digitalspital.com', 'project_slug' => 'medice-adhs' )
);
DS_LMS_Renderer::register();
$script = $GLOBALS['ds_test']['scripts']['ds-lms-widget'] ?? null;
check(
	'the registered bundle is the platform widget host',
	is_array( $script ) && 'https://widget.digitalspital.com/ds-lms.js' === $script['src']
);
check(
	'and never a file inside the plugin',
	is_array( $script ) && ! str_contains( $script['src'], DS_LMS_URL )
);
// `?ver=0.1.0` would pin every visitor to the bundle current when the plugin
// was last released, which is precisely the coupling this removes. Freshness
// is the cache header's job — see infra/nginx/widget.conf.
check(
	'with no plugin version pinning the bundle',
	is_array( $script ) && null === $script['version']
);
check(
	'the shortcode still enqueues that handle',
	str_contains( DS_LMS_Renderer::shortcode( array() ), '<ds-lms' )
		&& in_array( 'ds-lms-widget', $GLOBALS['ds_test']['enqueued'], true )
);

// With no bundle address there is nothing to register, and the block and the
// shortcode must still exist — otherwise `[ds_lms]` renders as literal text on
// a live page instead of as the editor message above.
ds_test_reset();
update_option( DS_LMS_Settings::OPTION, array( 'api_base' => 'https://staging-api.example.org' ) );
DS_LMS_Renderer::register();
check(
	'no widget URL registers no script',
	! isset( $GLOBALS['ds_test']['scripts']['ds-lms-widget'] )
);
check(
	'but the shortcode is registered either way',
	isset( $GLOBALS['ds_test']['shortcodes']['ds_lms'] )
);

// The form has to keep the field, or the setting is unsettable and the only
// path left is the derivation.
check(
	'the form stores an explicit widget URL',
	'https://cdn.medice.example/ds-lms.js' === DS_LMS_Settings::sanitize(
		array( 'widget_url' => 'https://cdn.medice.example/ds-lms.js' )
	)['widget_url']
);
check(
	'and refuses one that is not a URL',
	'' === DS_LMS_Settings::sanitize( array( 'widget_url' => 'javascript:alert(1)' ) )['widget_url']
);

// ---------------------------------------------------------------------------

echo "\n$checks checks, $failures failed\n";
exit( $failures === 0 ? 0 : 1 );
