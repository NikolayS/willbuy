// SPEC §5.10 lint fixture (issue #7 acceptance #4).
// This file exists so reviewers and CI can prove that react/no-danger
// is wired up at the apps/web/** scope. It MUST trip the lint rule.
// Do not "fix" it. The reviewer will grep for `dangerouslySetInnerHTML`
// outside of `_lint-fixtures/` and reject any other occurrence.

export function DangerousReportBody({ html }: { html: string }): JSX.Element {
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
