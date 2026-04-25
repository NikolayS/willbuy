// @ts-check
// Separate ESLint config used ONLY by the lint-fixture test suite.
// It applies the same rules as eslint.config.mjs but does NOT ignore the
// tests/lint-fixtures/ directory, so the fixtures actually get linted.

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import willbuy from './eslint-rules/no-sandbox-flag.js';

export default tseslint.config(
  {
    ignores: ['**/node_modules/**'],
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
    files: ['eslint-rules/**/*.js', 'tests/lint-rules.test.ts'],
    rules: {
      'willbuy/no-sandbox-flag': 'off',
    },
  },
);
