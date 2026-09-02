<?php
/**
 * Does the platform this site is configured for actually answer? (P96-04)
 *
 * ## Why this exists
 *
 * P96 began with the client opening
 * `…/wp-content/plugins/ds-lms/assets/ds-lms.js?ver=0.1.0` by hand and finding
 * a 404. That is the whole failure mode in one sentence: **nothing on the
 * WordPress side ever asks whether the addresses it is configured with lead
 * anywhere.** WordPress renders the element, the browser fails quietly in a
 * closed shadow root, and the only instrument anybody had was a person typing a
 * URL.
 *
 * It matters more now than it did, not less. Since P96-01 the JavaScript comes
 * from the platform, so a site can be pointed at production, at staging, or at
 * an installation that does not exist yet — and the three look identical on
 * this screen. This turns "which platform am I actually talking to, and is it
 * there" into a button.
 *
 * ## What it will not do
 *
 * **It fetches only the stored settings, never a URL from the request.** A
 * check that took its target from a query parameter would be an SSRF primitive:
 * anybody who could get an administrator to follow a link could make this
 * server issue a request to an address of their choosing — a cloud metadata
 * endpoint, something on the internal network — and read the outcome. So the
 * addresses come from `DS_LMS_Settings::all()` and nowhere else, the trigger is
 * nonce-protected, and it requires `manage_options`.
 *
 * **It reports status and headers, never bodies.** What a person needs to know
 * is *reached it / did not reach it / reached something that refused*, and a
 * response body from an unexpected host is exactly what should not be echoed
 * into an admin screen.
 *
 * @package ds-lms
 */

