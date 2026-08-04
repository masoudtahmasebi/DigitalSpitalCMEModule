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
        brand: {
          50: "var(--ds-brand-50, #e8f3f6)",
          100: "var(--ds-brand-100, #c9e3ea)",
          500: "var(--ds-brand-500, #1b8098)",
          600: "var(--ds-brand-600, #17788d)",
          700: "var(--ds-brand-700, #116072)",
          800: "var(--ds-brand-800, #0d4b59)",
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
        cta: {
          50: "var(--ds-cta-50, #fef4e7)",
          100: "var(--ds-cta-100, #fbe3c2)",
          500: "var(--ds-cta-500, #f0912e)",
          600: "var(--ds-cta-600, #e0821b)",
          700: "var(--ds-cta-700, #bc6d14)",
          contrast: "var(--ds-cta-contrast, #ffffff)",
        },

        // The page behind the cards. The widget cannot style the host page's
        // body, so any panel that wants to read as "raised" has to sit on this
        // explicitly.
        canvas: "var(--ds-canvas, #f4f7f8)",

        accent: "var(--ds-accent, #17788d)",
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
