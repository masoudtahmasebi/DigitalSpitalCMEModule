<?php
/**
 * Where the current user's Keycloak access token comes from (P6-02).
 *
 * ## What MEDICE's plugin actually does — S3 is now closed
 *
 * We have read `keycloakwordpressplugin` (28.07). It is 437 lines and its
 * entire surface is:
 *
 * - `Keycloak::getAccessTokenByUnamePass( $user, $pass )` — password grant
 *   against the realm's token endpoint, **returns** the token array;
 * - `Keycloak::getUserInfoByToken( $token )` — userinfo lookup;
 * - `Keycloak::sendConsentToMediceApi( $profile )` — the consent call;
 * - `Keycloak::getSettings()` — options, overridden by env;
 * - a settings screen.
 *
 * It registers exactly two hooks, both `admin_*`. There is **no login handler,
 * no session write, no cookie write, no user meta write and no refresh-token
 * handling anywhere in it.** `LOGGED_IN_COOKIE` and `SHORT_CODE_TAG` are
 * declared and never used. Whatever calls `getAccessTokenByUnamePass` lives in
 * the theme or another plugin, and the token it receives is used to fetch
 * userinfo and then dropped.
 *
 * **So there is nothing for this file to read.** The optimistic reading of S2
 * — "saved in the session, probably has a refresh token" — does not hold: no
 * token is persisted at all. The strategies below are kept because they cost
 * nothing and would find a token if the calling theme stores one under a
 * conventional key, but the expectation is that they return null.
 *
 * ## What has to change on the MEDICE side, and it is small
 *
 * Whatever performs the login must hand the token to this filter. One
 * `add_filter` call, modifying no existing function — P6-02's "purely
 * additive" criterion, satisfied:
 *
 *     add_filter( 'ds_lms_access_token', function () {
 *         return $token_your_login_handler_already_has;
 *     } );
 *
 * If the token is not held anywhere at the time the widget asks, it has to be
 * stored at login. See docs/show-stoppers.md S2 for the two options and their
 * costs — this is a decision for MEDICE, not one this file can make.
 *
 * ## What this file must never do
 *
 * - Never mint, sign or modify a token. It reads one somebody else obtained.
 * - Never return a token for a user other than the caller. There is no
 *   parameter for one, by construction — the only input is the current
 *   session.
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
	 * The access token for the **currently logged-in** user, or null.
	 *
	 * Takes no arguments on purpose. A `$user_id` parameter is the difference
	 * between an endpoint that hands you your own token and one that hands you
	 * anybody's, and the safest way not to get that wrong is to make it
	 * unrepresentable.
	 */
	public static function current(): ?string {
		if ( ! is_user_logged_in() ) {
			return null;
		}

		/**
		 * The integration point. See the class docblock — this is how MEDICE
		 * supplies the token, and after reading their plugin it is the only
		 * path that will actually produce one.
		 *
		 * @param string|null $token The access token, or null if none is held.
		 */
		$filtered = apply_filters( 'ds_lms_access_token', null );
		if ( is_string( $filtered ) && '' !== $filtered ) {
			return $filtered;
		}

		return self::from_stored_session();
	}

	/**
	 * Best-effort read of a token the login flow may have stored.
	 *
	 * Retained as a convenience, not as an expectation: the plugin we were
	 * given stores nothing, so this returns null on today's MEDICE site. If
	 * their theme's login handler happens to persist the token under one of
	 * these conventional keys, the integration works with no further change.
	 *
	 * Every read is scoped to the *current* user. None takes a user id and
	 * none reaches into another user's data.
	 */
	private static function from_stored_session(): ?string {
		$user_id = get_current_user_id();
		if ( 0 === $user_id ) {
			return null;
		}

		foreach ( array( 'keycloak_access_token', '_keycloak_access_token', 'oidc_access_token' ) as $key ) {
			$value = get_user_meta( $user_id, $key, true );
			if ( is_string( $value ) && '' !== $value ) {
				return $value;
			}
		}

		// Deliberately does not call session_start(). Starting a session from a
		// REST request that would not otherwise have one changes caching
		// behaviour on a production site, and this plugin does not get to make
		// that decision.
		if ( PHP_SESSION_ACTIVE === session_status() ) {
			foreach ( array( 'keycloak_access_token', 'access_token' ) as $key ) {
				if ( isset( $_SESSION[ $key ] ) && is_string( $_SESSION[ $key ] ) && '' !== $_SESSION[ $key ] ) {
					return $_SESSION[ $key ];
				}
			}
		}

		return null;
	}
}
