import js from "@eslint/js";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import importPlugin from "eslint-plugin-import";
import security from "eslint-plugin-security";

/**
 * Shared ESLint configuration for every workspace.
 *
 * This file is where ADR-0006 stops being advice and becomes a build failure.
 * Architectural boundaries are enforced mechanically because a rule that
 * depends on a reviewer noticing does not survive high-volume generated code.
 *
 * Consumed by the root config, which globs all workspaces — adding a new
 * workspace requires no change here or at the root (P0-02 acceptance criterion).
 */
export default [
  {
    ignores: [
      "**/dist/**",
      "**/build/**",
      "**/coverage/**",
      "**/node_modules/**",
      "**/.turbo/**",
      "packages/sdk/src/generated/**",
      // Ad-hoc local smoke/debug scripts, never committed (see .gitignore).
      "**/*.local.mjs",
      "**/*.local.ts",
    ],
  },
  js.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: "latest", sourceType: "module" },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      import: importPlugin,
      security,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,

      // TypeScript resolves globals from `lib`/`types` per workspace, and does
      // it correctly for DOM vs Node. ESLint's copy of that check only sees the
      // shared config and would flag `fetch`, `Response` and friends.
      "no-undef": "off",

      // CLAUDE.md §5: no `any` without a comment justifying it.
      "@typescript-eslint/no-explicit-any": "error",

      // CLAUDE.md §5: no default exports except where a framework requires it
      // (those files opt out locally).
      "no-restricted-syntax": [
        "error",
        {
          selector: "ExportDefaultDeclaration",
          message:
            "Named exports only (CLAUDE.md §5). Disable locally where a framework requires a default export.",
        },
      ],

      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": "error",
      eqeqeq: ["error", "always"],
      "no-console": ["warn", { allow: ["warn", "error"] }],

      // Cheap correctness guards that catch real defects in generated code.
      "no-return-await": "error",
      "prefer-const": "error",
      "no-param-reassign": "error",
      "import/no-duplicates": "error",
      "import/no-cycle": ["error", { maxDepth: 6 }],

      // Security lint. Deliberately not the full recommended set — several of
      // its rules fire constantly on legitimate code and train people to ignore
      // warnings, which is worse than not having them.
      "security/detect-unsafe-regex": "error",
      "security/detect-eval-with-expression": "error",
      "security/detect-new-buffer": "error",
      "security/detect-child-process": "error",
      "security/detect-non-literal-fs-filename": "warn",
    },
    settings: {
      "import/resolver": { node: { extensions: [".ts", ".tsx", ".js"] } },
    },
  },

  // ---------------------------------------------------------------------
  // ADR-0006 layer boundaries. Dependencies point strictly inward.
  // ---------------------------------------------------------------------
  // Enforced with `no-restricted-imports` scoped by `files` rather than
  // `import/no-restricted-paths`: the latter matches directories, so file-suffix
  // globs like `**/*.controller.ts` silently never fire. Verified by probe —
  // a rule that does not fire is worse than no rule, because it is trusted.
  {
    files: ["**/*.controller.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/*.repository", "**/*.repository.js", "**/*.repository.ts"],
              message:
                "ADR-0006: controllers must not import repositories. Call the service instead — the service owns the transaction, and embedded data access makes the logic untestable without a database.",
            },
            {
              group: ["drizzle-orm", "drizzle-orm/*", "pg"],
              message:
                "ADR-0006: controllers are the interface layer. Database access belongs in a repository.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["**/*.repository.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "**/*.service",
                "**/*.service.js",
                "**/*.service.ts",
                "**/*.controller",
                "**/*.controller.js",
                "**/*.controller.ts",
              ],
              message:
                "ADR-0006: repositories read and write rows. They hold no business logic and must not depend on the application or interface layers — a decision about whether a learner passed belongs in packages/domain.",
            },
          ],
        },
      ],
    },
  },

  // packages/domain is pure. purity.test.ts asserts this at runtime too; the
  // lint rule gives the same feedback a second earlier, in the editor.
  {
    files: ["packages/domain/src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@nestjs/*",
                "drizzle-orm",
                "drizzle-orm/*",
                "pg",
                "ioredis",
                "react",
                "node:*",
                "fs",
                "path",
                "http",
                "https",
                "crypto",
              ],
              message:
                "CLAUDE.md §4 invariant 4: packages/domain is pure — no framework, no I/O, no Node built-ins. Time is always an argument.",
            },
          ],
        },
      ],
      "no-restricted-globals": [
        "error",
        { name: "fetch", message: "packages/domain performs no I/O." },
        { name: "process", message: "packages/domain reads no process state." },
      ],
    },
  },

  // NestJS's `emitDecoratorMetadata` reads constructor parameter types as
  // runtime values to build `design:paramtypes` for classes Nest constructs
  // via reflection (a plain `providers: [Foo]` entry, or a controller with no
  // custom factory). `@typescript-eslint/consistent-type-imports` cannot see
  // that distinction — a type annotation on a decorated constructor parameter
  // looks syntactically identical to a real type-only usage, so its autofix
  // will happily rewrite the import to `import type` and erase the value Nest
  // needs at runtime. The failure then shows up as a DI error at request time,
  // not a compile error. Scoped off here rather than fought file by file — see
  // CONTRIBUTING.md "A NestJS gotcha that will bite the autofixer".
  {
    files: ["apps/api/src/**/*.ts"],
    rules: {
      "@typescript-eslint/consistent-type-imports": "off",
    },
  },

  // Tests may reach for infrastructure the source may not.
  {
    files: ["**/*.test.ts", "**/*.test.tsx"],
    rules: {
      "no-restricted-imports": "off",
      "no-restricted-globals": "off",
      "security/detect-non-literal-fs-filename": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
];
