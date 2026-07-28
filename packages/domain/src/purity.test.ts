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

/**
 * Strip comments and string literals before matching.
 *
 * Without this the checks match prose: a comment mentioning the "admin
 * console." trips the `console.` rule, and the fix a hurried author reaches
 * for is to reword the comment — leaving the same trap set for the next
 * person and teaching everyone that the guard cries wolf. A guard that fires
 * on things which are not violations gets disabled eventually, so it is worth
 * the twelve lines to make it precise.
 *
 * Deliberately approximate: it is a lexer good enough for source we control,
 * not a parser. It errs toward removing too much, which can only cause a
 * false pass — and a real `console.log` in code is still caught, because it
 * lives in neither a comment nor a string.
 */
function stripCommentsAndStrings(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/`(?:\\.|[^`\\])*`/g, '""')
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, '""');
}

const sourceFiles = readdirSync(here)
  .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
  .map((name) => {
    const raw = readFileSync(join(here, name), "utf8");
    return { name, raw, contents: stripCommentsAndStrings(raw) };
  });

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

  /**
   * The guard's own guard. `stripCommentsAndStrings` is what stands between
   * these rules and a false pass, so it is tested directly rather than
   * trusted: an over-eager stripper would silently blank real code and every
   * rule above would go green on a genuinely impure file.
   */
  describe("the comment/string stripper is precise", () => {
    it("still sees a violation in real code", () => {
      for (const source of [
        "export const x = Date.now();",
        "console.log(secret);",
        "const r = Math.random();",
        "const t = new Date();",
      ]) {
        const stripped = stripCommentsAndStrings(source);
        expect(FORBIDDEN.some(({ pattern }) => pattern.test(stripped))).toBe(true);
      }
    });

    it("ignores the same words in a comment or a string", () => {
      for (const source of [
        "// see the admin console. for details",
        "/* Date.now() is forbidden here */",
        'const msg = "call console.log to debug";',
        "const help = `Math.random() is banned`;",
      ]) {
        const stripped = stripCommentsAndStrings(source);
        expect(FORBIDDEN.some(({ pattern }) => pattern.test(stripped))).toBe(false);
      }
    });

    it("does not blank code that merely follows a comment", () => {
      const stripped = stripCommentsAndStrings("// a note\nconst x = Date.now();");
      expect(/\bDate\.now\s*\(/.test(stripped)).toBe(true);
    });
  });

  it("declares no runtime dependencies", () => {
    const manifest = JSON.parse(
      readFileSync(join(here, "..", "package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> };

    expect(Object.keys(manifest.dependencies ?? {})).toEqual([]);
  });

  it("imports nothing outside this package", () => {
    const importPattern = /from\s+["']([^"']+)["']/g;
    const external: string[] = [];

    // `raw`, not `contents`: the stripper blanks string literals, which is
    // exactly where a module specifier lives.
    for (const file of sourceFiles) {
      for (const match of file.raw.matchAll(importPattern)) {
        const specifier = match[1];
        if (specifier !== undefined && !specifier.startsWith(".")) {
          external.push(`${file.name}: ${specifier}`);
        }
      }
    }

    expect(external).toEqual([]);
  });
});
