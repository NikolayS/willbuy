// Lint fixture: forbidden identifier as a function parameter name.
// Issue #5 acceptance #6 requires the AST rule to catch this even though
// no LLM call site is visible — type-defs and helper signatures are equally
// in scope.

export function bad(previous_response_id: string): string {
  return previous_response_id;
}
