/*
 * Development configuration.
 *
 * In a container this file is **overwritten at start-up** by
 * `infra/nginx/ds-runtime-config.sh`, from the environment the deploy derives
 * out of BASE_DOMAIN. It is committed so that `pnpm dev` serves something
 * rather than 404ing, and so the production overwrite replaces a file rather
 * than creating one.
 *
 * Deliberately empty: `readConfig` then falls back to Vite's `VITE_*`, which is
 * what a developer's `.env.local` sets. A real value here would silently beat
 * that fallback and be very hard to find.
 */
window.__DS_CONFIG__ = {};
