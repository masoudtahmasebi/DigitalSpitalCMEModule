import { dsPreset } from "@ds/config/tailwind";

/**
 * Tailwind for the shadow root.
 *
 * `preflight` is off on purpose. Preflight's job is to normalise a whole
 * document, and this stylesheet is adopted into a shadow root — where it would
 * be both useless (the host page's `html`/`body` are out of reach) and
 * dangerous if the selectors ever did escape.
 *
 * `.ds-lms-root` is the wrapper the element renders, and every rule is scoped
 * under it so nothing can apply to a slotted node from the host page.
 */
export default {
  presets: [dsPreset],
  content: ["./src/**/*.{ts,tsx}"],
  corePlugins: { preflight: false },
};
