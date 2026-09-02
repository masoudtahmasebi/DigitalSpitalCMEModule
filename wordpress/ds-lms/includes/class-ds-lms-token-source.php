<?php
/**
 * Where the current visitor's Keycloak access token comes from (P6-02, P98-01).
 *
 * ## There is no WordPress user, and there never will be
 *
 * This is the fact everything here follows from, and it took until 19.08 to
 * establish because we had read MEDICE's *plugin* and not their *theme*.
 *
 * `keycloakwordpressplugin` exchanges a username and password for a token
 * (`Keycloak::getAccessTokenByUnamePass`) and returns it. The **theme** is what
 * logs somebody in — `theme/functions/login-class.php`:
 *
 *     $tokenResponse = Keycloak::getAccessTokenByUnamePass($username, $password);
 *     $token         = $tokenResponse['data']['access_token'];
 *     $userInfo      = Keycloak::getUserInfoByToken($token);
 *     $data          = array_merge($tokenResponse['data'], ['userinfo' => …]);
 *     self::storeIntoSession($data);          // → $_SESSION['LOGIN_SESSION']
 *
 * `$tokenResponse['data']` is the whole token response, so the session holds
 * `access_token`, `refresh_token`, `expires_in` and `refresh_expires_in` — and
 * the request's scope includes `offline_access`, so the refresh token is an
 * offline one.
 *
 * **What it does not do is create a WordPress user.** There is no `wp_signon`,
 * no `wp_set_auth_cookie` and no `wp_insert_user` anywhere in the theme or the
 * plugin. `Profile::isLogedIn()` is `isset($_SESSION['LOGIN_SESSION'])` and
 * nothing more. So for every physician on that site `is_user_logged_in()` is
 * **false**, and this file must not ask it — the client put it plainly:
 *
 * > there is no wordpress login for any physician at all … you should not use
 * > anything from wordpress, you should only use the medice keycloak login
 *
 * Two paths remain, and neither consults WordPress's idea of a user:
 *
 * 1. the `ds_lms_access_token` filter, for a host that would rather hand the
 *    token over explicitly;
 * 2. the host's own session, read at a configurable key.
 *
 * The user-meta strategies that used to be here are gone. `get_user_meta`
 * needs a WordPress user id, there is never one, so they were code that could
 * not run — CLAUDE.md §9.2 and §9.3 in one: an affordance the system can only
 * refuse, and a rule nothing calls.
 *
 * ## DocCheck
 *
 * The site has a second login (`Profile::isDocCkeckLogedIn()`, a cookie) which
 * involves no Keycloak at all. Such a visitor has no access token and this
 * returns null for them — correctly. The widget then shows its signed-out
 * state, which is the honest outcome: DocCheck does not identify a physician to
 * *our* realm, and a CME point cannot be awarded to somebody the accreditation
 * chain cannot name.
 *
 * ## The token expires and nothing renews it (P99-02)
 *
 * The theme writes the token response into the session **once, at login**, and
 * never touches it again. Nothing in the theme or the Keycloak plugin performs
 * a refresh — `grep refresh_token` across both finds nothing.
 *
 * A Keycloak access token lives five minutes by default. A MEDICE session lives
 * as long as the browser does. So a physician stays signed in to the website,
 * the menus keep saying so, and the token this file hands out has been dead for
 * hours. The API refuses it, the widget shows "Ihre Sitzung ist abgelaufen",
 * and its **Erneut versuchen** button re-reads the same dead token — a control
 * that cannot ever succeed, which is §9.2 with the widget on the wrong side of
 * it. A 25-minute module cannot be completed at all.
 *
 * The `refresh_token` is in the same session array, and the grant asked for
 * `offline_access`, so it outlives the access token by design. This file uses
 * it: an expired token is refreshed, the new pair is **written back into the
 * session** — which is what the login would have written, so the whole site
 * benefits, not only the widget — and only a refresh that genuinely fails is
 * reported as no token.
 *
 * The connection details come from MEDICE's own plugin
 * (`Keycloak::getSettings()`), so there is no second copy of a client secret
 * anywhere and nothing to keep in sync. If that plugin is absent the refresh is
 * simply unavailable and says so, rather than half-working.
 *
 * ## What this file must never do
 *
 * - Never mint, sign or modify a token. It reads one somebody else obtained.
 * - Never return a token for anyone but the caller. There is no parameter for
 *   one, by construction — the only input is this request's own session.
 * - Never log a token, and never write one into a transient or object cache.
 *
 * @package ds-lms
 */

