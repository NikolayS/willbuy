// Lint fixture: `assistant_id` as a TypeScript interface property signature.
// Spec §2 #12 lists `assistant_id` in the 9-identifier forbidden set.
// The willbuy/no-reserved-llm-identifiers rule MUST flag this file.

export interface BadShape {
  assistant_id: string;
  ok: number;
}
