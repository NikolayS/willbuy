// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import reactPlugin from 'eslint-plugin-react';
import willbuy from './eslint-rules/no-sandbox-flag.js';

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
    // The rule definition and the test that exercises it both legitimately
    // mention the banned literal as a pattern/diagnostic string. They are the
    // single allow-listed exception to `willbuy/no-sandbox-flag`.
    files: ['eslint-rules/**/*.js', 'tests/lint-rules.test.ts'],
    rules: {
      'willbuy/no-sandbox-flag': 'off',
    },
  },
);
