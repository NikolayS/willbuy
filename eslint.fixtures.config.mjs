// @ts-check
// Separate ESLint config used ONLY by the lint-fixture test suite.
// Same rules as eslint.config.mjs, but does NOT ignore the fixtures dir
// AND applies react/no-danger directly to the fixtures themselves
// (the main config scopes that rule to apps/web/**, which the fixtures
// don't live under).

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import reactPlugin from 'eslint-plugin-react';
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
    files: ['**/*.{tsx,jsx}'],
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
    files: ['eslint-rules/**/*.js', 'tests/lint-rules.test.ts'],
    rules: {
      'willbuy/no-sandbox-flag': 'off',
    },
  },
);
