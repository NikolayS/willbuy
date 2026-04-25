// Lint fixture: this file MUST trigger the project's "no '--no-sandbox' literal"
// rule. It is referenced by tests/lint-rules.test.ts and is excluded from
// typecheck via tsconfig.json. Do not "fix" it.

export const chromiumArgs: string[] = ['--headless', '--no-sandbox', '--disable-gpu'];
