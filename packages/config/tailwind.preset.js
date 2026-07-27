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
        // Neutral placeholders. Real MEDICE brand values are bound per project
        // via the branding configuration on the Project record (roadmap section 3),
        // never hardcoded here.
        brand: {
          50: "#eef4fb",
          100: "#d6e4f5",
          500: "#2f6fb5",
          600: "#255a94",
          700: "#1c4472",
        },
        status: {
          notStarted: "#6b7280",
          inProgress: "#b45309",
          completed: "#15803d",
          locked: "#9ca3af",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
