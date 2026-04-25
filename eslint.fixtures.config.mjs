// @ts-check
// Separate ESLint config used ONLY by the lint-fixture test suite.
// It applies the same rules as eslint.config.mjs but does NOT ignore the
// tests/lint-fixtures/ directory, so the fixtures actually get linted.

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: ['**/node_modules/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
);
