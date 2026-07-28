import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * The `<ds-lms>` build (P5-01).
 *
 * ## One file, no externals
 *
 * The output is a single self-contained ES module with React bundled in. A
 * WordPress page is not a build target we control: it may already run its own
 * React, a different React, or none. Sharing one would make the widget's
 * behaviour depend on whatever a plugin update does to the host page, which is
 * exactly the class of failure a Shadow-DOM widget exists to avoid. The
 * duplicated React is the price of not caring what else the page loads.
 *
 * ## CSS is inlined, not emitted
 *
 * `cssCodeSplit: false` plus the `?inline` import in `element.ts` puts
 * Tailwind's output in the bundle as a string, which the element adopts into
 * its shadow root. A separate `.css` file would have to be enqueued by the
 * WordPress plugin in the right order and would style nothing anyway — shadow
 * roots do not inherit document stylesheets.
 *
 * ## ES module only
 *
 * `<script type="module">` is the only mode this ships in. Custom elements,
 * Shadow DOM and constructable stylesheets all need a browser that supports
 * modules, so a UMD fallback would target browsers that cannot run the widget.
 */
// eslint-disable-next-line no-restricted-syntax -- vite requires a default export
export default defineConfig({
  // Pinned so `pnpm dev` puts the widget on the same port every time. Vite's
  // default is "5173, or the next free one", which means the port depends on
  // what else happens to be running — and every README, redirect URI and CORS
  // origin that names it is then right only sometimes.
  server: { port: 5173, strictPort: true },
  plugins: [react()],
  define: {
    // React reads this. Without it the development build's warning machinery
    // ships to production and roughly doubles the bundle.
    "process.env.NODE_ENV": JSON.stringify(process.env["NODE_ENV"] ?? "production"),
  },
  build: {
    cssCodeSplit: false,
    lib: {
      entry: "src/index.ts",
      formats: ["es"],
      fileName: () => "ds-lms.js",
    },
    // One file, always: a WordPress plugin enqueues one script, and a lazily
    // fetched chunk would be a second request against a path the plugin would
    // have to know about.
    rollupOptions: { output: { codeSplitting: false } },
  },
});
