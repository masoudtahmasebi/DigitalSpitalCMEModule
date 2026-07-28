import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Placeholder build config (P5-01). The Shadow-DOM `<ds-lms>` custom element
 * and its real entry point are not built yet — this exists so `vite build`
 * succeeds from day one, the same reasoning `src/index.ts` gives for being
 * "a real module". Replace wholesale once the widget build pipeline lands;
 * nothing here — in particular, not library mode — is meant to survive that.
 */
// eslint-disable-next-line no-restricted-syntax -- vite requires a default export
export default defineConfig({
  plugins: [react()],
});
