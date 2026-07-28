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
  // Pinned so `pnpm dev` puts the admin console on the same port every time. Vite's
  // default is "5173, or the next free one", which means the port depends on
  // what else happens to be running — and every README, redirect URI and CORS
  // origin that names it is then right only sometimes.
  server: { port: 5174, strictPort: true },
  plugins: [react()],
});
