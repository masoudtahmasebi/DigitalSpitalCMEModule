import js from "@eslint/js";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

/**
 * Shared ESLint configuration for every workspace.
 *
 * Consumed by the root config, which globs all workspaces — adding a new
 * workspace requires no change here or at the root (P0-02 acceptance
 * criterion).
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
    ],
  },
  js.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,

      // TypeScript resolves globals from `lib`/`types` per workspace, and does
      // it correctly for DOM vs Node. ESLint's copy of that check only sees the
      // shared config and would flag `fetch`, `Response` and friends.
      "no-undef": "off",

      // CLAUDE.md section 5: no `any` without a comment justifying it.
      "@typescript-eslint/no-explicit-any": "error",

      // CLAUDE.md section 5: no default exports except where a framework
      // requires it (those files opt out locally).
      "no-restricted-syntax": [
        "error",
        {
          selector: "ExportDefaultDeclaration",
          message:
            "Named exports only (CLAUDE.md section 5). Disable locally where a framework requires a default export.",
        },
      ],

      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": "error",
      eqeqeq: ["error", "always"],
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },
];
