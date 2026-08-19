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
		/*
		 * The bundle comes from the platform, not from this plugin (P96-01).
		 *
		 * It used to be `DS_LMS_URL . 'assets/ds-lms.js'` — a copy placed in
		 * the plugin by `pnpm wp:bundle`, which is a build step a human had to
		 * remember before packaging. The file is a build artefact and is
		 * gitignored, so **every copy of this plugin taken from the repository
		 * was missing it**, and nothing said so: `wp_register_script` happily
		 * points at a URL, the browser 404s, and the page renders a `<ds-lms>`
		 * element that never upgrades. A staging install found it exactly that
		 * way. CLAUDE.md §9.9 — a step documented for a human is a step that
		 * does not happen.
		 *
		 * Loading it from the platform's own widget host fixes the class
		 * rather than the instance, and is what the client asked for: a fix to
		 * the widget reaches every site on our next deploy, with no plugin
		 * update anywhere. `infra/nginx/widget.conf` serves it with the CORS
		 * and cache headers that makes that safe and quick.
		 *
		 * **No version query string.** `DS_LMS_VERSION` is the *plugin's*
		 * version and would pin visitors to whatever bundle was current when
		 * the plugin was last released — which is the coupling this removes.
		 * Freshness is the cache header's job now, not the URL's.
		 */
		$widget_url = DS_LMS_Settings::all()['widget_url'];
		if ( '' === $widget_url ) {
			// Nothing to register. `render()` says so where somebody can act
			// on it, rather than enqueuing a handle that resolves to nothing.
			self::register_content_hooks();
			return;
		}

		wp_register_script(
			self::HANDLE,
			$widget_url,
			array(),
			null,
			// In the footer, and as a module: the widget is a custom element
			// and upgrades markup that was already parsed, so it does not need
			// to block rendering.
			array( 'strategy' => 'defer', 'in_footer' => true )
		);

		self::register_content_hooks();
	}

	/** The block and the shortcode, which exist whether or not a bundle does. */
	private static function register_content_hooks(): void {
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

		/*
		 * The bundle's address, checked separately and named separately
		 * (P96-01).
		 *
		 * Folding it into the test above would tell an editor to fill in the
		 * API base they have already filled in. This is a different field with
		 * a different fix, and the message says which — §9.4, say what the
		 * person does next.
		 *
		 * It can only be empty when `base_domain` is empty too *and* nobody
		 * typed a URL, so in practice the first guard catches it; this exists
		 * for the case that is left, and so that the silent 404 the staging
		 * install met can never happen again without somebody being told.
		 */
		if ( '' === $settings['widget_url'] ) {
			if ( current_user_can( 'edit_posts' ) ) {
				return '<p>' . esc_html__(
					'DS Education: Es ist keine Adresse für das Widget-JavaScript hinterlegt. Bitte Basis-Domain oder Widget-URL in den Einstellungen eintragen.',
					'ds-lms'
				) . '</p>';
			}
			return '';
		}

		wp_enqueue_script( self::HANDLE );
		add_filter( 'script_loader_tag', array( self::class, 'as_module' ), 10, 2 );

		// The attribute is omitted entirely rather than emitted empty: the
		// widget distinguishes "no course attribute" (show the catalogue) from
		// a slug, and `course=""` would be a slug that matches nothing.
		$course_attribute = '' === $course
			? ''
			: sprintf( ' course="%s"', esc_attr( $course ) );

		return sprintf(
			'<ds-lms api-base="%1$s" project="%2$s"%3$s%4$s%5$s data-ds-plugin="%6$s"></ds-lms>',
			esc_url( $settings['api_base'] ),
			esc_attr( $settings['project_slug'] ),
			$course_attribute,
			self::session_attributes(),
			self::token_attributes(),
			// Which plugin is on this site, answerable from the browser rather
			// than over FTP. The widget writes `data-ds-build` beside it, so
			// one element carries both halves of "which build?" (§9.9).
			esc_attr( DS_LMS_VERSION )
		);
	}

	/**
	 * What this page knows about its own visitor (P99-03).
	 *
	 * ## Why the page gets to answer this
	 *
	 * Because it is the only thing that can. Signing in happens on this site,
	 * in this site's session, and the widget has no way to see it. Without the
	 * answer the widget could only infer "no token, therefore something is
	 * broken", and it said so — a physician who had simply not logged in was
	 * told the Fortbildung was *nicht korrekt eingebunden* and to contact the
	 * site's operator.
	 *
	 * ## What this is not
	 *
	 * **It is not authorisation, and it must never be mistaken for it.** This
	 * decides what a person sees; it decides nothing about what they may do.
	 * Every request the widget makes still carries a token the API validates
	 * against Keycloak's JWKS — signature, issuer, audience, expiry — so a page
	 * asserting `signed-in="yes"` gains a caller precisely nothing. CLAUDE.md
	 * §4 invariant 2 is untouched: **never trust WordPress that a user is
	 * authenticated.** We trust it only about what to draw.
	 *
	 * ## Signed in for this purpose means "holds a Keycloak token"
	 *
	 * Not "is signed in to the website". A DocCheck visitor is signed in and
	 * has no Keycloak token, and a CME point cannot be awarded to somebody the
	 * accreditation chain cannot name — so they are shown the same invitation
	 * to sign in with a MEDICE account, which is exactly what they need to do.
	 */
	private static function session_attributes(): string {
		$signed_in = DS_LMS_Token_Source::available();

		return sprintf(
			' signed-in="%1$s" sign-in-url="%2$s"',
			$signed_in ? 'yes' : 'no',
			esc_url( DS_LMS_Settings::sign_in_url() )
		);
	}

	/**
	 * Where the widget can get a token, and the header it must send.
	 *
	 * ## What used to be here, and why it is not
	 *
	 * Forty lines of inline JavaScript: a `fetch` of the token endpoint with
	 * `X-WP-Nonce`, a `refresh=1` query parameter, error handling, and the
	 * property assignment that survives a custom element upgrading late.
	 *
	 * Every one of those lines already existed inside the widget, in
	 * `apps/widget/src/token.ts`. Two implementations of one behaviour is the
	 * shape CLAUDE.md warns about generally; here it had a specific cost, and
	 * it is the cost the client asked to be rid of: **a change to how a token
	 * is fetched needed a plugin update on every customer site.** A retry, a
	 * timeout, a different failure — all of it was frozen at whatever version
	 * of the plugin that site last installed (P96-03).
	 *
	 * So the page now says *where* and *what header*, and says nothing about
	 * *how*. The how ships with the bundle and updates with it.
	 *
	 * ## What is in the attributes
	 *
	 * The endpoint URL, which is public, and a WordPress REST nonce, which is
	 * not a credential: it is bound to this visitor's own session and is
	 * useless without their cookie. It was already in the page — in the script
	 * that is gone — so nothing is exposed here that was not before.
	 *
	 * **No token.** There has never been one in the markup and there must never
	 * be one.
	 *
	 * @return string The attributes, ready to concatenate, or empty.
	 */
	private static function token_attributes(): string {
		if ( ! DS_LMS_Token_Source::available() ) {
			/*
			 * Not `is_user_logged_in()` (P98-01).
			 *
			 * MEDICE's physicians are never WordPress users — their login is a
			 * theme-level PHP session — so that test was false for every one of
			 * them and the element went out with no way to authenticate at all.
			 *
			 * The honest question is whether there is a token to fetch, and it
			 * is asked without producing one. A DocCheck visitor reaches here
			 * too: signed in to the site, holding no Keycloak token, which is
			 * exactly the case the widget's signed-out state is for.
			 */
			return '';
		}

		$endpoint = rest_url( DS_LMS_Token_Endpoint::NAMESPACE . DS_LMS_Token_Endpoint::ROUTE );

		return sprintf(
			' token-endpoint="%1$s" token-header="%2$s"',
			esc_url( $endpoint ),
			esc_attr( 'X-WP-Nonce: ' . wp_create_nonce( 'wp_rest' ) )
		);
	}
}
