// Lint fixture: forbidden identifier appearing inside an object destructure.
// Issue #5 explicitly enumerates "deconstructions" as in scope for the rule.

interface Source {
  run_id: string;
  rest: number;
}

export function pull(s: Source): string {
  const { run_id } = s;
  return run_id;
}
