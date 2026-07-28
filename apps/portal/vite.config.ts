import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * The standalone portal build (P11-01).
 *
 * An ordinary SPA, like the admin console — this app owns its whole page, so
 * none of the widget's constraints apply to the shell around it. The widget
 * itself is not bundled here: `public/ds-lms.js` is copied in by
 * `scripts/bundle-widget.mjs` and loaded as a module script, which is the same
 * path the WordPress plugin uses (ADR-0007).
 */
// eslint-disable-next-line no-restricted-syntax -- vite requires a default export
export default defineConfig({
  // Pinned for the same reason as the admin console's 5174: a port that
  // depends on what else is running makes every README, redirect URI and CORS
  // origin naming it right only sometimes.
  server: { port: 5175, strictPort: true },
  plugins: [react()],
});