declare( strict_types = 1 );

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class DS_LMS_Token_Source {

	/**
	 * The access token for **this request's** session, or null.
	 *
	 * Takes no arguments on purpose. A `$user_id` parameter is the difference
	 * between an endpoint that hands you your own token and one that hands you
	 * anybody's, and the safest way not to get that wrong is to make it
	 * unrepresentable.
	 */
	public static function current(): ?string {
		/**
		 * The explicit integration point, for a host that holds the token
		 * somewhere this file cannot see.
		 *
		 * Returned as-is, expiry and all: a host that answers this filter is
		 * managing its own token and this file is not entitled to second-guess
		 * how long it should live.
		 *
		 * @param string|null $token The access token, or null if none is held.
		 */
		$filtered = apply_filters( 'ds_lms_access_token', null );
		if ( is_string( $filtered ) && '' !== $filtered ) {
			return $filtered;
		}

		$token = self::from_host_session();
		if ( null === $token ) {
			return null;
		}

		// Still good for long enough to be worth handing over.
		if ( ! self::expires_within( $token, self::RENEW_MARGIN_SEC ) ) {
			return $token;
		}

		return self::refresh();
	}

	/**
	 * Refresh margin, in seconds.
	 *
	 * Not zero. A token with four seconds left passes every check here and is
	 * refused by the API by the time it arrives — a race that presents as an
	 * intermittent, unreproducible sign-out. A minute is longer than any round
	 * trip and far shorter than the shortest sensible token lifetime.
	 */
	private const RENEW_MARGIN_SEC = 60;

	/**
	 * Does this JWT expire within `$seconds`? Unreadable counts as expired.
	 *
	 * Read, not verified. Verification is the API's job against keys this
	 * server does not hold; all that is needed here is "is it worth sending",
	 * and the safe answer for anything unparseable is no.
	 */
	public static function expires_within( string $token, int $seconds ): bool {
		$claims = self::claims( $token );
		$exp    = $claims['exp'] ?? null;
		if ( ! is_int( $exp ) && ! is_float( $exp ) ) {
			return true;
		}
		return ( (int) $exp - time() ) <= $seconds;
	}

	/**
	 * A JWT's payload, decoded. `[]` when it is not a readable JWT.
	 *
	 * @return array<string,mixed>
	 */
	public static function claims( string $token ): array {
		$parts = explode( '.', $token );
		if ( 3 !== count( $parts ) ) {
			return array();
		}
		$payload = json_decode(
			(string) base64_decode( strtr( $parts[1], '-_', '+/' ), false ),
			true
		);
		return is_array( $payload ) ? $payload : array();
	}

	/**
	 * The physician's own name and address, from the host's session (P105-01).
	 *
	 * MEDICE's realm puts no `email`, `given_name` or `family_name` in the access
	 * token, so the platform had nothing to print on a Teilnahmebescheinigung —
	 * and a certificate with no name is not a valid document.
	 *
	 * The theme already has it. `Keycloak::getUserInfoByToken()` runs at sign-in
	 * and the result is stored beside the token, under `userinfo`, in the same
	 * session array this class already reads. Nothing new is fetched or kept: this
	 * only forwards what the login put there.
	 *
	 * **It does not say who the user is.** The API decides that from the token's
	 * own signature and ignores anything here that the token itself carries — see
	 * `apps/api/src/auth/profile-hint.ts`. If MEDICE add the claim mappers, this
	 * stops being used with no change on either side.
	 *
	 * @return array<string,string> Empty when the session holds no profile.
	 */
	public static function profile(): array {
		if ( ! self::session_active() ) {
			return array();
		}

		$key = DS_LMS_Settings::all()['session_key'];
		if ( '' === $key || ! isset( $_SESSION[ $key ]['userinfo'] ) ) {
			return array();
		}

		$info = $_SESSION[ $key ]['userinfo'];
		if ( ! is_array( $info ) ) {
			return array();
		}

		$profile = array();
		foreach ( array(
			'email'      => 'email',
			'given_name' => 'firstName',
			'family_name' => 'lastName',
		) as $from => $to ) {
			if ( isset( $info[ $from ] ) && is_string( $info[ $from ] ) && '' !== $info[ $from ] ) {
				$profile[ $to ] = $info[ $from ];
			}
		}

		return $profile;
	}

	/** Is a refresh even possible on this installation? */
	public static function can_refresh(): bool {
		return array() !== self::connection() && null !== self::stored( 'refresh_token' );
	}

	/**
	 * Exchange the refresh token for a new one, and write the pair back.
	 *
	 * Writing back into the host's session array is deliberate and is the
	 * smallest correct thing: it is exactly what the login wrote, so every
	 * other part of the site that reads the token gets the fresh one too. A
	 * refresh kept privately here would leave the rest of the site holding a
	 * corpse.
	 *
	 * Returns the new access token, or null — and null is a real answer: an
	 * offline token can be revoked in Keycloak, in which case the person must
	 * sign in again and no amount of retrying will change it.
	 */
	private static function refresh(): ?string {
		$refresh_token = self::stored( 'refresh_token' );
		$connection    = self::connection();
		if ( null === $refresh_token || array() === $connection ) {
			return null;
		}

		$response = wp_remote_post(
			$connection['token_url'],
			array(
				'timeout' => 10,
				'headers' => array( 'Content-Type' => 'application/x-www-form-urlencoded' ),
				'body'    => array(
					'grant_type'    => 'refresh_token',
					'refresh_token' => $refresh_token,
					'client_id'     => $connection['client_id'],
					'client_secret' => $connection['client_secret'],
				),
			)
		);

		if ( is_wp_error( $response ) || 200 !== (int) wp_remote_retrieve_response_code( $response ) ) {
			// Deliberately silent about the body. A failed refresh carries the
			// realm's own error text, and it must not reach a log or a screen:
			// it is about this person's credential.
			return null;
		}

		$body = json_decode( (string) wp_remote_retrieve_body( $response ), true );
		if ( ! is_array( $body ) || ! isset( $body['access_token'] ) || ! is_string( $body['access_token'] ) ) {
			return null;
		}

		self::store( $body );
		return $body['access_token'];
	}

	/**
	 * Write the refreshed pair back into the host's session.
	 *
	 * @param array<string,mixed> $body The token endpoint's response.
	 */
	private static function store( array $body ): void {
		$key = DS_LMS_Settings::all()['session_key'];
		if ( '' === $key || ! isset( $_SESSION[ $key ] ) || ! is_array( $_SESSION[ $key ] ) ) {
			return;
		}
		foreach ( array( 'access_token', 'refresh_token', 'expires_in', 'refresh_expires_in' ) as $field ) {
			if ( isset( $body[ $field ] ) ) {
				$_SESSION[ $key ][ $field ] = $body[ $field ];
			}
		}
	}

	/** One field of the host's stored token response, or null. */
	private static function stored( string $field ): ?string {
		if ( ! self::session_active() ) {
			return null;
		}
		$key = DS_LMS_Settings::all()['session_key'];
		if ( '' === $key || ! isset( $_SESSION[ $key ] ) || ! is_array( $_SESSION[ $key ] ) ) {
			return null;
		}
		$value = $_SESSION[ $key ][ $field ] ?? null;
		return is_string( $value ) && '' !== $value ? $value : null;
	}

	/**
	 * Where to refresh, and as whom — from MEDICE's own plugin.
	 *
	 * Read from `Keycloak::getSettings()` rather than copied into our settings
	 * so there is exactly one client secret on the site and nothing to keep in
	 * step. A missing plugin, or settings without a secret, means refresh is
	 * unavailable — which `can_refresh()` reports and the diagnostics screen
	 * shows, rather than failing at the moment somebody is watching a video.
	 *
	 * @return array{token_url:string,client_id:string,client_secret:string}|array{}
	 */
	private static function connection(): array {
		$class = 'DigitalSpital\\Plugins\\Keycloak\\Inc\\Keycloak';
		if ( ! class_exists( $class ) || ! method_exists( $class, 'getSettings' ) ) {
			return array();
		}

		/** @var array<string,mixed> $settings */
		$settings = (array) call_user_func( array( $class, 'getSettings' ) );

		$base   = isset( $settings['auth_server_url'] ) ? rtrim( (string) $settings['auth_server_url'], '/' ) : '';
		$realm  = isset( $settings['realm'] ) ? (string) $settings['realm'] : '';
		$id     = isset( $settings['resource'] ) ? (string) $settings['resource'] : '';
		$secret = isset( $settings['credentials_secret'] ) ? (string) $settings['credentials_secret'] : '';

		if ( '' === $base || '' === $realm || '' === $id ) {
			return array();
		}

		return array(
			'token_url'     => $base . '/realms/' . $realm . '/protocol/openid-connect/token',
			'client_id'     => $id,
			'client_secret' => $secret,
		);
	}

	/**
	 * Is there a token to be had, without producing it?
	 *
	 * The renderer needs to know whether to name the token endpoint on the
	 * element, and the diagnostics screen needs to say which state the site is
	 * in. Neither should hold the token to answer, and a boolean cannot be
	 * accidentally printed into a page.
	 */
	public static function available(): bool {
		return null !== self::current();
	}

	/**
	 * Is a PHP session actually running on this request?
	 *
	 * Worth asking separately, because "no session" and "a session with no
	 * token in it" are different problems with different fixes and they are
	 * indistinguishable from a null token (§9.4). On the MEDICE site the theme
	 * starts one for every request — `session_start()` at the top of
	 * `components/products_api.php`, which `functions.php` includes on load, so
	 * it is running for `/wp-json/` requests too.
	 */
	public static function session_active(): bool {
		return PHP_SESSION_ACTIVE === session_status();
	}

	/**
	 * `$_SESSION[<key>]['access_token']`, where the key is a setting.
	 *
	 * A setting rather than a constant because the key belongs to the host's
	 * login code, not to us — MEDICE's is `LOGIN_SESSION`, which is the default
	 * because MEDICE is who this is for, and a second site with a different one
	 * changes a field instead of waiting for a release.
	 *
	 * Deliberately does **not** call `session_start()`. Starting a session from
	 * a REST request that would not otherwise have one changes caching
	 * behaviour on a production site, and this plugin does not get to make that
	 * decision. `session_active()` reports it instead.
	 */
	private static function from_host_session(): ?string {
		if ( ! self::session_active() ) {
			return null;
		}

		$key = DS_LMS_Settings::all()['session_key'];
		if ( '' === $key || ! isset( $_SESSION[ $key ] ) || ! is_array( $_SESSION[ $key ] ) ) {
			return null;
		}

		$token = $_SESSION[ $key ]['access_token'] ?? null;
		return is_string( $token ) && '' !== $token ? $token : null;
	}
}
