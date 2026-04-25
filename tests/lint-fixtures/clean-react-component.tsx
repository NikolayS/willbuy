// Positive lint fixture: this file MUST pass lint cleanly. It exists to
// prove react/no-danger does not false-positive on ordinary JSX that
// uses React's auto-escaping (the rendering pattern SPEC §5.10 mandates).

declare const React: {
  createElement: (
    tag: string,
    props: Record<string, unknown> | null,
    ...children: unknown[]
  ) => unknown;
};

export function CleanComponent({ text }: { text: string }): unknown {
  return <p>{text}</p>;
}