declare( strict_types = 1 );

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class DS_LMS_Diagnostics {

	/** The query parameter that asks for a check, and the nonce action. */
	public const ACTION = 'ds-lms-check';

	private const TIMEOUT = 8;

	/**
	 * One line of the report.
	 *
	 * `ok` decides the colour; `detail` is a sentence an operator can act on.
	 *
	 * @return array{label:string,ok:bool,detail:string}
	 */
	private static function result( string $label, bool $ok, string $detail ): array {
		return array(
			'label'  => $label,
			'ok'     => $ok,
			'detail' => $detail,
		);
	}

	/**
	 * Ask both addresses whether they are there.
	 *
	 * @return array<int,array{label:string,ok:bool,detail:string}>
	 */
	public static function run(): array {
		$settings = DS_LMS_Settings::all();

		return array(
			self::check_widget( (string) $settings['widget_url'] ),
			self::check_api( (string) $settings['api_base'] ),
			self::check_token( (bool) $settings['token_endpoint_enabled'] ),
		);
	}

	/**
	 * Can this site actually produce a Keycloak token for the person asking?
	 *
	 * ## The report this line exists because of (P97-01)
	 *
	 * The widget was signed out on a site where a MEDICE Keycloak user *was*
	 * logged in, and the console showed `404 (Not Found)` on the token
	 * endpoint. The operator turned the feature flag on, then off, and the
	 * console said exactly the same thing both times — because two unrelated
	 * conditions answer 404:
	 *
	 *   - flag off, so WordPress has no route to match;
	 *   - flag on, route ran, and nothing is holding a token.
	 *
	 * Both are invisible from the browser and the second is the real one. This
	 * line separates them where somebody is already looking for an answer,
	 * rather than leaving it to be inferred from a status code.
	 *
	 * ## Why it reports on the *administrator's own* session
	 *
	 * It can only speak for the person pressing the button — `current()` takes
	 * no user and must not. That is a genuine limit and it is stated in the
	 * message: an administrator who is not themselves signed in through
	 * Keycloak will see "no token", which is true of them and says nothing
	 * about the physicians. It still distinguishes the two 404s, which is the
	 * question that was actually unanswerable.
	 */
	private static function check_token( bool $enabled ): array {
		$label = __( 'Token-Endpunkt', 'ds-lms' );

		if ( ! $enabled ) {
			return self::result(
				$label,
				false,
				__( 'Abgeschaltet. Ohne den Token-Endpunkt kann das Lernmodul niemanden anmelden — bitte oben aktivieren.', 'ds-lms' )
			);
		}

		// "No session at all" and "a session holding no token" are different
		// problems with different fixes, and a null token cannot tell them
		// apart (§9.4).
		if ( ! DS_LMS_Token_Source::session_active() ) {
			return self::result(
				$label,
				false,
				__( 'Aktiv, aber auf diesem Aufruf läuft keine PHP-Session — es kann also gar kein Login gelesen werden. Auf der MEDICE-Seite startet das Theme die Session bei jedem Aufruf.', 'ds-lms' )
			);
		}

		$token = DS_LMS_Token_Source::current();
		if ( null === $token ) {
			return self::result(
				$label,
				false,
				sprintf(
					/* translators: %s: the configured $_SESSION key. */
					__( 'Aktiv, aber unter $_SESSION[„%s"] liegt kein „access_token". Melden Sie sich in einem Fenster über den MEDICE-Login an und prüfen Sie erneut. Bei DocCheck-Anmeldungen ist das erwartet: dort gibt es keinen Keycloak-Token.', 'ds-lms' ),
					DS_LMS_Settings::all()['session_key']
				)
			);
		}

		/*
		 * The two claims that decide whether our API will accept this token
		 * (P98-01).
		 *
		 * The API validates every bearer against the realm's JWKS with the
		 * project's `keycloak_issuer` and `keycloak_audience` as **required**
		 * claims. A token that is perfectly valid and carries a different `aud`
		 * — which is the default for a Keycloak client with no audience mapper
		 * — is refused, and the refusal reaches the browser as a 401 that looks
		 * exactly like "not signed in".
		 *
		 * So the two values an operator has to copy into the project are
		 * printed here, from the token this site actually produces. They are
		 * public registered claims, not secrets. **The token itself, `sub` and
		 * every personal claim stay out of this screen** — the payload is
		 * decoded, two fields are read, and the rest is dropped.
		 *
		 * Decoded, not verified: this is a display of what the site holds, and
		 * verification is the API's job against keys this server does not have.
		 */
		$claims = self::readable_claims( $token );

		return self::result(
			$label,
			true,
			'' === $claims
				? __( 'Aktiv, und für Ihre Sitzung liegt ein Token vor. Das Lernmodul kann sich anmelden.', 'ds-lms' )
				: sprintf(
					/* translators: %s: the token's iss and aud claims. */
					__( 'Aktiv, und für Ihre Sitzung liegt ein Token vor. Diese Werte müssen im DigitalSpital-Verwaltungsbereich beim Projekt hinterlegt sein — %s', 'ds-lms' ),
					$claims
				)
		);
	}

	/**
	 * `iss` and `aud` from a JWT payload, for display. Never anything else.
	 *
	 * @param string $token A JWT. Not verified here — see the caller.
	 */
	private static function readable_claims( string $token ): string {
		$parts = explode( '.', $token );
		if ( 3 !== count( $parts ) ) {
			return '';
		}

		$payload = json_decode(
			(string) base64_decode( strtr( $parts[1], '-_', '+/' ), false ),
			true
		);
		if ( ! is_array( $payload ) ) {
			return '';
		}

		$issuer   = isset( $payload['iss'] ) && is_string( $payload['iss'] ) ? $payload['iss'] : '';
		$audience = $payload['aud'] ?? '';
		$audience = is_array( $audience ) ? implode( ', ', array_filter( $audience, 'is_string' ) ) : (string) $audience;

		if ( '' === $issuer && '' === $audience ) {
			return '';
		}

		$parts = array( sprintf( 'Issuer: %s', $issuer ), sprintf( 'Audience: %s', $audience ) );

		/*
		 * How long this token has left, and whether anything can renew it
		 * (P99-02).
		 *
		 * The defect that made this necessary: a MEDICE session lives for days
		 * and the access token inside it for five minutes, so the *normal*
		 * state of a site an hour after anybody logged in is a live session
		 * holding a dead token. That was invisible from every screen — the
		 * website said signed in, the widget said signed out, and neither
		 * mentioned a clock.
		 */
		$expiry = isset( $payload['exp'] ) && is_numeric( $payload['exp'] )
			? (int) $payload['exp'] - time()
			: null;
		if ( null !== $expiry ) {
			$parts[] = $expiry > 0
				? sprintf(
					/* translators: %d: whole minutes. */
					__( 'gültig noch %d Min.', 'ds-lms' ),
					(int) floor( $expiry / 60 )
				)
				: __( 'abgelaufen', 'ds-lms' );
		}

		$parts[] = DS_LMS_Token_Source::can_refresh()
			? __( 'Erneuerung möglich', 'ds-lms' )
			: __( 'KEINE Erneuerung möglich — nach Ablauf muss sich die Person neu anmelden', 'ds-lms' );

		return implode( ' · ', $parts );
	}

	/**
	 * The bundle: is it there, and may a browser on this site execute it?
	 *
	 * The second half is not pedantry. A widget host that answers 200 without
	 * `Access-Control-Allow-Origin` produces a page where the file downloads
	 * and the browser refuses to run it — indistinguishable, from the site
	 * owner's chair, from a widget that does nothing. It is the same failure
	 * that kept every video upload broken for months (P70-01), one origin over.
	 */
	private static function check_widget( string $url ): array {
		$label = __( 'Widget-JavaScript', 'ds-lms' );

		if ( '' === $url ) {
			return self::result(
				$label,
				false,
				__( 'Keine Adresse hinterlegt. Bitte Basis-Domain oder Widget-URL eintragen.', 'ds-lms' )
			);
		}

		$response = wp_remote_head( $url, array( 'timeout' => self::TIMEOUT ) );
		if ( is_wp_error( $response ) ) {
			return self::result(
				$label,
				false,
				sprintf(
					/* translators: %s: the address that was tried. */
					__( '%s war von diesem Server aus nicht erreichbar.', 'ds-lms' ),
					$url
				)
			);
		}

		$status = (int) wp_remote_retrieve_response_code( $response );
		if ( 200 !== $status ) {
			return self::result(
				$label,
				false,
				sprintf(
					/* translators: 1: the address that was tried. 2: HTTP status code. */
					__( '%1$s antwortete mit HTTP %2$d. Erwartet wird 200.', 'ds-lms' ),
					$url,
					$status
				)
			);
		}

		$cors = (string) wp_remote_retrieve_header( $response, 'access-control-allow-origin' );
		if ( '' === $cors ) {
			return self::result(
				$label,
				false,
				sprintf(
					/* translators: %s: the address that was tried. */
					__( '%s ist erreichbar, sendet aber keinen Access-Control-Allow-Origin-Header. Der Browser lädt die Datei und führt sie nicht aus. Bitte an DigitalSpital melden.', 'ds-lms' ),
					$url
				)
			);
		}

		return self::result(
			$label,
			true,
			sprintf(
				/* translators: %s: the address that answered. */
				__( '%s ist erreichbar und darf von dieser Seite geladen werden.', 'ds-lms' ),
				$url
			)
		);
	}

	/**
	 * The API: is it there?
	 *
	 * Only reachability. Whether *this site's origin* is allowed to call it is
	 * decided per project in the DigitalSpital console and cannot be answered
	 * from here — a server-to-server request carries no Origin header, so it
	 * would pass while every visitor's browser was refused. Saying so is the
	 * point: a check that quietly answers a different question than the one
	 * being asked is worse than no check.
	 */
	private static function check_api( string $api_base ): array {
		$label = __( 'API', 'ds-lms' );

		if ( '' === $api_base ) {
			return self::result(
				$label,
				false,
				__( 'Keine Adresse hinterlegt. Bitte Basis-Domain oder API-Basis-URL eintragen.', 'ds-lms' )
			);
		}

		$url      = rtrim( $api_base, '/' ) . '/health';
		$response = wp_remote_get( $url, array( 'timeout' => self::TIMEOUT ) );

		if ( is_wp_error( $response ) ) {
			return self::result(
				$label,
				false,
				sprintf(
					/* translators: %s: the address that was tried. */
					__( '%s war von diesem Server aus nicht erreichbar.', 'ds-lms' ),
					$url
				)
			);
		}

		$status = (int) wp_remote_retrieve_response_code( $response );
		if ( 200 !== $status ) {
			return self::result(
				$label,
				false,
				sprintf(
					/* translators: 1: the address that was tried. 2: HTTP status code. */
					__( '%1$s antwortete mit HTTP %2$d. Erwartet wird 200.', 'ds-lms' ),
					$url,
					$status
				)
			);
		}

		return self::result(
			$label,
			true,
			sprintf(
				/* translators: %s: the address that answered. */
				__( '%s ist erreichbar. Ob diese Seite die API aufrufen darf, entscheidet die Einstellung „Erlaubte Einbettungs-Domains" im DigitalSpital-Verwaltungsbereich und lässt sich von hier aus nicht prüfen.', 'ds-lms' ),
				$url
			)
		);
	}
}
