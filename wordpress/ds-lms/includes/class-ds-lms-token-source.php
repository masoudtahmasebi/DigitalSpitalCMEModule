<?php
/**
 * Where the current user's Keycloak access token comes from (P6-02).
 *
 * ## This is the seam, and it is deliberately one file
 *
 * MEDICE's site already authenticates against Keycloak through their own
 * `keycloakWordPressPlugin`. That plugin holds the token; this one only needs
 * to read it. **S3 in docs/show-stoppers.md is still open**, so we have not
 * seen that code — every strategy below is written against the developer's
 * description and is unverified.
 *
 * Isolating it here means the unverified part is one small file with one
 * method. When repository access arrives, the work is to confirm which
 * strategy fires and delete the rest; nothing else in this plugin, and nothing
 * in the widget or the API, changes.
 *
 * ## What this file must never do
 *
 * - Never mint, sign or modify a token. It reads one somebody else obtained.
 * - Never return a token for a user other than the caller. There is no
 *   parameter for one, by construction — the only input is the current
 *   session.
 * - Never log a token. Not to `error_log`, not to the WordPress debug log, not
 *   into a transient or an object cache.
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
		 * Escape hatch for the MEDICE integration.
		 *
		 * Their plugin can answer this filter directly, which is the smallest
		 * possible change on their side — one `add_filter` call, no
		 * modification to any existing function, exactly what P6-02's
		 * "purely additive" acceptance criterion asks for.
		 *
		 * @param string|null $token The access token, or null if none is held.
		 */
		$filtered = apply_filters( 'ds_lms_access_token', null );
		if ( is_string( $filtered ) && '' !== $filtered ) {
			return $filtered;
		}

		return self::from_session();
	}

	/**
	 * Read the token the Keycloak plugin stored for this session.
	 *
	 * Several shapes are tried because we cannot yet see which one is real.
	 * They are all reads of the *current* session — none takes a user id, none
	 * reaches into another user's data.
	 *
	 * When S3 is resolved this collapses to the one that is true.
	 */
	private static function from_session(): ?string {
		$user_id = get_current_user_id();
		if ( 0 === $user_id ) {
			return null;
		}

		// (a) User meta, the most common pattern for a plugin that needs the
		//     token to outlive a single request.
		foreach ( array( 'keycloak_access_token', '_keycloak_access_token', 'oidc_access_token' ) as $key ) {
			$value = get_user_meta( $user_id, $key, true );
			if ( is_string( $value ) && '' !== $value ) {
				return $value;
			}
		}

		// (b) The PHP session, if their plugin starts one. Deliberately does
		//     not call session_start(): starting a session from a REST request
		//     that would not otherwise have one changes caching behaviour on a
		//     production site, and this plugin does not get to make that
		//     decision.
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
