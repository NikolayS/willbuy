// Lint fixture: this file MUST trigger react/no-danger.
// It is referenced by tests/lint-rules.test.ts and is excluded from
// the main pnpm lint pass via tsconfig.json + eslint ignore.
// Do not "fix" it.

// Minimal local React-like type so this fixture stays self-contained
// and does not pull a real React dependency into the root workspace.
declare const React: {
  createElement: (
    tag: string,
    props: Record<string, unknown> | null,
    ...children: unknown[]
  ) => unknown;
};

export function DangerComponent(): unknown {
  const html = '<p>captured page text — must NEVER be injected as raw HTML</p>';
  return (
    <div dangerouslySetInnerHTML={{ __html: html }} />
  );
}
