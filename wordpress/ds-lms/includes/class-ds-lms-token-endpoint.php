<?php
/**
 * The token endpoint (P6-02) — `GET /wp-json/ds-lms/v1/token`.
 *
 * Hands a logged-in visitor **their own** Keycloak access token, so the widget
 * can present it to the API. That is the entire integration surface between
 * MEDICE's WordPress session and this platform.
 *
 * ## What the API does with it, and why that matters here
 *
 * Nothing this endpoint says is believed. The API validates every bearer token
 * against Keycloak's JWKS — signature, issuer, audience, expiry — and never
 * trusts WordPress's assertion that somebody is signed in (CLAUDE.md §4
 * invariant 2). So a bug here cannot forge a learner: at worst it fails to
 * produce a token, and the widget shows a session-expired message.
 *
 * What a bug here *can* do is hand somebody a token that is not theirs, which
 * is why the checks below are what they are.
 *
 * ## The checks, and what each one is for
 *
 * 1. **Feature flag.** Off by default and switchable in the admin screen
 *    without a deployment. The endpoint 404s when off — not 403, because a 403
 *    confirms the route exists.
 * 2. **Logged in.** `is_user_logged_in()` in the permission callback, so an
 *    anonymous request never reaches the handler.
 * 3. **Nonce.** `X-WP-Nonce` for `wp_rest`, tying the request to this
 *    visitor's session and this origin. Without it, any site the visitor
 *    browses could fetch their token with a cross-origin credentialed request.
 * 4. **No user parameter.** The route accepts none, and `DS_LMS_Token_Source`
 *    has no argument for one. "Return only the caller's token" is not enforced
 *    by a check; it is enforced by there being no other token reachable.
 * 5. **No-store.** A token in a proxy or a page cache outlives the session it
 *    belongs to.
 *
 * @package ds-lms
 */

declare( strict_types = 1 );

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class DS_LMS_Token_Endpoint {

	public const NAMESPACE = 'ds-lms/v1';
	public const ROUTE     = '/token';

	public static function boot(): void {
		add_action( 'rest_api_init', array( self::class, 'register' ) );
	}

	public static function register(): void {
		if ( ! DS_LMS_Settings::all()['token_endpoint_enabled'] ) {
			// Not registered at all when the flag is off, so the route does not
			// exist rather than existing and refusing.
			return;
		}

		register_rest_route(
			self::NAMESPACE,
			self::ROUTE,
			array(
				'methods'             => 'GET',
				'callback'            => array( self::class, 'handle' ),
				'permission_callback' => array( self::class, 'permitted' ),
				// No arguments. See the class docblock, point 4.
				'args'                => array(),
			)
		);
	}

	public static function permitted(): bool {
		if ( ! is_user_logged_in() ) {
			return false;
		}

		// WordPress checks the `wp_rest` nonce for cookie-authenticated
		// requests itself, but only after this callback — and a missing nonce
		// surfaces as a confusing 403 from a different layer. Checking here
		// makes the refusal this endpoint's own and keeps the two conditions
		// in one place.
		$nonce = isset( $_SERVER['HTTP_X_WP_NONCE'] )
			? sanitize_text_field( wp_unslash( $_SERVER['HTTP_X_WP_NONCE'] ) )
			: '';

		return (bool) wp_verify_nonce( $nonce, 'wp_rest' );
	}

	public static function handle( WP_REST_Request $request ): WP_REST_Response {
		// `refresh=1` is what the widget sends after a 401. There is nothing to
		// do with it here — the source is read fresh on every call, since
		// nothing is cached — but accepting it keeps the widget's contract
		// honest and gives the MEDICE plugin a hook if it ever needs to
		// actually refresh.
		$refresh = '1' === (string) $request->get_param( 'refresh' );

		/**
		 * Fires before the token is read, so an integration can refresh first.
		 *
		 * @param bool $refresh Whether the caller asked for a fresh token.
		 */
		do_action( 'ds_lms_before_token', $refresh );

		$token = DS_LMS_Token_Source::current();

		$response = new WP_REST_Response(
			null === $token
				// No token, and deliberately no explanation: whether the
				// Keycloak plugin holds one is not the caller's business.
				? array( 'token' => null )
				: array( 'token' => $token ),
			null === $token ? 404 : 200
		);

		// Belt and braces: `nocache_headers()` plus explicit no-store, because
		// this response must not sit in a CDN, a page cache or a browser cache.
		foreach ( wp_get_nocache_headers() as $header => $value ) {
			$response->header( $header, $value );
		}
		$response->header( 'Cache-Control', 'no-store, private, max-age=0' );

		return $response;
	}
}
