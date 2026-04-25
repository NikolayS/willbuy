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
import noSandboxFlag from './eslint-rules/no-sandbox-flag.js';
import noReservedLlmIdentifiers from './packages/llm-adapter/eslint-rule.js';

const willbuy = {
  rules: {
    ...noSandboxFlag.rules,
    ...noReservedLlmIdentifiers.rules,
  },
};

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
      'willbuy/no-reserved-llm-identifiers': 'error',
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
    // The single allow-list line for the AST rule itself: the rule source
    // file, the lint-rule-test file, and (on the fixtures-only config)
    // the lint fixtures themselves all legitimately mention banned names
    // as patterns/diagnostics.
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
