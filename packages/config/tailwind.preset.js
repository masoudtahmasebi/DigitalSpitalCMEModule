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
        brand: {
          50: "var(--ds-brand-50, #eef4fb)",
          100: "var(--ds-brand-100, #d6e4f5)",
          500: "var(--ds-brand-500, #2f6fb5)",
          600: "var(--ds-brand-600, #255a94)",
          700: "var(--ds-brand-700, #1c4472)",
          contrast: "var(--ds-brand-contrast, #ffffff)",
        },
        accent: "var(--ds-accent, #255a94)",
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
