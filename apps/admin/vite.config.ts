import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * The admin console build (P9-01).
 *
 * An ordinary SPA build: this app is served from its own origin and owns its
 * whole page, so none of the widget's constraints (single file, inlined CSS,
 * no code splitting) apply. Code splitting is welcome here — an admin loading
 * the course list should not pay for the participant screen.
 */
// eslint-disable-next-line no-restricted-syntax -- vite requires a default export
export default defineConfig({
  plugins: [react()],
});
