// Lint fixture: forbidden identifier as a type-definition property name.
// Issue #5 explicitly requires the AST rule to walk type definitions, not
// just call sites. A regex would also catch this but the test asserts the
// AST path covers it.

export interface BadShape {
  conversation_id: string;
  ok: number;
}
