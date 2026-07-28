<?php
/**
 * The block, the shortcode, and the asset loading (P6-01).
 *
 * Both render the same element with the same attributes — literally, through
 * `render()`. Two code paths producing "the same" markup is how a block and a
 * shortcode drift until one of them is subtly broken on a page nobody checks.
 *
 * ## The bundle is enqueued only where it is used
 *
 * Registration happens on every request; enqueuing happens in `render()`,
 * which only runs when a block or shortcode is actually on the page. A
 * site-wide enqueue would put ~80 kB of JavaScript and a custom-element
 * registration on MEDICE's every page for the sake of the handful that need
 * it.
 *
 * ## What is in the HTML
 *
 * An API base, a project slug and a course slug — public by construction — and
 * separately, in an inline script, a WordPress REST nonce. **No token.** The
 * nonce is not a credential: it is worthless without the visitor's own session
 * cookie, and it is what stops another origin using that cookie against the
 * token endpoint.
 *
 * @package ds-lms
 */

declare( strict_types = 1 );

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class DS_LMS_Renderer {

	private const HANDLE = 'ds-lms-widget';

	public static function boot(): void {
		add_action( 'init', array( self::class, 'register' ) );
	}

	public static function register(): void {
		wp_register_script(
			self::HANDLE,
			DS_LMS_URL . 'assets/ds-lms.js',
			array(),
			DS_LMS_VERSION,
			// In the footer, and as a module: the widget is a custom element
			// and upgrades markup that was already parsed, so it does not need
			// to block rendering.
			array( 'strategy' => 'defer', 'in_footer' => true )
		);

		add_shortcode( 'ds_lms', array( self::class, 'shortcode' ) );

		// The block is registered from block.json so the editor and the front
		// end agree on the attribute names without a second declaration.
		if ( function_exists( 'register_block_type' ) ) {
			register_block_type(
				DS_LMS_DIR . 'block',
				array( 'render_callback' => array( self::class, 'block' ) )
			);
		}
	}

	/**
	 * `wp_register_script` cannot emit `type="module"`, and the bundle is one.
	 *
	 * @param string $tag    The script tag.
	 * @param string $handle Script handle.
	 */
	public static function as_module( string $tag, string $handle ): string {
		if ( self::HANDLE !== $handle ) {
			return $tag;
		}
		return str_replace( '<script ', '<script type="module" ', $tag );
	}

	/**
	 * @param array<string,mixed>|string $atts Shortcode attributes.
	 */
	public static function shortcode( $atts ): string {
		$atts = shortcode_atts(
			array( 'course' => '' ),
			is_array( $atts ) ? $atts : array(),
			'ds_lms'
		);

		return self::render( (string) $atts['course'] );
	}

	/**
	 * @param array<string,mixed> $attributes Block attributes.
	 */
	public static function block( array $attributes ): string {
		return self::render( (string) ( $attributes['courseSlug'] ?? '' ) );
	}

	/**
	 * The one place the element is produced.
	 *
	 * ## With a course, and without one
	 *
	 * A course slug — from the block, the shortcode, or the plugin settings —
	 * opens that Fortbildung directly. **No slug is not an error**: the widget
	 * then renders the catalogue, which is what a page listing several
	 * Fortbildungen needs, and it is the only way to reach the delivery-type
	 * tabs and the Thema/Altersgruppe filters.
	 *
	 * That is why the guard below no longer requires `$course`. It used to, and
	 * a site with no default course configured got an editor warning telling it
	 * to fill in a field it did not need.
	 *
	 * @param string $course_override Course slug from the block or shortcode.
	 */
	private static function render( string $course_override ): string {
		$settings = DS_LMS_Settings::all();

		$course = '' !== $course_override
			? (string) preg_replace( '/[^a-z0-9-]/', '', strtolower( $course_override ) )
			: $settings['course_slug'];

		if ( '' === $settings['api_base'] || '' === $settings['project_slug'] ) {
			// Editors see what is wrong; visitors see nothing at all rather
			// than a broken widget.
			if ( current_user_can( 'edit_posts' ) ) {
				return '<p>' . esc_html__(
					'DS Education: Bitte API-Basis-URL und Projekt-Slug in den Einstellungen hinterlegen.',
					'ds-lms'
				) . '</p>';
			}
			return '';
		}

		wp_enqueue_script( self::HANDLE );
		add_filter( 'script_loader_tag', array( self::class, 'as_module' ), 10, 2 );
		self::attach_token_provider();

		// The attribute is omitted entirely rather than emitted empty: the
		// widget distinguishes "no course attribute" (show the catalogue) from
		// a slug, and `course=""` would be a slug that matches nothing.
		$course_attribute = '' === $course
			? ''
			: sprintf( ' course="%s"', esc_attr( $course ) );

		return sprintf(
			'<ds-lms api-base="%1$s" project="%2$s"%3$s></ds-lms>',
			esc_url( $settings['api_base'] ),
			esc_attr( $settings['project_slug'] ),
			$course_attribute
		);
	}

	/**
	 * Teach the widget how to get a token from WordPress.
	 *
	 * The widget knows nothing about WordPress and should not: it exposes a
	 * `tokenProvider` property, and this is the WordPress implementation of it.
	 * Doing it here rather than teaching the widget about `X-WP-Nonce` keeps
	 * the widget host-agnostic — the same bundle runs in the dev harness and,
	 * later, anywhere else.
	 *
	 * Nothing in this script is secret. The nonce is bound to the visitor's own
	 * session and is useless without their cookie.
	 */
	private static function attach_token_provider(): void {
		if ( ! is_user_logged_in() ) {
			// No session, no token, no point installing a provider — the widget
			// will show its "not signed in" state.
			return;
		}

		$endpoint = rest_url( DS_LMS_Token_Endpoint::NAMESPACE . DS_LMS_Token_Endpoint::ROUTE );
		$nonce    = wp_create_nonce( 'wp_rest' );

		$script = sprintf(
			<<<'JS'
(function () {
  var endpoint = %1$s;
  var nonce = %2$s;

  function provider(request) {
    var url = new URL(endpoint, window.location.href);
    if (request && request.refresh) url.searchParams.set("refresh", "1");

    return fetch(url, {
      credentials: "same-origin",
      cache: "no-store",
      headers: { accept: "application/json", "X-WP-Nonce": nonce },
    })
      .then(function (response) {
        return response.ok ? response.json() : null;
      })
      .then(function (body) {
        return body && typeof body.token === "string" ? body.token : undefined;
      })
      .catch(function () {
        return undefined;
      });
  }

  // Custom elements upgrade asynchronously, and the element may be parsed
  // before or after this script runs. Assigning the property works either way:
  // it lands on the instance, and connectedCallback reads it when it fires.
  function attach() {
    document.querySelectorAll("ds-lms").forEach(function (element) {
      element.tokenProvider = provider;
    });
  }

  attach();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", attach);
  }
})();
JS
			,
			wp_json_encode( $endpoint ),
			wp_json_encode( $nonce )
		);

		// `before` so the provider is assigned prior to the module executing
		// and upgrading the element.
		wp_add_inline_script( self::HANDLE, $script, 'before' );
	}
}
