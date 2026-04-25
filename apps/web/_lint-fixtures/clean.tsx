// SPEC §5.10 lint fixture (issue #7 acceptance #4).
// Positive case: ordinary JSX with React auto-escaping must lint cleanly.
// Mirrors the rendering pattern used throughout apps/web for captured
// page text, LLM output, and cluster labels.

export function CleanReportBody({ text }: { text: string }): JSX.Element {
  return <p>{text}</p>;
}
