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
		);
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
