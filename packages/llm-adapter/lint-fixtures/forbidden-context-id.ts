// Lint fixture: `context_id` as an object-literal property key.
// Spec §2 #12 lists `context_id` in the 9-identifier forbidden set.
// The willbuy/no-reserved-llm-identifiers rule MUST flag this file.

export const payload = {
  context_id: 'should-be-flagged',
};
