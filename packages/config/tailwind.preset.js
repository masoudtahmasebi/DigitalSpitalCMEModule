/**
 * Shared Tailwind preset for the learner widget and the admin console.
 *
 * The widget compiles this INTO its shadow root rather than into the document
 * (ADR-0003 / P5-01), so nothing here may rely on styles being applied to
 * `html` or `body`.
 */
export const dsPreset = {
  theme: {
    extend: {
      colors: {
        // Every brand colour is a CSS variable with a neutral default, so a
        // customer's branding overrides it at runtime by setting the variable
        // on the widget's root — no rebuild, no per-customer bundle. The
        // defaults are placeholders and are never anyone's real brand.
        //
        // The fallback inside `var()` matters: a project with no branding, or
        // with a value that failed validation in `@ds/domain`, renders these
        // rather than nothing.
        // Teal, because the layout is teal: the hero, the tab pills, the
        // progress card and the player chrome are all one colour, and it is
        // the colour a physician sees first. The defaults track the Zeplin
        // artwork so an unbranded deployment already looks like the design
        // rather than like a placeholder.
        /*
         * `#007f95` is the teal, and it is MEDICE's (DEP-38).
         *
         * It was `#17788d`, sampled from the Zeplin artwork rather than given
         * as a value. The client gave the value: *"The teal color used every
         * where should be this - #007f95"*. The scale below is rebuilt around
         * it — the tints and shades are derived from the new 600 rather than
         * left pointing at the old hue, which would have produced a hero in one
         * teal and its hover state in another.
         *
         * **Changing this may change nothing on a branded deployment, and that
         * is the part worth knowing.** `--ds-brand-600` and `--ds-brand-700`
         * are written by `brandingCssVars` from the project's `primaryColor`
         * (Verwaltung → Erscheinungsbild). Where a customer has set one, theirs
         * wins and these defaults are never read. 50, 100, 500 and 800 have no
         * branding input at all, so those four are always these values.
         */
        brand: {
          50: "var(--ds-brand-50, #e6f2f5)",
          100: "var(--ds-brand-100, #c2e0e7)",
          500: "var(--ds-brand-500, #0d92a9)",
          600: "var(--ds-brand-600, #007f95)",
          700: "var(--ds-brand-700, #006678)",
          800: "var(--ds-brand-800, #00505e)",
          contrast: "var(--ds-brand-contrast, #ffffff)",
        },

        /**
         * The orange call-to-action, and why it is a *separate* scale.
         *
         * The layout uses two action colours with different meanings, and they
         * are not interchangeable. Teal is "go somewhere" — Zur Fortbildung, a
         * tab, the back link. Orange is "resume the thing you started" —
         * Fortbildung fortsetzen, Fortbildung pausieren, the CME points badge,
         * the Lernziele ticks. A learner scanning the catalogue finds the
         * course they are part-way through by looking for orange.
         *
         * Folding it into `brand` would have made that distinction a shade
         * rather than a token, and the first customer whose brand colour is
         * itself orange would have collapsed the two.
         */
        /*
         * The ramp is Material's orange, since DEP-30.
         *
         * The client gave one value — *"Color used: #f0912e / Color to use:
         * #ff9800"* — and #ff9800 is Material orange 500 exactly. The other
         * four steps were mixed from the old hue and would have left a button
         * that hovers from the new orange to the old one, so they are the same
         * ramp's own neighbours rather than four numbers invented here:
         * 50 #fff3e0, 100 #ffe0b2, 600 #fb8c00, 700 #f57c00.
         *
         * Only the **fallbacks** change. `--ds-cta-*` is what a customer's
         * branding sets, and no branding sets it today — `grep -rn "ds-cta-500"`
         * over the API, the migrations and `@ds/domain` returns nothing — so
         * these values are what every installation actually renders.
         */
        cta: {
          50: "var(--ds-cta-50, #fff3e0)",
          100: "var(--ds-cta-100, #ffe0b2)",
          500: "var(--ds-cta-500, #ff9800)",
          600: "var(--ds-cta-600, #fb8c00)",
          700: "var(--ds-cta-700, #f57c00)",
          contrast: "var(--ds-cta-contrast, #ffffff)",
        },

        // The page behind the cards. The widget cannot style the host page's
        // body, so any panel that wants to read as "raised" has to sit on this
        // explicitly.
        canvas: "var(--ds-canvas, #f4f7f8)",

        /*
         * The focus ring's colour. Falls back to the brand teal, so an
         * unbranded deployment focuses in the same teal it draws everything
         * else in — kept in step with `brand.600` above by hand, because a
         * CSS var cannot reference another var's *fallback* (DEP-38).
         */
        accent: "var(--ds-accent, #007f95)",
        status: {
          notStarted: "#6b7280",
          inProgress: "#b45309",
          completed: "#15803d",
          locked: "#9ca3af",
        },
      },
      fontFamily: {
        // Same mechanism. `--ds-font-family` is a *family name*, never a URL —
        // the platform loads no third-party font. See packages/domain/branding.ts
        // for why that is a legal position and not only a technical one.
        sans: ["var(--ds-font-family, Inter, system-ui, sans-serif)"],
      },
      borderRadius: {
        brand: "var(--ds-radius, 0.375rem)",
      },
    },
  },
  plugins: [],
};
