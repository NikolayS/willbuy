// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import reactPlugin from 'eslint-plugin-react';
import noSandboxFlag from './eslint-rules/no-sandbox-flag.js';
import noReservedLlmIdentifiers from './packages/llm-adapter/eslint-rule.js';

// Single namespaced plugin: ESLint v9 wants one plugin object with all
// rules merged in. Two separate plugin entries with the same key would
// collide.
const willbuy = {
  rules: {
    ...noSandboxFlag.rules,
    ...noReservedLlmIdentifiers.rules,
  },
};

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
      '**/coverage/**',
      'pnpm-lock.yaml',
      'tests/lint-fixtures/**',
      // Same exclusion pattern as tests/lint-fixtures: files here are
      // negative-test inputs for `apps/web` lint rules (SPEC §5.10 +
      // issue #7 acceptance #4). They are linted explicitly by
      // apps/web/test/lint-scoping.test.ts via `eslint --no-ignore`.
      'apps/web/_lint-fixtures/**',
      // Negative-test inputs for the AST identifier ban. Linted
      // explicitly by packages/llm-adapter/test/lint-rule.test.ts via
      // the fixtures-only config (which does NOT ignore them).
      'packages/llm-adapter/lint-fixtures/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      willbuy,
    },
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'willbuy/no-sandbox-flag': 'error',
      'willbuy/no-reserved-llm-identifiers': 'error',
    },
  },
  {
    // react/no-danger is scoped to apps/web/** per the SPEC §5.10
    // render boundary: only the Next.js app renders captured / LLM /
    // cluster-label content, so that's where the rule must hold.
    files: ['apps/web/**/*.{ts,tsx,js,jsx,mjs,cjs}'],
    plugins: {
      react: reactPlugin,
    },
    languageOptions: {
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      'react/no-danger': 'error',
    },
  },
  {
    // The rule definitions and tests that exercise them both legitimately
    // mention the banned literal/identifiers as patterns/diagnostic
    // strings. This is the SINGLE allow-list scope for both willbuy
    // custom rules; new files added here require a reviewer eyebrow.
    files: [
      'eslint-rules/**/*.js',
      'packages/llm-adapter/eslint-rule.js',
      'tests/lint-rules.test.ts',
      'packages/llm-adapter/test/lint-rule.test.ts',
    ],
    rules: {
      'willbuy/no-sandbox-flag': 'off',
      'willbuy/no-reserved-llm-identifiers': 'off',
    },
  },
);
