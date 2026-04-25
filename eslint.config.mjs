// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
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
    // The rule definition and the test that exercises it both legitimately
    // mention the banned literal as a pattern/diagnostic string. They are the
    // single allow-listed exception to `willbuy/no-sandbox-flag`.
    files: ['eslint-rules/**/*.js', 'tests/lint-rules.test.ts'],
    rules: {
      'willbuy/no-sandbox-flag': 'off',
    },
  },
);
