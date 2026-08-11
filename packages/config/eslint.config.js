import js from "@eslint/js";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import importPlugin from "eslint-plugin-import";
import security from "eslint-plugin-security";
import reactHooks from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y";

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
      // The widget bundle, copied into each host adapter by
      // `scripts/bundle-widget.mjs`. It is a build artefact of apps/widget —
      // linting it lints React, twice.
      "wordpress/*/assets/**",
      // Vite's `public/` is copied to the output byte for byte and is never
      // part of a module graph, so nothing in it is the TypeScript this config
      // describes. Two things live there: the widget bundle (above) and
      // `config.js`, a plain-browser stub the container overwrites at start-up
      // (infra/nginx/ds-runtime-config.sh).
      "apps/*/public/**",
      // WordPress block editor script: plain browser ES for wp-admin, with no
      // build step by design (see block/index.js). It is not part of any
      // TypeScript project and the layer rules do not apply to it.
      "wordpress/*/block/**",
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
        {
          // A repetition anchored at the end of the string — `/\/+$/`, `/-+$/`,
          // `/\s*$/` — makes the engine restart its scan at every position, so
          // the work is quadratic in the input's length. CodeQL calls it
          // "polynomial regular expression used on uncontrolled data" and found
          // four of them here in one pass (P49-01).
          //
          // `security/detect-unsafe-regex` above does *not* catch these: it
          // looks for exponential blow-up, and this class is merely polynomial.
          //
          // For trimming a URL, `stripTrailingSlashes`/`joinUrl` in `@ds/domain`
          // are the linear answers and the ones every call site should use. For
          // anything else, a `while` loop over `charCodeAt` is four lines and
          // obviously linear.
          //
          // Anchored at *both* ends is safe and stays legal: `^[a-z0-9]+$` has
          // exactly one start position, so there is nothing for the engine to
          // retry. Only a repetition anchored at the end **alone** can be
          // restarted from every offset — hence the `:not` on a leading `^`.
          //
          // Getting that distinction wrong is what makes a rule get switched
          // off: the first version flagged twelve `toMatch(/^[a-z]+$/)` in
          // tests, none of which can backtrack.
          selector: "Literal[regex.pattern=/[+*]\\$$/]:not([regex.pattern=/^\\^/])",
          message:
            "A repetition anchored at the end (`+$` or `*$`) backtracks quadratically. " +
            "Use stripTrailingSlashes/joinUrl from @ds/domain for URLs, or a loop. " +
            "Disable locally only where the input's length is bounded by construction.",
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

  // ---------------------------------------------------------------------
  // Apps are leaves. Shared code is a package.
  // ---------------------------------------------------------------------
  // An app importing another app makes two deployables one deployable, and
  // there is no build step that would tell you. This was a real mistake: the
  // EIV client started inside `apps/eiv-harness`, and the API's submission
  // worker needed it — so it moved to `packages/eiv-client`, which is where
  // code with two consumers belongs. The rule exists so the next person is
  // told at edit time rather than discovering it after wiring it up.
  {
    files: ["apps/*/src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@ds/api", "@ds/widget", "@ds/admin", "@ds/eiv-harness"],
              message:
                "Apps must not import other apps. Code with more than one consumer belongs in packages/ — see packages/eiv-client for the precedent.",
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

  // ---------------------------------------------------------------------
  // The React apps: hooks correctness and the accessibility floor.
  // ---------------------------------------------------------------------
  // `react-hooks` is not style linting. Its two rules catch the stale-closure
  // and conditional-hook bugs that produce a widget showing a percentage from
  // three renders ago — exactly the class of defect that looks fine in review
  // and is wrong on a physician's screen.
  //
  // `jsx-a11y` enforces the responsive/a11y floor that CLAUDE.md §3 costs in
  // and declares non-negotiable. Only the subset that is mechanically decidable
  // is enabled as an error; the plugin's full recommended set includes rules
  // that guess at intent and would train people to disable it.
  {
    // Every React app we ship. A new frontend added here without this line
    // would silently opt out of the accessibility floor, which is exactly how
    // a floor stops being one.
    files: [
      "apps/widget/src/**/*.{ts,tsx}",
      "apps/admin/src/**/*.{ts,tsx}",
      "apps/portal/src/**/*.{ts,tsx}",
    ],
    plugins: { "react-hooks": reactHooks, "jsx-a11y": jsxA11y },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",

      "jsx-a11y/alt-text": "error",
      "jsx-a11y/anchor-has-content": "error",
      "jsx-a11y/aria-props": "error",
      "jsx-a11y/aria-role": "error",
      "jsx-a11y/label-has-associated-control": "error",
      "jsx-a11y/media-has-caption": "warn",
      "jsx-a11y/no-redundant-roles": "error",
      "jsx-a11y/role-has-required-aria-props": "error",
    },
  },

  // Repository tooling: plain ES modules run by Node, outside any TypeScript
  // project. `no-undef` is on for these (it is switched off for .ts files,
  // where TypeScript does the job properly), so Node's globals have to be
  // declared or every `process` and `console` is an error.
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: { process: "readonly", console: "readonly", URL: "readonly" },
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
