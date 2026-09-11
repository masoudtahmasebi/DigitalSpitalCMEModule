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
 * 2. **Same origin.** An `Origin` header that is present and is not ours is
 *    refused in the permission callback. (This replaced `is_user_logged_in()`
 *    in P98-01: MEDICE's physicians are never WordPress users, so that test
 *    refused every one of them.)
 * 3. **Nonce.** `X-WP-Nonce` for `wp_rest`, tying the request to this
 *    visitor's session and this origin. Defence in depth rather than the
 *    boundary — see `permitted()`, which says why.
 * 4. **No user parameter.** The route accepts none, and `DS_LMS_Token_Source`
 *    has no argument for one. "Return only the caller's token" is not enforced
 *    by a check; it is enforced by there being no other token reachable.
 * 5. **No-store.** A token in a proxy or a page cache outlives the session it
 *    belongs to.
 *
 * Note what is **not** in that list: "the session holds a token". That is not a
 * permission question — `handle()` reads the session and answers 404 with
 * `no_token_held` when there is nothing — and treating it as one produced
 * P214-01, where an expired session was reported to a physician as a fault in
 * the site. `permitted()`'s docblock has the table.
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

	/**
	 * Who may call this, now that WordPress has no opinion (P98-01).
	 *
	 * ## What changed, and it is a real change
	 *
	 * This used to begin `if ( ! is_user_logged_in() ) return false;`. On the
	 * site this exists for, that is false for **every physician** — MEDICE's
	 * login is a theme-level PHP session and creates no WordPress user at all.
	 * The check did not protect anything; it refused everybody.
	 *
	 * So the gate is now: **there is a token in this request's own session.**
	 * A caller with no session gets nothing because there is nothing to get,
	 * which is a stronger statement than a role check — the endpoint cannot
	 * return a token that the caller's own session did not already contain.
	 *
	 * ## What actually stops another site reading a physician's token
	 *
	 * **Same origin, and it is checked here rather than inherited.** A page on
	 * another origin can cause this request (a plain GET is not preflighted)
	 * but cannot *read* the reply: WordPress sends
	 * `Access-Control-Allow-Origin` only for its own origins, so the browser
	 * refuses the response to the calling script. That is the boundary. Relying
	 * on it silently would make it invisible, so an `Origin` that is present
	 * and not ours is refused explicitly, by us, where a test can see it.
	 *
	 * ## And what does *not* protect it, stated so nobody mistakes it for
	 * protection
	 *
	 * **The nonce is not a defence for this endpoint any more.** WordPress
	 * binds a nonce to the user id, and there is no user — so every anonymous
	 * visitor within a tick shares one value, and the page carrying it is
	 * public, so anybody can read a valid nonce by fetching the page. It is
	 * kept because it costs nothing and stops accidental calls from other code
	 * on the site, and because removing it would change two things at once. It
	 * is **not** what makes this safe, and a comment claiming otherwise would
	 * be worse than none (§9.10a).
	 *
	 * This is why the ticket is marked `needs-human-review`: the set of callers
	 * this endpoint answers has genuinely widened, from "WordPress users" to
	 * "browsers on this origin holding a MEDICE session", and that is a
	 * decision, not a refactor.
	 *
	 * ## What this does NOT decide, and why it used to (P214-01)
	 *
	 * It used to end `return DS_LMS_Token_Source::available();` — "is there a
	 * token in this session?" — and that sentence read like the strongest gate
	 * on the endpoint. It was not a gate at all. `handle()` asks the very same
	 * function one line later, so the set of requests that walk away with a
	 * token is identical either way. All the check decided was **which refusal
	 * the caller sees**, and it decided it wrong:
	 *
	 * | Condition                    | Before             | Now                              |
	 * | ---------------------------- | ------------------ | -------------------------------- |
	 * | Another origin               | 401/403 forbidden  | unchanged                        |
	 * | Missing or forged nonce      | 401/403 forbidden  | unchanged                        |
	 * | Signed in, no Keycloak token | 401/403 forbidden  | 404 `{"reason":"no_token_held"}` |
	 *
	 * The third row is the whole ticket. A physician whose Keycloak session had
	 * expired was told *"Das liegt nicht an Ihrem Konto — wenden Sie sich an
	 * den Betreiber der Seite"*, because the widget reads a non-OK **status**
	 * as "the endpoint failed" and only a body saying `no_token_held` as "you
	 * are not signed in". P99-03 fixed exactly that sentence appearing for
	 * exactly that person, and this put it back through a different door.
	 *
	 * The 404 path was already written, already documented in `handle()`'s own
	 * table, and already asserted by the suite — and it was **unreachable**,
	 * because the suite called `handle()` directly and nothing checked that
	 * WordPress would ever get that far (CLAUDE.md §9.7). The tests now go
	 * through this callback first.
	 *
	 * A second, quieter consequence: `available()` calls `current()`, which
	 * **refreshes an expiring token against Keycloak**. Asking here and again
	 * in `handle()` made that two refresh attempts per request. It is now one.
	 */
	public static function permitted(): bool {
		if ( ! self::same_origin() ) {
			return false;
		}

		// Kept as defence in depth only — see the docblock. A visitor with no
		// WordPress user still gets a valid `wp_rest` nonce, so this filters
		// accidents rather than attackers.
		$nonce = isset( $_SERVER['HTTP_X_WP_NONCE'] )
			? sanitize_text_field( wp_unslash( $_SERVER['HTTP_X_WP_NONCE'] ) )
			: '';
		if ( ! wp_verify_nonce( $nonce, 'wp_rest' ) ) {
			return false;
		}

		/*
		 * Whether this session holds a token is `handle()`'s question, not
		 * this one's — see the docblock above. Answering it here cannot make
		 * the endpoint safer, because `handle()` reads the same session on the
		 * same request and can return nothing else; it can only turn "you are
		 * signed out" into "something is broken, call the webmaster".
		 *
		 * The property that makes this endpoint safe is unchanged and is not a
		 * check: `DS_LMS_Token_Source::current()` takes no arguments, so there
		 * is no token reachable from here except this request's own.
		 */
		return true;
	}

	/**
	 * Refuse a request whose `Origin` is somebody else's.
	 *
	 * Absent `Origin` is allowed: browsers omit it on same-origin GETs, and a
	 * server-to-server call has no browser to protect. Present-and-different is
	 * refused, which is the case that matters and the one worth being able to
	 * test.
	 */
	private static function same_origin(): bool {
		$origin = isset( $_SERVER['HTTP_ORIGIN'] )
			? sanitize_text_field( wp_unslash( $_SERVER['HTTP_ORIGIN'] ) )
			: '';
		if ( '' === $origin ) {
			return true;
		}

		return untrailingslashit( $origin ) === untrailingslashit( home_url() );
	}

	/**
	 * The body's `reason` when there is no token — and why saying it is safe.
	 *
	 * Two entirely different conditions used to produce an identical bare 404,
	 * and it cost a day of a client's time (P97-01):
	 *
	 * | Condition                       | Status | Body                       |
	 * | ------------------------------- | ------ | -------------------------- |
	 * | Feature flag off, no route      | 404    | `{"code":"rest_no_route"}` |
	 * | Route present, nothing held     | 404    | `{"token":null}`           |
	 *
	 * A browser console prints `404 (Not Found)` for both, so toggling the
	 * setting changed nothing an observer could see, and the obvious reading —
	 * "the endpoint is missing" — was the wrong one.
	 *
	 * Naming the reason is **not** the §9.5 oracle risk. That rule is about not
	 * answering a stranger's question about somebody else. This caller has
	 * already presented their own session cookie and a valid `wp_rest` nonce:
	 * they are the subject, they know they are signed in, and "WordPress is not
	 * holding a Keycloak token for you" is a fact about their own session.
	 * Nothing here discloses whether another user has one, or that any
	 * particular account exists.
	 */
	private const NO_TOKEN_REASON = 'no_token_held';

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
				? array( 'token' => null, 'reason' => self::NO_TOKEN_REASON )
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
