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
		 * @param string|null $token The access token, or null if none is held.
		 */
		$filtered = apply_filters( 'ds_lms_access_token', null );
		if ( is_string( $filtered ) && '' !== $filtered ) {
			return $filtered;
		}

		return self::from_host_session();
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
