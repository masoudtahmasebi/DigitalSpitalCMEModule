import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Enforces `CLAUDE.md` §4 invariant 4 mechanically rather than by convention.
 *
 * The value of this package is that its results are reproducible and its tests
 * need no infrastructure. A single `Date.now()` or `process.env` read would
 * quietly remove that guarantee, and it would not be obvious in review — so it
 * is asserted here instead.
 */

const here = dirname(fileURLToPath(import.meta.url));

const sourceFiles = readdirSync(here)
  .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
  .map((name) => ({ name, contents: readFileSync(join(here, name), "utf8") }));

const FORBIDDEN: ReadonlyArray<{ pattern: RegExp; why: string }> = [
  { pattern: /\bDate\.now\s*\(/, why: "reads the clock — take time as an argument" },
  {
    pattern: /\bnew\s+Date\s*\(\s*\)/,
    why: "reads the clock — take time as an argument",
  },
  { pattern: /\bMath\.random\s*\(/, why: "is non-deterministic" },
  { pattern: /\bprocess\.(env|argv|cwd)\b/, why: "reads process state" },
  { pattern: /\brequire\s*\(/, why: "is a CommonJS runtime import" },
  { pattern: /from\s+["']node:/, why: "is a Node built-in, which implies I/O" },
  { pattern: /from\s+["'](fs|path|http|https|crypto|child_process)["']/, why: "is I/O" },
  { pattern: /\bfetch\s*\(/, why: "is network I/O" },
  { pattern: /\bconsole\./, why: "is I/O and leaks data into logs" },
];

describe("packages/domain stays pure", () => {
  it("has at least one source file to check", () => {
    expect(sourceFiles.length).toBeGreaterThan(0);
  });

  for (const { pattern, why } of FORBIDDEN) {
    it(`contains no ${pattern.source} — it ${why}`, () => {
      const offenders = sourceFiles
        .filter((file) => pattern.test(file.contents))
        .map((file) => file.name);

      expect(offenders).toEqual([]);
    });
  }

  it("declares no runtime dependencies", () => {
    const manifest = JSON.parse(
      readFileSync(join(here, "..", "package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> };

    expect(Object.keys(manifest.dependencies ?? {})).toEqual([]);
  });

  it("imports nothing outside this package", () => {
    const importPattern = /from\s+["']([^"']+)["']/g;
    const external: string[] = [];

    for (const file of sourceFiles) {
      for (const match of file.contents.matchAll(importPattern)) {
        const specifier = match[1];
        if (specifier !== undefined && !specifier.startsWith(".")) {
          external.push(`${file.name}: ${specifier}`);
        }
      }
    }

    expect(external).toEqual([]);
  });
});
