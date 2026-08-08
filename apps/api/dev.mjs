/**
 * The API's watch-mode runner.
 *
 * ## Why this is not `tsx watch src/main.ts`
 *
 * It was, and `pnpm dev` was broken the whole time in a way that looked like a
 * product bug: `POST /admin/customers` answered 500, and the same call against
 * a `tsc`-compiled build answered 201.
 *
 * `tsx` transpiles with esbuild, and esbuild implements `experimentalDecorators`
 * but **not** `emitDecoratorMetadata` — it is a documented non-goal, because the
 * metadata needs a type checker and esbuild does not have one. NestJS resolves
 * constructor injection from exactly that metadata (`design:paramtypes`). With
 * it missing, every provider is constructed with no arguments, every injected
 * field is `undefined`, and the first `this.something.method()` throws. The
 * failure is a 500 at request time rather than an error at boot, which is why it
 * survived so long: the app starts, the routes register, and only the handlers
 * are hollow.
 *
 * Vitest does not have this problem — its transform is rolldown/oxc, which does
 * emit the metadata — so the integration suite was green against code that could
 * not have served a single request under `pnpm dev`. That is precisely the kind
 * of gap the journey suite exists to close, and it is worth naming: **green
 * tests did not mean a working dev server.**
 *
 * ## What this does instead
 *
 * `tsc --watch` for the compile, because `tsc` is the one transpiler in this
 * repo that is guaranteed to agree with `tsconfig.json` — including
 * `emitDecoratorMetadata` — and `node --watch` for the restart. Two processes,
 * no new dependency, and the compiler that CI uses is the compiler that dev
 * uses.
 *
 * The first build runs to completion before the server starts, so a clean
 * checkout does not begin with `Cannot find module dist/main.js`.
 */

import { spawn } from "node:child_process";
import { once } from "node:events";
import { createRequire } from "node:module";
import process from "node:process";

const children = new Set();

/**
 * The compiler's real entry point, not the `npx tsc` wrapper.
 *
 * Going through `npx` was the first version, and it leaked: `npx` spawns the
 * compiler as a *grandchild*, so killing the child left `tsc --watch` running
 * with the terminal gone. Two of them accumulated within one afternoon, both
 * writing into the same `dist/`. Resolving the binary here means every process
 * this script starts is one it can also stop.
 */
const tscBin = createRequire(import.meta.url).resolve("typescript/bin/tsc");

/** Spawn, inheriting stdio, and remember it so shutdown can reach it. */
function run(command, args) {
  const child = spawn(command, args, { stdio: "inherit", shell: false });
  children.add(child);
  child.on("exit", () => children.delete(child));
  return child;
}

/** `tsc` with the project's own config, run as a plain Node program. */
function tsc(...args) {
  return run(process.execPath, [tscBin, "-p", "tsconfig.json", ...args]);
}

/**
 * Kill everything on the way out.
 *
 * Without this, Ctrl-C leaves an orphaned `tsc --watch` holding the file
 * watches, and the next `pnpm dev` compiles into a directory a stale compiler
 * is also writing to.
 */
function shutdown(code) {
  for (const child of children) child.kill("SIGTERM");
  process.exit(code);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => shutdown(0));
}

// One full build first. `--noEmitOnError false` is the default; a type error
// still emits, so a half-broken build is runnable and the error is on screen —
// which is what a watch loop should do.
const [firstCode] = await once(tsc(), "exit");

if (firstCode !== 0) {
  // Not fatal: `tsc` reports the errors itself, and the emitted output is
  // usually still good enough to boot. Exiting here would mean one type error
  // in one file takes the dev server away entirely.
  process.stderr.write("\n[dev] initial compile reported errors; starting anyway\n\n");
}

tsc("--watch", "--preserveWatchOutput");

const server = run(process.execPath, ["--watch", "--enable-source-maps", "dist/main.js"]);
const [serverCode] = await once(server, "exit");
shutdown(serverCode ?? 0);
