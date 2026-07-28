/**
 * Copy the built `<ds-lms>` bundle to a host adapter (ADR-0007).
 *
 * Two hosts want the same file — the WordPress plugin and the standalone
 * portal — and both want it the same way: **the artifact the widget build
 * produced**, not a re-bundle from source.
 *
 * That distinction matters. The widget's Tailwind is scoped under
 * `.ds-lms-root` by its own config and inlined into the bundle as a string
 * (`styles.css?inline`), because it has to live inside a closed shadow root.
 * A host that imported the widget's *source* would compile that CSS with its
 * own Tailwind config, and the widget would come out styled differently in
 * each host — which is exactly the class of failure the shadow root exists to
 * prevent.
 *
 * So every host loads one file, built once. The portal proving that path is
 * worth more than the convenience of an import: it is the same path WordPress
 * uses in production.
 *
 *   node scripts/bundle-widget.mjs <destination-directory>
 */

import { copyFile, mkdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "apps/widget/dist/ds-lms.js");

const destination = process.argv[2];
if (destination === undefined) {
  console.error("usage: node scripts/bundle-widget.mjs <destination-directory>");
  process.exit(2);
}

try {
  await stat(source);
} catch {
  console.error(
    `no widget bundle at ${source} — run \`pnpm --filter @ds/widget build\` first.`,
  );
  process.exit(1);
}

const target = resolve(root, destination);
await mkdir(target, { recursive: true });
await copyFile(source, join(target, "ds-lms.js"));
console.log(`ds-lms.js → ${join(destination, "ds-lms.js")}`);
